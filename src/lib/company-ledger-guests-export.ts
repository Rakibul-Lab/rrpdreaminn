import { format } from 'date-fns'
import { jsPDF } from 'jspdf'
import { formatGuestId } from './id-type-label'
import { formatBdtForPdf } from './currency'
import { HOTEL_NAME } from './reservation-terms'
import { getLogoDataUrl } from './reservation-document-html'
import {
  formatBookingDateFilterLabel,
  type BookingDatePreset,
} from './booking-date-filter'
import {
  formatListBookingCheckIn,
  formatListBookingCheckOut,
  type BookingListDatetimeFields,
  type HotelTimes,
  DEFAULT_HOTEL_TIMES,
} from './hotel-times'

export type CompanyLedgerGuestExportRecord = {
  guestName: string
  phone?: string | null
  email?: string | null
  nationality?: string | null
  registrationNumber?: string | null
  address?: string | null
  idType?: string | null
  idNumber?: string | null
  totalDue: number
  totalBill: number
  latestStayCheckIn?: string | null
  displayStay?: (BookingListDatetimeFields & { status: string }) | null
}

export type CompanyLedgerGuestsExportMeta = {
  companyName: string
  companyBilled?: number
  companyPaid?: number
  companyDue?: number
  datePreset: BookingDatePreset
  customDateFrom?: string
  customDateTo?: string
  exportedAt?: Date
  generatedBy?: {
    name: string
    email?: string
    role?: string
  }
}

function formatGeneratedBy(user?: CompanyLedgerGuestsExportMeta['generatedBy']): string {
  if (!user?.name) return '—'
  if (user.email) return `${user.name} (${user.email})`
  return user.name
}

function companyGuestsExportFileName(companyName: string): string {
  const safe = companyName.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 40)
  const stamp = format(new Date(), 'yyyy-MM-dd-HHmm')
  return `company-guests-${safe || 'report'}-${stamp}.pdf`
}

async function loadExportLogo(): Promise<{ dataUrl: string } | null> {
  try {
    const dataUrl = await getLogoDataUrl()
    return { dataUrl }
  } catch {
    return null
  }
}

type PdfColumn = {
  header: string
  width: number
  key: string
  value: (guest: CompanyLedgerGuestExportRecord, times: HotelTimes) => string
}

function buildPdfColumns(): PdfColumn[] {
  return [
    { header: 'Guest', width: 28, key: 'guest', value: (g) => g.guestName },
    { header: 'Phone', width: 22, value: (g) => g.phone ?? '—', key: 'phone' },
    { header: 'Email', width: 30, value: (g) => g.email ?? '—', key: 'email' },
    { header: 'Nationality', width: 20, value: (g) => g.nationality ?? '—', key: 'nationality' },
    { header: 'Reg. no.', width: 20, value: (g) => g.registrationNumber ?? '—', key: 'reg' },
    { header: 'Address', width: 30, value: (g) => g.address ?? '—', key: 'address' },
    {
      header: 'ID',
      width: 24,
      key: 'id',
      value: (g) => formatGuestId(g.idType, g.idNumber),
    },
    {
      header: 'Check-in',
      width: 28,
      key: 'checkin',
      value: (g, times) =>
        g.displayStay ? formatListBookingCheckIn(g.displayStay, times) : '—',
    },
    {
      header: 'Check-out',
      width: 28,
      key: 'checkout',
      value: (g, times) =>
        g.displayStay ? formatListBookingCheckOut(g.displayStay, times) : '—',
    },
    {
      header: 'Total bill',
      width: 20,
      key: 'bill',
      value: (g) => formatBdtForPdf(g.totalBill ?? 0),
    },
    {
      header: 'Due',
      width: 18,
      key: 'due',
      value: (g) => formatBdtForPdf(g.totalDue ?? 0),
    },
  ]
}

const PDF_LINE_HEIGHT = 3.6
const PDF_CELL_PAD = 1.5

function splitCellLines(pdf: jsPDF, text: string, colWidth: number): string[] {
  const content = (text || '—').trim() || '—'
  return pdf.splitTextToSize(content, Math.max(colWidth - PDF_CELL_PAD * 2, 8))
}

function scalePdfColumns(columns: PdfColumn[], targetWidth: number): PdfColumn[] {
  const baseTotal = columns.reduce((sum, col) => sum + col.width, 0)
  if (baseTotal <= 0) return columns
  const scale = targetWidth / baseTotal
  return columns.map((col) => ({ ...col, width: col.width * scale }))
}

export function buildCompanyLedgerGuestsExportQuery(
  companyId: string,
  filters: {
    search?: string
    dateFrom?: string
    dateTo?: string
  }
): string {
  const params = new URLSearchParams()
  if (filters.search) params.set('search', filters.search)
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
  if (filters.dateTo) params.set('dateTo', filters.dateTo)
  const qs = params.toString()
  return `/company-ledger/${companyId}/guests${qs ? `?${qs}` : ''}`
}

