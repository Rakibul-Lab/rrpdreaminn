import { BOOKING_DATE_PRESET_OPTIONS, type BookingDatePreset } from './booking-date-filter'

export type OrderDatePreset = Exclude<BookingDatePreset, 'all'>

export const ORDER_DATE_PRESET_OPTIONS = BOOKING_DATE_PRESET_OPTIONS.filter(
  (opt): opt is { value: OrderDatePreset; label: string } => opt.value !== 'all'
)
