export const DEPOSIT_METHOD_OPTIONS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK', label: 'Bank' },
  { value: 'CARD', label: 'Card' },
  { value: 'BKASH', label: 'bKash' },
  { value: 'NAGAD', label: 'Nagad' },
  { value: 'UPAY', label: 'Upay' },
] as const

export type DepositMethodValue = (typeof DEPOSIT_METHOD_OPTIONS)[number]['value']

const LAST_FOUR_METHODS = new Set<DepositMethodValue>(['CARD', 'BKASH', 'NAGAD', 'UPAY'])

export function depositRequiresBank(method: string): boolean {
  return method === 'BANK'
}

export function depositRequiresLastFour(method: string): boolean {
  return LAST_FOUR_METHODS.has(method as DepositMethodValue)
}

export function isValidAccountLastFour(value: string): boolean {
  return /^\d{4}$/.test(value.trim())
}

export function formatDepositMethodLabel(method: string): string {
  const match = DEPOSIT_METHOD_OPTIONS.find((o) => o.value === method)
  if (match) return match.label
  return method.replace(/_/g, ' ')
}

export function formatDepositMethodDetail(
  method: string,
  bankName?: string | null,
  accountLastFour?: string | null
): string | null {
  if (method === 'BANK' && bankName) return bankName
  if (depositRequiresLastFour(method) && accountLastFour) return `****${accountLastFour}`
  return null
}
