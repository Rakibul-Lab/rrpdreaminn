import { format } from 'date-fns'
import { jsPDF } from 'jspdf'
import { HOTEL_NAME } from './reservation-terms'
import { getLogoDataUrl } from './reservation-document-html'
import { formatBdtForPdf } from './currency'
import {
  formatDepositMethodDetail,
  formatDepositMethodLabel,
} from './deposit-form'
import {
  formatBookingDateFilterLabel,
  type BookingDatePreset,
} from './booking-date-filter'

const PDF_LINE_HEIGHT = 3.6
const PDF_CELL_PAD = 1.5

type PdfColumn = {
  header: string
  baseWidth: number
  width: number
  value: (r: Record<string, string>) => string
  align?: 'right'
}

export type DepositExportRecord = {
  id: string
  amount: number
  method: string
  bankName?: string | null
  accountLastFour?: string | null
  reference?: string | null
  notes?: string | null
  depositedAt: string
  depositor?: { name: string } | null
}

export type DepositsExportMeta = {
  exportedAt?: Date
  generatedBy?: { name: string; email?: string; role?: string }
  datePreset?: BookingDatePreset
  customDateFrom?: string
  customDateTo?: string
  method?: string
  search?: string
}

function formatGeneratedBy(user?: DepositsExportMeta['generatedBy']): string {
  if (!user?.name) return '—'
  if (user.email) return `${user.name} (${user.email})`
  return user.name
}

function mapDepositRow(deposit: DepositExportRecord): Record<string, string> {
  const at = new Date(deposit.depositedAt)
  return {
    Date: format(at, 'dd MMM yyyy'),
    Time: format(at, 'HH:mm'),
    Method: formatDepositMethodLabel(deposit.method),
    'Bank / Account':
      formatDepositMethodDetail(
        deposit.method,
        deposit.bankName,
        deposit.accountLastFour
      ) || '—',
    Amount: formatBdtForPdf(deposit.amount),
    Reference: deposit.reference ?? '',
    'Recorded By': deposit.depositor?.name ?? '—',
    Notes: deposit.notes ?? '',
  }
}

export function depositsExportFileName(): string {
  return `deposits-${format(new Date(), 'yyyy-MM-dd-HHmm')}.pdf`
}

export function buildDepositsExportQuery(
  filters: {
    method?: string
    search?: string
    dateFrom?: string
    dateTo?: string
  },
  limit = 5000
): string {
  const params = new URLSearchParams()
  params.set('page', '1')
  params.set('limit', String(limit))
  if (filters.method && filters.method !== 'all') {
    params.set('method', filters.method)
  }
  if (filters.search?.trim()) {
    params.set('search', filters.search.trim())
  }
  if (filters.dateFrom) params.set('startDate', filters.dateFrom)
  if (filters.dateTo) params.set('endDate', filters.dateTo)
  return `/deposits?${params.toString()}`
}

async function loadExportLogo(): Promise<{ dataUrl: string; base64: string } | null> {
  try {
    const dataUrl = await getLogoDataUrl()
    const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1]! : dataUrl
    return { dataUrl, base64 }
  } catch {
    return null
  }
}

