import { computeHotelDiscountAmount, parseBookingDiscountType } from '@/lib/booking-discount'
import {
  bookingVatOptions,
  computeRoomBookingTotals,
  sumBookingNetPaid,
} from '@/lib/booking-totals'
import {
  computeAdjustedRoomCharge,
  countActualStayNights,
  countBookedNights,
  type StayAdjustmentMode,
} from '@/lib/booking-stay'

type BookingCharge = {
  chargeType: string
  amount: number
  quantity: number
}

type RestaurantOrderRow = {
  subtotal: number
  discount: number
  vatAmount: number
  totalAmount: number
}

export type CheckoutSettlementParams = {
  booking: {
    checkIn: Date
    checkOut: Date
    actualCheckIn: Date | null
    totalRoomCharge: number
    vatApplied?: boolean | null
    vatPercent?: number | null
    charges: BookingCharge[]
  }
  nightlyRate: number
  restaurantOrders: RestaurantOrderRow[]
  lateCheckoutCharge: number
  payments: { amount: number; paymentType: string }[]
  discountEnabled?: boolean
  discountType?: string | null
  discountValue?: number
  includeExtraCharges?: boolean
  /** Pending damage charge for preview (not yet saved) or explicit amount to include. */
  damageChargeAmount?: number
  asOf?: Date
}

export type CheckoutSettlementResult = {
  bookedNights: number
  actualStayNights: number
  chargeableNights: number
  stayAdjustmentMode: StayAdjustmentMode | null
  nightlyRate: number
  bookedRoomCharge: number
  roomCharges: number
  stayAdjusted: boolean
  includeExtraCharges: boolean
  extraChargesStored: number
  lateCheckoutCharge: number
  extraChargesIfIncluded: number
  extraCharges: number
  damageCharge: number
  foodCharges: number
  subtotal: number
  discount: number
  vatApplied: boolean
  vatPercent: number
  vatAmount: number
  restaurantVat: number
  hotelVat: number
  totalAmount: number
  totalPaid: number
  dueBeforeSettlement: number
  creditAmount: number
}

function sumDamageFromCharges(charges: BookingCharge[]): number {
  return charges
    .filter((c) => c.chargeType === 'DAMAGE')
    .reduce((sum, c) => sum + c.amount * c.quantity, 0)
}

function sumNonRoomCharges(charges: BookingCharge[], excludeLate = false): number {
  return charges
    .filter(
      (c) =>
        c.chargeType !== 'ROOM_RATE' &&
        c.chargeType !== 'DAMAGE' &&
        (!excludeLate || c.chargeType !== 'LATE_CHECKOUT')
    )
    .reduce((sum, c) => sum + c.amount * c.quantity, 0)
}

function sumLateFromCharges(charges: BookingCharge[]): number {
  return charges
    .filter((c) => c.chargeType === 'LATE_CHECKOUT')
    .reduce((sum, c) => sum + c.amount * c.quantity, 0)
}

export function computeCheckoutSettlement(
  params: CheckoutSettlementParams
): CheckoutSettlementResult {
  const asOf = params.asOf ?? new Date()
  const { booking, nightlyRate, restaurantOrders, lateCheckoutCharge, payments } = params
  const includeExtraCharges = params.includeExtraCharges !== false

  const bookedNights = countBookedNights(booking.checkIn, booking.checkOut)
  const bookedRoomCharge = computeAdjustedRoomCharge(nightlyRate, bookedNights)

  const actualCheckIn = booking.actualCheckIn ?? booking.checkIn
  const actualStayNights = countActualStayNights(actualCheckIn, asOf)

  const individualRoomCharges = booking.charges
    .filter((c) => c.chargeType === 'ROOM_RATE')
    .reduce((sum, c) => sum + c.amount * c.quantity, 0)

  const roomCharges =
    individualRoomCharges > 0 ? individualRoomCharges : booking.totalRoomCharge

  const chargeableNights =
    nightlyRate > 0 && roomCharges > 0
      ? Math.max(1, Math.round(roomCharges / nightlyRate))
      : bookedNights

  const stayAdjusted = chargeableNights !== bookedNights
  const stayAdjustmentMode: StayAdjustmentMode | null = stayAdjusted
    ? chargeableNights < bookedNights
      ? 'shrink'
      : 'extend'
    : null

  const lateInDb = sumLateFromCharges(booking.charges)
  const damageInDb = sumDamageFromCharges(booking.charges)
  const otherExtras = sumNonRoomCharges(booking.charges, true)
  const lateWouldBe = lateInDb > 0 ? lateInDb : lateCheckoutCharge
  const pendingDamage = Math.max(0, params.damageChargeAmount ?? 0)
  const damageCharge = damageInDb > 0 ? damageInDb : pendingDamage
  const extraChargesIfIncluded = otherExtras + lateWouldBe
  const lateApplied = includeExtraCharges ? lateWouldBe : 0
  const extraCharges = (includeExtraCharges ? extraChargesIfIncluded : 0) + damageCharge

  const restaurantNet = restaurantOrders.reduce(
    (sum, order) => sum + Math.max(0, order.subtotal - order.discount),
    0
  )
  const restaurantVat = restaurantOrders.reduce((sum, order) => sum + order.vatAmount, 0)
  const restaurantTotal = restaurantOrders.reduce((sum, order) => sum + order.totalAmount, 0)
  const foodCharges = restaurantNet

  const hotelBase = roomCharges + extraCharges
  const subtotal = hotelBase + restaurantNet
  const vatOpts = bookingVatOptions(booking)
  const vatApplied = vatOpts.vatApplied !== false
  const hotelVatRate = vatApplied ? Math.max(0, vatOpts.vatPercent ?? 0) : 0
  const discount = computeHotelDiscountAmount(
    hotelBase,
    params.discountEnabled === true,
    parseBookingDiscountType(params.discountType),
    Number(params.discountValue) || 0
  )
  const hotelVat =
    hotelVatRate > 0 ? ((hotelBase - discount) * hotelVatRate) / 100 : 0
  const vatAmount = hotelVat + restaurantVat
  const totalAmount = hotelBase - discount + hotelVat + restaurantTotal

  const totalPaid = sumBookingNetPaid(payments)
  const dueBeforeSettlement = totalAmount - totalPaid
  const creditAmount = dueBeforeSettlement < 0 ? Math.abs(dueBeforeSettlement) : 0

  return {
    bookedNights,
    actualStayNights,
    chargeableNights,
    stayAdjustmentMode,
    nightlyRate,
    bookedRoomCharge,
    roomCharges,
    stayAdjusted,
    includeExtraCharges,
    extraChargesStored: otherExtras,
    lateCheckoutCharge: lateWouldBe,
    extraChargesIfIncluded,
    extraCharges,
    damageCharge,
    foodCharges,
    subtotal,
    discount,
    vatApplied,
    vatPercent: hotelVatRate,
    vatAmount,
    restaurantVat,
    hotelVat,
    totalAmount,
    totalPaid,
    dueBeforeSettlement: Math.max(0, dueBeforeSettlement),
    creditAmount,
  }
}

/** Room VAT-inclusive due after stay adjustment (for updating booking.dueAmount). */
export function bookingDueAfterPayments(
  totalRoomCharge: number,
  totalPaid: number,
  booking: { vatApplied?: boolean | null; vatPercent?: number | null }
): number {
  return computeRoomBookingTotals(
    totalRoomCharge,
    totalPaid,
    bookingVatOptions(booking)
  ).dueAmount
}