export async function downloadCompanyLedgerGuestsPdf(
  guests: CompanyLedgerGuestExportRecord[],
  meta: CompanyLedgerGuestsExportMeta,
  times: HotelTimes = DEFAULT_HOTEL_TIMES
): Promise<void> {
  if (!guests.length) {
    throw new Error('No guests to export')
  }

  const logo = await loadExportLogo()
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape', compress: true })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const marginX = 10
  const marginTop = 10
  const marginBottom = 10
  const headerRowHeight = 7
  let y = marginTop

  const exportedAt = meta.exportedAt ?? new Date()
  const dateLabel = formatBookingDateFilterLabel(
    meta.datePreset,
    meta.customDateFrom,
    meta.customDateTo
  )
  const reportTitle = `${meta.companyName} — Guest List`
  const totalGuestBill = guests.reduce((sum, g) => sum + (g.totalBill ?? 0), 0)
  const totalGuestDue = guests.reduce((sum, g) => sum + (g.totalDue ?? 0), 0)
  const pdfColumnsBase = buildPdfColumns()
  const billColIndex = pdfColumnsBase.findIndex((c) => c.key === 'bill')
  const dueColIndex = pdfColumnsBase.findIndex((c) => c.key === 'due')

  const logoSize = 12
  const headerY = marginTop
  const headerGap = 4

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(16)
  const nameWidth = pdf.getTextWidth(HOTEL_NAME)
  pdf.setFontSize(12)
  const subtitleWidth = pdf.getTextWidth(reportTitle)
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
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(12)
    pdf.text(reportTitle, blockStartX + logoSize + headerGap, headerY + 10)
  } else {
    pdf.text(HOTEL_NAME, pageWidth / 2, headerY + 7, { align: 'center' })
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(12)
    pdf.text(reportTitle, pageWidth / 2, headerY + 14, { align: 'center' })
  }

  y = headerY + logoSize + 6

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  const metaLines = [
    `Generated by: ${formatGeneratedBy(meta.generatedBy)}`,
    `Exported: ${format(exportedAt, 'dd MMM yyyy, HH:mm')}`,
    `Stay date: ${dateLabel}`,
    `Company billed: ${formatBdtForPdf(meta.companyBilled ?? 0)}`,
    `Company paid: ${formatBdtForPdf(meta.companyPaid ?? 0)}`,
    `Company due: ${formatBdtForPdf(meta.companyDue ?? 0)}`,
    `Total guests: ${guests.length}`,
  ]
  for (const line of metaLines) {
    pdf.text(line, marginX, y)
    y += 4
  }
  y += 2

  const tableWidth = pageWidth - marginX * 2
  const pdfColumns = scalePdfColumns(pdfColumnsBase, tableWidth)

  const columnOffsetX = (index: number) =>
    marginX + pdfColumns.slice(0, index).reduce((sum, col) => sum + col.width, 0) + PDF_CELL_PAD

  const drawHeader = () => {
    pdf.setFillColor(240, 240, 240)
    pdf.rect(marginX, y - 4, tableWidth, headerRowHeight, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(7)
    let x = marginX + PDF_CELL_PAD
    for (const col of pdfColumns) {
      pdf.text(col.header, x, y)
      x += col.width
    }
    y += headerRowHeight
    pdf.setFont('helvetica', 'normal')
  }

  const drawTotalsRow = () => {
    const rowHeight = 8
    if (y + rowHeight > pageHeight - marginBottom) {
      pdf.addPage()
      y = marginTop
    }
    pdf.setFillColor(245, 245, 245)
    pdf.rect(marginX, y - 4, tableWidth, rowHeight, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8)
    pdf.text('TOTAL', marginX + PDF_CELL_PAD, y)
    pdf.text(`${guests.length} guest(s)`, columnOffsetX(1), y)
    if (billColIndex >= 0) {
      pdf.text(formatBdtForPdf(totalGuestBill), columnOffsetX(billColIndex), y)
    }
    if (dueColIndex >= 0) {
      pdf.text(formatBdtForPdf(totalGuestDue), columnOffsetX(dueColIndex), y)
    }
    y += rowHeight
  }

  drawHeader()

  for (const guest of guests) {
    const cellLines = pdfColumns.map((col) =>
      splitCellLines(pdf, col.value(guest, times), col.width)
    )
    const rowHeight = Math.max(...cellLines.map((lines) => lines.length * PDF_LINE_HEIGHT)) + 2

    if (y + rowHeight > pageHeight - marginBottom - 10) {
      pdf.addPage()
      y = marginTop
      drawHeader()
    }

    let x = marginX + PDF_CELL_PAD
    for (let i = 0; i < pdfColumns.length; i++) {
      const lines = cellLines[i]
      let lineY = y
      for (const line of lines) {
        pdf.text(line, x, lineY)
        lineY += PDF_LINE_HEIGHT
      }
      x += pdfColumns[i].width
    }
    y += rowHeight
  }

  y += 2
  drawTotalsRow()

  pdf.save(companyGuestsExportFileName(meta.companyName))
}
