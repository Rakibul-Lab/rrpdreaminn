const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
]

const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function wordsUnder1000(n: number): string {
  if (n === 0) return ''
  if (n < 20) return ONES[n]
  if (n < 100) {
    const tens = Math.floor(n / 10)
    const ones = n % 10
    return `${TENS[tens]}${ones ? ` ${ONES[ones]}` : ''}`.trim()
  }
  const hundreds = Math.floor(n / 100)
  const rest = n % 100
  const restWords = wordsUnder1000(rest)
  return `${ONES[hundreds]} Hundred${restWords ? ` ${restWords}` : ''}`
}

function integerToWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) return ''
  if (n === 0) return 'Zero'

  const crore = Math.floor(n / 10_000_000)
  const lakh = Math.floor((n % 10_000_000) / 100_000)
  const thousand = Math.floor((n % 100_000) / 1000)
  const rest = n % 1000

  const parts: string[] = []
  if (crore) parts.push(`${wordsUnder1000(crore)} Crore`)
  if (lakh) parts.push(`${wordsUnder1000(lakh)} Lakh`)
  if (thousand) parts.push(`${wordsUnder1000(thousand)} Thousand`)
  if (rest) parts.push(wordsUnder1000(rest))

  return parts.join(' ')
}

/** e.g. 6325 → "Six Thousand Three Hundred Twenty Five Taka Only" */
export function formatAmountInWords(amount: number): string {
  const value = Number.isFinite(amount) ? Math.round(amount) : 0
  const words = integerToWords(value)
  return `${words} Taka Only`
}
