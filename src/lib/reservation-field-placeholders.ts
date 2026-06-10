/** Placeholder shown on reservation documents when a required field is missing (initial reservations). */
export const RESERVATION_REQUIRED_PLACEHOLDER = '[Required — not provided]'

export function reservationDocValue(
  value: string | null | undefined,
  required = false
): string {
  const trimmed = value?.trim()
  if (trimmed) return trimmed
  return required ? RESERVATION_REQUIRED_PLACEHOLDER : '—'
}

export function reservationIdLabel(
  idType: string | null | undefined,
  idNumber: string | null | undefined,
  options?: { requiredWhenMissing?: boolean }
): string {
  const typeLabel =
    idType === 'passport'
      ? 'Passport'
      : idType === 'driving_license'
        ? 'Driving License'
        : idType === 'national_id'
          ? 'National ID (NID)'
          : idType || null

  const number = idNumber?.trim()
  if (typeLabel && number) return `${typeLabel} — ${number}`
  if (number) return number
  if (typeLabel && options?.requiredWhenMissing) {
    return `${typeLabel} — ${RESERVATION_REQUIRED_PLACEHOLDER}`
  }
  if (options?.requiredWhenMissing) return RESERVATION_REQUIRED_PLACEHOLDER
  return '—'
}
