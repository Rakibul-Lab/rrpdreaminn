export function openCompanyLedgerCompanyViewTab(companyId: string) {
  if (typeof window === 'undefined') return
  window.open(`/company-ledger/company/${companyId}`, '_blank', 'noopener,noreferrer')
}

export function openCompanyLedgerGuestHistoryTab(guestId: string) {
  if (typeof window === 'undefined') return
  window.open(`/company-ledger/guest/${guestId}`, '_blank', 'noopener,noreferrer')
}
