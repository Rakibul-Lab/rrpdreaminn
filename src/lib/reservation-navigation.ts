export function openNewReservationTab() {
  if (typeof window === 'undefined') return
  window.open('/reservations/new', '_blank', 'noopener,noreferrer')
}

export function openRegistrationFormTab() {
  if (typeof window === 'undefined') return
  window.open('/registration-form', '_blank', 'noopener,noreferrer')
}
