/** Bangladesh Taka symbol (Unicode U+09F3) — escaped to avoid file encoding issues. */
export const TAKA_SYMBOL = '\u09F3'

/** Format amount with ৳ prefix, e.g. ৳11,000 */
export function formatBdt(amount: number): string {
  const value = Number.isFinite(amount) ? amount : 0
  return `${TAKA_SYMBOL}${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

/** ASCII-safe BDT label for jsPDF (Helvetica lacks the ৳ glyph). */
export function formatBdtForPdf(amount: number): string {
  const value = Number.isFinite(amount) ? amount : 0
  return `BDT ${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}
