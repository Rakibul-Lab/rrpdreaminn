export type BookingDiscountType = 'PERCENTAGE' | 'FIXED'

export function parseBookingDiscountType(value: unknown): BookingDiscountType {
  return value === 'FIXED' ? 'FIXED' : 'PERCENTAGE'
}

export function computeHotelDiscountAmount(
  hotelBase: number,
  enabled: boolean,
  type: BookingDiscountType,
  value: number
): number {
  if (!enabled || value <= 0 || hotelBase <= 0) return 0
  if (type === 'FIXED') {
    return Math.min(hotelBase, Math.max(0, value))
  }
  const pct = Math.min(100, Math.max(0, value))
  return (hotelBase * pct) / 100
}

export type BookingDiscountInput = {
  discountEnabled?: boolean | null
  discountType?: string | null
  discountValue?: number | null
}

export function resolveBookingDiscount(input: BookingDiscountInput) {
  const enabled = input.discountEnabled === true
  const type = parseBookingDiscountType(input.discountType)
  const value = enabled ? Math.max(0, Number(input.discountValue) || 0) : 0
  return { enabled, type, value }
}
