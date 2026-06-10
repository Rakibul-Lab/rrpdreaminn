import { format } from 'date-fns'
import { jsPDF } from 'jspdf'
import { HOTEL_NAME } from './reservation-terms'
import { getLogoDataUrl } from './reservation-document-html'
import { formatBdtForPdf } from './currency'
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

export type RestaurantOrderExportRecord = {
  orderNumber: string
  orderType: string
  status: string
  totalAmount: number
  createdAt: string
  customerName?: string | null
  room?: { roomNumber: string } | null
  table?: { tableNumber: string } | null
  items?: { quantity: number }[]
}

export type RestaurantOrdersExportMeta = {
  exportedAt?: Date
  generatedBy?: { name: string; email?: string; role?: string }
  datePreset?: BookingDatePreset
  customDateFrom?: string
  customDateTo?: string
  orderType?: string
  status?: string
  sort?: string
  search?: string
}

const ORDER_TYPE_LABELS: Record<string, string> = {
  DINE_IN: 'Dine-in',
  TAKEAWAY: 'Takeaway',
  ROOM_SERVICE: 'Room Service',
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  COOKING: 'Cooking',
  READY: 'Ready',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
}

function formatGeneratedBy(user?: RestaurantOrdersExportMeta['generatedBy']): string {
  if (!user?.name) return '—'
  if (user.email) return `${user.name} (${user.email})`
  return user.name
}

function locationLabel(order: RestaurantOrderExportRecord): string {
  if (order.orderType === 'DINE_IN' && order.table) return `Table ${order.table.tableNumber}`
  if (order.orderType === 'ROOM_SERVICE' && order.room) return `Room ${order.room.roomNumber}`
  if (order.orderType === 'TAKEAWAY' && order.customerName) return order.customerName
  return '—'
}

function mapOrderRow(order: RestaurantOrderExportRecord): Record<string, string> {
  const at = new Date(order.createdAt)
  return {
    'Order #': order.orderNumber,
    'Date & Time': format(at, 'dd MMM yyyy, HH:mm'),
    Type: ORDER_TYPE_LABELS[order.orderType] ?? order.orderType,
    'Table/Room': locationLabel(order),
    Items: String(order.items?.length ?? 0),
    Total: formatBdtForPdf(order.totalAmount),
    Status: STATUS_LABELS[order.status] ?? order.status,
  }
}

export function restaurantOrdersExportFileName(): string {
  return `restaurant-orders-${format(new Date(), 'yyyy-MM-dd-HHmm')}.pdf`
}

export function buildRestaurantOrdersExportQuery(
  filters: {
    status?: string
    orderType?: string
    dateFrom?: string
    dateTo?: string
    sort?: string
  },
  limit = 5000
): string {
  const params = new URLSearchParams()
  params.set('page', '1')
  params.set('limit', String(limit))
  if (filters.status && filters.status !== 'ALL') {
    params.set('status', filters.status)
  }
  if (filters.orderType && filters.orderType !== 'all') {
    params.set('orderType', filters.orderType)
  }
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
  if (filters.dateTo) params.set('dateTo', filters.dateTo)
  if (filters.sort) params.set('sort', filters.sort)
  return `/restaurant-orders?${params.toString()}`
}

async function loadExportLogo(): Promise<{ dataUrl: string } | null> {
  try {
    const dataUrl = await getLogoDataUrl()
    return { dataUrl }
  } catch {
    return null
  }
}

export async function downloadRestaurantOrdersPdf(
  orders: RestaurantOrderExportRecord[],
  meta: RestaurantOrdersExportMeta = {}
): Promise<void> {
  if (!orders.length) {
    throw new Error('No orders to export')
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
    meta.datePreset ?? 'today',
    meta.customDateFrom,
    meta.customDateTo
  )
  const typeLabel =
    !meta.orderType || meta.orderType === 'all' ? 'All types' : ORDER_TYPE_LABELS[meta.orderType] ?? meta.orderType
  const statusLabel =
    !meta.status || meta.status === 'ALL'
      ? 'All statuses'
      : STATUS_LABELS[meta.status] ?? meta.status
  const sortLabel = meta.sort === 'oldest' ? 'Oldest first' : 'Newest first'
  const searchLabel = meta.search?.trim() ? meta.search.trim() : '—'

  const logoSize = 12
  const headerY = marginTop
  const headerGap = 4

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(16)
  const nameWidth = pdf.getTextWidth(HOTEL_NAME)
  pdf.setFontSize(12)
  const subtitleWidth = pdf.getTextWidth('Restaurant Orders Report')
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
    pdf.text('Restaurant Orders Report', blockStartX + logoSize + headerGap, headerY + 10)
  } else {
    pdf.text(HOTEL_NAME, pageWidth / 2, headerY + 7, { align: 'center' })
    pdf.setFontSize(12)
    pdf.text('Restaurant Orders Report', pageWidth / 2, headerY + 14, { align: 'center' })
  }

  y = headerY + (logo ? logoSize : 14) + 4

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  pdf.text(`Exported: ${format(exportedAt, 'dd MMM yyyy, HH:mm')}`, marginX, y)
  y += 4
  pdf.text(`Generated by: ${formatGeneratedBy(meta.generatedBy)}`, marginX, y)
  y += 4
  pdf.text(`Date range: ${dateLabel}`, marginX, y)
  y += 4
  pdf.text(`Type: ${typeLabel}  |  Status: ${statusLabel}  |  Sort: ${sortLabel}`, marginX, y)
  y += 4
  pdf.text(`Search: ${searchLabel}  |  Total records: ${orders.length}`, marginX, y)
  y += 6

  const tableWidth = pageWidth - marginX * 2
  const columnDefs: Omit<PdfColumn, 'width'>[] = [
    { header: 'Order #', baseWidth: 36, value: (r) => r['Order #'] },
    { header: 'Date & Time', baseWidth: 30, value: (r) => r['Date & Time'] },
    { header: 'Type', baseWidth: 20, value: (r) => r.Type },
    { header: 'Table/Room', baseWidth: 26, value: (r) => r['Table/Room'] },
    { header: 'Items', baseWidth: 16, value: (r) => r.Items, align: 'right' },
    { header: 'Total', baseWidth: 26, value: (r) => r.Total, align: 'right' },
    { header: 'Status', baseWidth: 22, value: (r) => r.Status },
  ]
  const baseWidthSum = columnDefs.reduce((sum, col) => sum + col.baseWidth, 0)
  const columns: PdfColumn[] = columnDefs.map((col) => ({
    ...col,
    width: (col.baseWidth / baseWidthSum) * tableWidth,
  }))

  const rows = orders.map(mapOrderRow)
  const totalAmount = orders.reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0)

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

  const totalColIndex = columns.findIndex((col) => col.header === 'Total')
  const itemsColIndex = columns.findIndex((col) => col.header === 'Items')

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
  pdf.text('Grand total', columnLeftX(itemsColIndex) + PDF_CELL_PAD, y)
  drawRightAlignedInColumn(formatBdtForPdf(totalAmount), totalColIndex, y)
  pdf.setFont('helvetica', 'normal')

  pdf.save(restaurantOrdersExportFileName())
}
