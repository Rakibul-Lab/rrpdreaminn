import {
  computeHotelDiscountAmount,
  parseBookingDiscountType,
  type BookingDiscountInput,
} from '@/lib/booking-discount'

export const DEFAULT_VAT_PERCENT = 15

/** Keyboard ↑/↓ step for VAT % inputs (14 → 14.1 → 14.2). */
export const VAT_PERCENT_INPUT_STEP = 0.1

export type BookingVatOptions = {
  vatApplied?: boolean
  vatPercent?: number
}

function effectiveVatRate(options?: number | BookingVatOptions): number {
  if (typeof options === 'number') {
    return Math.max(0, options)
  }
  const applied = options?.vatApplied !== false
  if (!applied) return 0
  const rate = options?.vatPercent ?? DEFAULT_VAT_PERCENT
  return Math.max(0, rate)
}

/** Room charge + VAT totals for reservations (room only, before extras/restaurant). */
export function computeRoomBookingTotals(
  totalRoomCharge: number,
  totalPaid: number,
  vatOptions?: number | BookingVatOptions,
  discount?: BookingDiscountInput
) {
  const rate = effectiveVatRate(vatOptions)
  const vatApplied = rate > 0
  const discountAmount = computeHotelDiscountAmount(
    totalRoomCharge,
    discount?.discountEnabled === true,
    parseBookingDiscountType(discount?.discountType),
    Number(discount?.discountValue) || 0
  )
  const taxableRoom = Math.max(0, totalRoomCharge - discountAmount)
  const vatAmount = (taxableRoom * rate) / 100
  const totalWithVat = taxableRoom + vatAmount
  const dueAmount = Math.max(0, totalWithVat - totalPaid)
  return {
    vatApplied,
    vatPercent: rate,
    discountAmount,
    vatAmount,
    totalWithVat,
    dueAmount,
  }
}

/** Hotel room VAT % from settings (default 15). */
export async function getHotelVatPercent(): Promise<number> {
  const { getHotelVatPercent: readHotelVat } = await import('@/lib/app-settings')
  return readHotelVat()
}

export function bookingVatOptions(booking: {
  vatApplied?: boolean | null
  vatPercent?: number | null
}): BookingVatOptions {
  return {
    vatApplied: booking.vatApplied !== false,
    vatPercent: booking.vatPercent ?? DEFAULT_VAT_PERCENT,
  }
}

export type BookingPaymentRow = { amount: number; paymentType: string }

/** Net amount collected on a booking (payments minus refunds). */
export function sumBookingNetPaid(payments: BookingPaymentRow[]): number {
  return payments.reduce((sum, p) => {
    if (p.paymentType === 'REFUND') return sum - Math.abs(p.amount)
    return sum + p.amount
  }, 0)
}

export function computeRefundFromInput(
  maxRefundable: number,
  mode: 'percent' | 'amount',
  percent: number,
  amount: number
): number {
  if (maxRefundable <= 0) return 0
  if (mode === 'percent') {
    const pct = Math.min(100, Math.max(0, percent))
    return Math.round((maxRefundable * pct) / 100 * 100) / 100
  }
  return Math.min(maxRefundable, Math.max(0, amount))
}
