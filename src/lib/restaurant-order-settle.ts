import type {
  PaymentMethod,
  Prisma,
  PrismaClient,
  RestaurantSettlementSource,
  RoleType,
} from '@prisma/client'
import { computeOrderDue } from '@/lib/restaurant-order-dues'

type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends' | '$use'
>

export function resolveRestaurantSettlementSource(role: RoleType): RestaurantSettlementSource {
  if (role === 'HOTEL_STAFF') return 'HOTEL_DUE'
  return 'RESTAURANT_DIRECT'
}

export function formatRestaurantSettlementSource(
  source?: string | null,
  receiver?: { name: string; role?: string } | null
): string {
  if (source === 'HOTEL_DUE') {
    const by = receiver?.name ? ` by ${receiver.name}` : ''
    return `Hotel due settlement${by}`
  }
  if (source === 'RESTAURANT_DIRECT') {
    const by = receiver?.name ? ` — received by ${receiver.name}` : ''
    return `Restaurant direct${by}`
  }
  if (receiver?.role === 'HOTEL_STAFF') return `Hotel due settlement by ${receiver.name}`
  if (receiver?.name) return `Received by ${receiver.name}`
  return 'Restaurant payment'
}

export function buildPaymentDateFilter(
  dateFrom?: string,
  dateTo?: string
): Prisma.DateTimeFilter | undefined {
  const createdAt: Prisma.DateTimeFilter = {}
  if (dateFrom) {
    const start = new Date(dateFrom)
    if (!Number.isNaN(start.getTime())) {
      start.setHours(0, 0, 0, 0)
      createdAt.gte = start
    }
  }
  if (dateTo) {
    const end = new Date(dateTo)
    if (!Number.isNaN(end.getTime())) {
      end.setHours(23, 59, 59, 999)
      createdAt.lte = end
    }
  }
  if (!createdAt.gte && !createdAt.lte) return undefined
  return createdAt
}

type SettleOrderInput = {
  amount: number
  method: PaymentMethod
  reference: string
  notes?: string | null
  settlementSource: RestaurantSettlementSource
  receivedBy: string
}

export async function settleRestaurantOrderInTx(
  tx: Tx,
  order: {
    id: string
    orderNumber: string
    orderType: string
    status: string
    totalAmount: number
    bookingId: string | null
    payments: { amount: number; paymentType: string }[]
  },
  input: SettleOrderInput
) {
  if (order.status === 'CANCELLED') {
    throw new Error('Cannot settle a cancelled order')
  }
  if (!['DELIVERED', 'READY'].includes(order.status)) {
    throw new Error('Only delivered or ready orders can be settled')
  }

  const { dueAmount } = computeOrderDue(order.totalAmount, order.payments)
  if (dueAmount <= 0.009) {
    throw new Error(`Order ${order.orderNumber} is already fully settled`)
  }
  if (input.amount <= 0) {
    throw new Error('Payment amount must be greater than 0')
  }
  if (input.amount > dueAmount + 0.01) {
    throw new Error(
      `Payment for ${order.orderNumber} cannot exceed due amount (৳${dueAmount.toFixed(2)})`
    )
  }
  if (!input.reference.trim()) {
    throw new Error('Transaction / receipt number is required')
  }

  const payment = await tx.payment.create({
    data: {
      amount: input.amount,
      method: input.method,
      paymentType: 'RESTAURANT',
      orderId: order.id,
      bookingId: order.bookingId,
      reference: input.reference.trim(),
      notes: input.notes?.trim() || null,
      settlementSource: input.settlementSource,
      receivedBy: input.receivedBy,
    },
    include: {
      receiver: { select: { id: true, name: true, role: true } },
    },
  })

  // Guest folio only while still checked in — after checkout the guest already paid the hotel;
  // hotel→restaurant settlement is tracked on the order, not booking.dueAmount.
  if (
    order.bookingId &&
    order.orderType === 'ROOM_SERVICE' &&
    input.settlementSource === 'RESTAURANT_DIRECT'
  ) {
    const booking = await tx.booking.findUnique({ where: { id: order.bookingId } })
    if (booking?.status === 'CHECKED_IN') {
      await tx.booking.update({
        where: { id: order.bookingId },
        data: { dueAmount: Math.max(0, booking.dueAmount - input.amount) },
      })
    }
  }

  return {
    payment,
    remainingDue: Math.max(0, dueAmount - input.amount),
  }
}
