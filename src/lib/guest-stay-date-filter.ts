import { startOfDay } from 'date-fns'
import { Prisma } from '@prisma/client'

export type StayDateRange = {
  start: Date
  end: Date
}

export function parseStayDateRange(
  dateFrom: string | null,
  dateTo: string | null
): StayDateRange | null {
  let start: Date | null = null
  let end: Date | null = null

  if (dateFrom) {
    const parsed = new Date(dateFrom)
    if (!Number.isNaN(parsed.getTime())) {
      parsed.setHours(0, 0, 0, 0)
      start = parsed
    }
  }
  if (dateTo) {
    const parsed = new Date(dateTo)
    if (!Number.isNaN(parsed.getTime())) {
      parsed.setHours(23, 59, 59, 999)
      end = parsed
    }
  }

  if (!start && !end) return null
  return {
    start: start ?? new Date(0),
    end: end ?? new Date(8640000000000000),
  }
}

export type StayBoundsSource = {
  checkIn: Date | string
  checkOut: Date | string
  actualCheckIn?: Date | string | null
  actualCheckOut?: Date | string | null
  status: string
}

/** First calendar day the guest is in-house (arrival day). */
export function getGuestArrivalCalendarDay(booking: StayBoundsSource): Date {
  if (booking.status === 'CHECKED_IN' || booking.status === 'CHECKED_OUT') {
    return startOfDay(new Date(booking.actualCheckIn ?? booking.checkIn))
  }
  return startOfDay(new Date(booking.checkIn))
}

/** Last calendar day the guest is in-house (departure day, inclusive until checkout). */
export function getGuestDepartureCalendarDay(booking: StayBoundsSource): Date {
  if (booking.status === 'CHECKED_OUT' && booking.actualCheckOut) {
    return startOfDay(new Date(booking.actualCheckOut))
  }
  return startOfDay(new Date(booking.checkOut))
}

/**
 * Daily in-house report: guest appears on every calendar day they occupy a room,
 * from arrival day through departure day — not only on the day they checked in.
 *
 * Example: checked in yesterday, checkout in 2 days → on yesterday's list,
 * today's list, and each day until checkout. Check-in column still shows real check-in time.
 */
export function guestStayOverlapsRange(
  booking: StayBoundsSource,
  dateFrom: string | null,
  dateTo: string | null
): boolean {
  if (booking.status === 'CANCELLED') return false

  const range = parseStayDateRange(dateFrom, dateTo)
  if (!range) return true

  const arrivalDay = getGuestArrivalCalendarDay(booking)
  const departureDay = getGuestDepartureCalendarDay(booking)
  const filterStartDay = startOfDay(range.start)
  const filterEndDay = startOfDay(range.end)

  return arrivalDay <= filterEndDay && departureDay >= filterStartDay
}

export function pickGuestStayBooking<T extends StayBoundsSource>(
  bookings: T[],
  dateFrom: string | null,
  dateTo: string | null,
  hasDateFilter: boolean
): T | null {
  const candidates = hasDateFilter
    ? bookings.filter((b) => guestStayOverlapsRange(b, dateFrom, dateTo))
    : bookings.filter((b) => b.status !== 'CANCELLED')

  if (!candidates.length) return null

  const statusRank = (status: string) => {
    if (status === 'CHECKED_IN') return 0
    if (status === 'RESERVED') return 1
    return 2
  }

  return [...candidates].sort((a, b) => {
    const rankDiff = statusRank(a.status) - statusRank(b.status)
    if (rankDiff !== 0) return rankDiff
    const aStart = getGuestArrivalCalendarDay(a).getTime()
    const bStart = getGuestArrivalCalendarDay(b).getTime()
    return aStart - bStart
  })[0]
}

/** Prisma filter: guest occupied the hotel on at least one day in the period. */
export function buildGuestStayOverlapWhere(
  dateFrom: string | null,
  dateTo: string | null
): Prisma.BookingWhereInput | null {
  const range = parseStayDateRange(dateFrom, dateTo)
  if (!range) return null

  const { start, end } = range

  const scheduledInHouse = {
    checkIn: { lte: end },
    checkOut: { gte: start },
  }

  return {
    status: { not: 'CANCELLED' },
    OR: [
      {
        status: 'CHECKED_IN',
        OR: [
          {
            AND: [
              { actualCheckIn: { not: null } },
              { actualCheckIn: { lte: end } },
              { checkOut: { gte: start } },
            ],
          },
          {
            AND: [{ actualCheckIn: null }, scheduledInHouse],
          },
        ],
      },
      {
        status: 'RESERVED',
        ...scheduledInHouse,
      },
      {
        status: 'CHECKED_OUT',
        AND: [
          { actualCheckIn: { not: null } },
          { actualCheckOut: { not: null } },
          { actualCheckIn: { lte: end } },
          { actualCheckOut: { gte: start } },
        ],
      },
      {
        status: 'CHECKED_OUT',
        OR: [{ actualCheckIn: null }, { actualCheckOut: null }],
        ...scheduledInHouse,
      },
    ],
  }
}
