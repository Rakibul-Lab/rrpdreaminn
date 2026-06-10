import { isKnownNationality } from '@/lib/nationalities'

/** Fields required when completing an initial reservation or checking in. */
export function getCompleteReservationMissingFields(guest: {
  nationality: string
  idNumber: string
  email: string
  address: string
  registrationNumber: string
  idDocumentCount: number
}): string[] {
  const missing: string[] = []
  if (!isKnownNationality(guest.nationality)) missing.push('Nationality')
  if (!guest.idNumber.trim()) missing.push('NID / Passport number')
  if (!guest.email.trim()) missing.push('Email')
  if (!guest.address.trim()) missing.push('Address')
  if (!guest.registrationNumber.trim()) missing.push('Registration number')
  if (guest.idDocumentCount === 0) missing.push('ID document image')
  return missing
}

/** Fields required for an initial reservation (name, phone, nationality). */
export function getInitialReservationMissingFields(guest: {
  guestName: string
  guestPhone: string
  guestNationality: string
}): string[] {
  const missing: string[] = []
  if (!guest.guestName.trim()) missing.push('Full name')
  if (!guest.guestPhone.trim()) missing.push('Phone')
  if (!isKnownNationality(guest.guestNationality)) missing.push('Nationality')
  return missing
}

export function isReservationGuestProfileComplete(
  customer: {
    nationality?: string | null
    idNumber?: string | null
    email?: string | null
    address?: string | null
    registrationNumber?: string | null
  },
  idDocumentCount: number
): boolean {
  return (
    getCompleteReservationMissingFields({
      nationality: customer.nationality ?? '',
      idNumber: customer.idNumber ?? '',
      email: customer.email ?? '',
      address: customer.address ?? '',
      registrationNumber: customer.registrationNumber ?? '',
      idDocumentCount,
    }).length === 0
  )
}