export async function downloadDepositsPdf(
  deposits: DepositExportRecord[],
  meta: DepositsExportMeta = {}
): Promise<void> {
  if (!deposits.length) {
    throw new Error('No deposits to export')
  }

  const logo = await loadExportLogo()
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape', compress: true })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const marginX = 10
  const marginTop = 10
  const marginBottom = 10
  let y = marginTop

  const exportedAt = meta.exportedAt ?? new Date()
  const dateLabel = formatBookingDateFilterLabel(
    meta.datePreset ?? 'all',
    meta.customDateFrom,
    meta.customDateTo
  )
  const methodLabel =
    !meta.method || meta.method === 'all'
      ? 'All methods'
      : formatDepositMethodLabel(meta.method)
  const searchLabel = meta.search?.trim() ? meta.search.trim() : '—'

  const logoSize = 12
  const headerY = marginTop
  const headerGap = 4

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(16)
  const nameWidth = pdf.getTextWidth(HOTEL_NAME)
  pdf.setFontSize(12)
  const subtitleWidth = pdf.getTextWidth('Deposits Report')
  const textWidth = Math.max(nameWidth, subtitleWidth)
  const blockWidth = (logo ? logoSize + headerGap : 0) + textWidth
  const blockStartX = (pageWidth - blockWidth) / 2

  if (logo) {
    pdf.addImage(logo.dataUrl, 'PNG', blockStartX, headerY, logoSize, logoSize)
  }

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(16)
  if (logo) {
    pdf.text(HOTEL_NAME, blockStartX + logoSize + headerGap, headerY + 5)
    pdf.setFontSize(12)
    pdf.text('Deposits Report', blockStartX + logoSize + headerGap, headerY + 10)
  } else {
    pdf.text(HOTEL_NAME, pageWidth / 2, headerY + 7, { align: 'center' })
    pdf.setFontSize(12)
    pdf.text('Deposits Report', pageWidth / 2, headerY + 14, { align: 'center' })
  }

  y = headerY + (logo ? logoSize : 14) + 4

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  pdf.text(`Exported: ${format(exportedAt, 'dd MMM yyyy, HH:mm')}`, marginX, y)
  y += 4
  pdf.text(`Generated by: ${formatGeneratedBy(meta.generatedBy)}`, marginX, y)
  y += 4
  pdf.text(`Date: ${dateLabel}`, marginX, y)
  y += 4
  pdf.text(`Method: ${methodLabel}  |  Search: ${searchLabel}`, marginX, y)
  y += 4
  pdf.text(`Total records: ${deposits.length}`, marginX, y)
  y += 6

  const tableWidth = pageWidth - marginX * 2
  const columnDefs: Omit<PdfColumn, 'width'>[] = [
    { header: 'Date', baseWidth: 24, value: (r) => r.Date },
    { header: 'Time', baseWidth: 14, value: (r) => r.Time },
    { header: 'Method', baseWidth: 18, value: (r) => r.Method },
    { header: 'Bank / Account', baseWidth: 34, value: (r) => r['Bank / Account'] },
    { header: 'Amount', baseWidth: 24, value: (r) => r.Amount, align: 'right' },
    { header: 'Reference', baseWidth: 26, value: (r) => r.Reference || '—' },
    { header: 'Recorded By', baseWidth: 28, value: (r) => r['Recorded By'] },
    { header: 'Notes', baseWidth: 32, value: (r) => r.Notes || '—' },
  ]
  const baseWidthSum = columnDefs.reduce((sum, col) => sum + col.baseWidth, 0)
  const columns: PdfColumn[] = columnDefs.map((col) => ({
    ...col,
    width: (col.baseWidth / baseWidthSum) * tableWidth,
  }))
  const amountColIndex = columns.findIndex((col) => col.header === 'Amount')

  const rows = deposits.map(mapDepositRow)
  const totalAmount = deposits.reduce((sum, d) => sum + (Number(d.amount) || 0), 0)

  const columnLeftX = (index: number) => {
    let x = marginX
    for (let i = 0; i < index; i++) x += columns[i].width
    return x
  }

  const columnRightX = (index: number) => columnLeftX(index) + columns[index].width - PDF_CELL_PAD

  const drawRightAlignedInColumn = (text: string, colIndex: number, baselineY: number) => {
    const rightX = columnRightX(colIndex)
    const textWidth = pdf.getTextWidth(text)
    pdf.text(text, rightX - textWidth, baselineY)
  }

  const drawHeader = () => {
    pdf.setFillColor(245, 245, 245)
    pdf.rect(marginX, y - 4.5, tableWidth, 7, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(7)
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i]
      if (col.align === 'right') {
        drawRightAlignedInColumn(col.header, i, y)
      } else {
        pdf.text(col.header, columnLeftX(i) + PDF_CELL_PAD, y)
      }
    }
    y += 7
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(6.5)
  }

  drawHeader()

  for (const row of rows) {
    const lines = columns.map((col, index) => {
      const value = col.value(row)
      if (col.align === 'right') return [value]
      return pdf.splitTextToSize(
        value,
        Math.max(columns[index].width - PDF_CELL_PAD * 2, 8)
      )
    })
    const maxLines = Math.max(...lines.map((l) => l.length), 1)
    const rowHeight = maxLines * PDF_LINE_HEIGHT + 1.5

    if (y + rowHeight > pageHeight - marginBottom - 10) {
      pdf.addPage()
      y = marginTop
      drawHeader()
    }

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i]
      if (col.align === 'right') {
        drawRightAlignedInColumn(lines[i][0] ?? '', i, y)
      } else {
        pdf.text(lines[i], columnLeftX(i) + PDF_CELL_PAD, y)
      }
    }
    y += rowHeight
  }

  const totalsRowHeight = PDF_LINE_HEIGHT + 3
  if (y + totalsRowHeight > pageHeight - marginBottom) {
    pdf.addPage()
    y = marginTop
    drawHeader()
  }

  y += 2
  pdf.setFillColor(255, 251, 235)
  pdf.rect(marginX, y - 4, tableWidth, totalsRowHeight + 1, 'F')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(6.5)

  pdf.text('Total', columnLeftX(0) + PDF_CELL_PAD, y)
  drawRightAlignedInColumn(formatBdtForPdf(totalAmount), amountColIndex, y)
  pdf.setFont('helvetica', 'normal')

  pdf.save(depositsExportFileName())
}
