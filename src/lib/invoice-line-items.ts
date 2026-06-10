import type { Prisma } from '@prisma/client'
import { countHotelStayNights } from '@/lib/hotel-times'

export type InvoiceLineItemInput = {
  itemType: string
  referenceId?: string | null
  description: string
  quantity: number
  unitPrice: number
  total: number
}

type RoomChargeRow = {
  id: string
  chargeType: string
  description: string
  amount: number
  quantity: number
}

type RestaurantOrderRow = {
  id: string
  orderNumber: string
  subtotal: number
  discount: number
  vatPercent?: number
  vatAmount?: number
  items?: Array<{
    id: string
    quantity: number
    price: number
    menuItem: { name: string }
  }>
}

export type BuildInvoiceLineItemsInput = {
  roomNumber: string
  roomTypeName: string
  checkIn: Date
  checkOut: Date
  charges: RoomChargeRow[]
  restaurantOrders: RestaurantOrderRow[]
  roomCharges: number
  chargeableNights?: number
  nightlyRate?: number
  stayAdjusted?: boolean
  includeExtraCharges?: boolean
  discount: number
  hotelVat: number
  hotelVatPercent: number
  vatApplied?: boolean
  restaurantVat: number
}

function countBookedNights(checkIn: Date, checkOut: Date): number {
  return countHotelStayNights(checkIn, checkOut)
}

function buildRoomChargeLines(input: BuildInvoiceLineItemsInput): InvoiceLineItemInput[] {
  const { roomNumber, roomTypeName, roomCharges } = input

  if (input.stayAdjusted && input.chargeableNights != null && input.nightlyRate != null) {
    const nights = input.chargeableNights
    const rate = input.nightlyRate
    return [
      {
        itemType: 'room_charge',
        description: `Room ${roomNumber} (${roomTypeName}) – ${nights} night(s) @ ৳${rate.toLocaleString()}/night`,
        quantity: nights,
        unitPrice: rate,
        total: roomCharges,
      },
    ]
  }

  const roomRateCharges = input.charges.filter((c) => c.chargeType === 'ROOM_RATE')
  if (roomRateCharges.length > 0) {
    return roomRateCharges.map((charge) => ({
      itemType: 'room_charge',
      referenceId: charge.id,
      description: charge.description || `Room rate – Room ${roomNumber}`,
      quantity: charge.quantity,
      unitPrice: charge.amount,
      total: charge.amount * charge.quantity,
    }))
  }

  if (roomCharges <= 0) return []

  const nights = countBookedNights(input.checkIn, input.checkOut)
  const ratePerNight = roomCharges / nights
  return [
    {
      itemType: 'room_charge',
      description: `Room ${roomNumber} (${roomTypeName}) – ${nights} night${nights > 1 ? 's' : ''}`,
      quantity: nights,
      unitPrice: ratePerNight,
      total: roomCharges,
    },
  ]
}

function buildExtraChargeLines(input: BuildInvoiceLineItemsInput): InvoiceLineItemInput[] {
  if (input.includeExtraCharges === false) return []

  return input.charges
    .filter((c) => c.chargeType !== 'ROOM_RATE')
    .map((charge) => ({
      itemType: 'extra_service',
      referenceId: charge.id,
      description:
        charge.description ||
        (charge.chargeType === 'EARLY_CHECKOUT'
          ? 'Early checkout fee'
          : charge.chargeType === 'DAMAGE'
            ? 'Damage charges'
            : charge.chargeType.replace(/_/g, ' ')),
      quantity: charge.quantity,
      unitPrice: charge.amount,
      total: charge.amount * charge.quantity,
    }))
}

function buildRestaurantLines(orders: RestaurantOrderRow[]): InvoiceLineItemInput[] {
  const lines: InvoiceLineItemInput[] = []

  for (const order of orders) {
    const orderLabel = order.orderNumber ? `#${order.orderNumber}` : order.id.slice(-6)

    if (order.items && order.items.length > 0) {
      for (const item of order.items) {
        lines.push({
          itemType: 'food_order',
          referenceId: item.id,
          description: `${item.menuItem.name} (Order ${orderLabel})`,
          quantity: item.quantity,
          unitPrice: item.price,
          total: item.price * item.quantity,
        })
      }
      if (order.discount > 0) {
        lines.push({
          itemType: 'food_order',
          referenceId: order.id,
          description: `Restaurant discount (Order ${orderLabel})`,
          quantity: 1,
          unitPrice: -order.discount,
          total: -order.discount,
        })
      }
    } else {
      const net = Math.max(0, order.subtotal - order.discount)
      if (net > 0) {
        lines.push({
          itemType: 'food_order',
          referenceId: order.id,
          description: `Restaurant order ${orderLabel}`,
          quantity: 1,
          unitPrice: net,
          total: net,
        })
      }
    }

    if ((order.vatAmount ?? 0) > 0) {
      const pct = order.vatPercent != null ? ` (${order.vatPercent}%)` : ''
      lines.push({
        itemType: 'vat_restaurant',
        referenceId: order.id,
        description: `Restaurant VAT${pct} – Order ${orderLabel}`,
        quantity: 1,
        unitPrice: order.vatAmount!,
        total: order.vatAmount!,
      })
    }
  }

  return lines
}

/** Room, extras, and restaurant lines only (no discount / hotel VAT summary rows). */
export function buildInvoiceChargeLinesOnly(
  input: Omit<BuildInvoiceLineItemsInput, 'discount' | 'hotelVat' | 'restaurantVat'>
): InvoiceLineItemInput[] {
  return [
    ...buildRoomChargeLines(input),
    ...buildExtraChargeLines(input),
    ...buildRestaurantLines(input.restaurantOrders),
  ]
}

/** Detailed line items for invoice print (room, extras, F&B, discount, VAT). */
export function buildInvoiceLineItems(input: BuildInvoiceLineItemsInput): InvoiceLineItemInput[] {
  const items: InvoiceLineItemInput[] = buildInvoiceChargeLinesOnly(input)

  if (input.discount > 0) {
    items.push({
      itemType: 'discount',
      description: 'Hotel discount',
      quantity: 1,
      unitPrice: -input.discount,
      total: -input.discount,
    })
  }

  if (input.hotelVat > 0) {
    const rateLabel = input.vatApplied === false ? '' : ` (${input.hotelVatPercent}%)`
    items.push({
      itemType: 'vat_hotel',
      description: `Hotel VAT${rateLabel}`,
      quantity: 1,
      unitPrice: input.hotelVat,
      total: input.hotelVat,
    })
  }

  const hasRestaurantVatLines = items.some((i) => i.itemType === 'vat_restaurant')
  if (!hasRestaurantVatLines && input.restaurantVat > 0) {
    items.push({
      itemType: 'vat_restaurant',
      description: 'Restaurant VAT',
      quantity: 1,
      unitPrice: input.restaurantVat,
      total: input.restaurantVat,
    })
  }

  return items
}

export async function replaceInvoiceLineItems(
  tx: Prisma.TransactionClient,
  invoiceId: string,
  lineItems: InvoiceLineItemInput[]
): Promise<void> {
  await tx.invoiceItem.deleteMany({ where: { invoiceId } })
  for (const item of lineItems) {
    await tx.invoiceItem.create({
      data: {
        invoiceId,
        itemType: item.itemType,
        referenceId: item.referenceId ?? null,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        total: item.total,
      },
    })
  }
}
