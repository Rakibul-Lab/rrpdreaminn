'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Loader2 } from 'lucide-react'
import { api } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import {
  invoicePdfFileName,
  downloadInvoicePdfFromElement,
  openInvoicePdfInNewTab,
} from '@/lib/invoice-pdf'
import { toast } from 'sonner'
import { useHotelTimes } from '@/hooks/use-hotel-times'
import { AppDevelopedByFooter } from '@/components/AppDevelopedByFooter'
import { useAuthStore } from '@/lib/auth-store'
import { countBookedNights } from '@/lib/booking-stay'
import { formatAmountInWords } from '@/lib/amount-in-words'
import { formatBdt } from '@/lib/currency'
import { INVOICE_GUEST_AGREEMENT } from '@/lib/reservation-terms'
import { formatBookingStatusFilterLabel } from '@/lib/booking-date-filter'

export interface InvoicePrintData {
  id: string
  invoiceNumber: string
  roomCharges: number
  foodCharges: number
  extraCharges: number
  subtotal: number
  discount: number
  vatAmount: number
  totalAmount: number
  paidAmount: number
  dueAmount: number
  declaredVatPercent?: number
  createdAt: string
  booking: {
    id: string
    checkIn: string
    checkOut: string
    adults?: number
    children?: number
    status?: string
    company?: string | null
    customer: {
      name: string
      phone: string
      email?: string | null
      address?: string | null
      nationality?: string | null
      idType?: string | null
      idNumber?: string | null
      registrationNumber?: string | null
      company?: string | null
    }
    companyLedger?: {
      name: string
      contactPerson?: string | null
      phone?: string | null
      email?: string | null
      address?: string | null
    } | null
    companyLedgerGuest?: {
      guestName: string
      phone?: string | null
      email?: string | null
      nationality?: string | null
      registrationNumber?: string | null
      address?: string | null
      idType?: string | null
      idNumber?: string | null
    } | null
    creator?: { name: string } | null
    room: { roomNumber: string; type: { name: string; basePrice?: number } }
    restaurantOrders?: Array<{
      id: string
      orderNumber: string
      subtotal: number
      discount: number
      vatPercent: number
      vatAmount: number
      totalAmount: number
      createdAt: string
    }>
  }
  items: Array<{
    id: string
    itemType?: string
    referenceId?: string | null
    description: string
    quantity: number
    unitPrice: number
    total: number
  }>
}

type InvoiceChargeRow = {
  id: string
  date: string
  time: string
  category: string
  description: string
  rate: number
  vatPercent: number | null
  vatAmount: number
  amount: number
}

function splitDisplayDateTime(value: string): { date: string; time: string } {
  const separator = ' · '
  const idx = value.indexOf(separator)
  if (idx === -1) return { date: value, time: '' }
  return { date: value.slice(0, idx), time: value.slice(idx + separator.length) }
}

function chargeDateTime(value: string | Date): { date: string; time: string } {
  const d = new Date(value)
  return splitDisplayDateTime(format(d, 'MMM dd, yyyy · h:mm a'))
}

function calcVatAmount(base: number, percent: number | null): number {
  if (!percent || percent <= 0 || base <= 0) return 0
  return Math.round((base * percent) / 100)
}

function buildChargeRow(
  row: Omit<InvoiceChargeRow, 'vatPercent' | 'vatAmount' | 'amount'> & {
    vatPercent?: number | null
    vatAmount?: number
  }
): InvoiceChargeRow {
  const base = row.rate
  const vatPercent = row.vatPercent ?? null
  const vatAmount = row.vatAmount ?? calcVatAmount(base, vatPercent)
  return {
    ...row,
    vatPercent,
    vatAmount,
    amount: base + vatAmount,
  }
}

const HOTEL_CHARGE_TYPES = new Set(['room_charge', 'extra_service', 'discount'])
const RESTAURANT_CHARGE_TYPES = new Set(['food_order'])

function lineItemCategory(type: string) {
  switch (type) {
    case 'room_charge':
      return ''
    case 'extra_service':
      return 'Extra'
    case 'food_order':
      return 'F&B'
    case 'discount':
      return 'Discount'
    case 'vat_hotel':
      return 'Hotel VAT'
    case 'vat_restaurant':
      return 'Restaurant VAT'
    default:
      return type
  }
}

interface InvoicePrintViewProps {
  invoiceId: string
  showToolbar?: boolean
  title?: string
  successBanner?: string
  onClose?: () => void
}

export function InvoicePrintView({
  invoiceId,
  showToolbar = true,
  title = 'Guest Invoice',
  successBanner,
  onClose,
}: InvoicePrintViewProps) {
  const documentRef = useRef<HTMLElement>(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const { formatCheckIn, formatCheckOut } = useHotelTimes()
  const user = useAuthStore((s) => s.user)

  const { data, isLoading } = useQuery({
    queryKey: ['print-invoice', invoiceId],
    queryFn: () => api.get<{ success: boolean; data: InvoicePrintData }>(`/invoices/${invoiceId}`),
    enabled: !!invoiceId,
  })

  const invoice = data?.data
  const roomBill = invoice?.roomCharges || 0
  const restaurantOrders = invoice?.booking?.restaurantOrders || []
  const restaurantSubtotal = restaurantOrders.reduce((sum, o) => sum + o.subtotal, 0)
  const restaurantDiscount = restaurantOrders.reduce((sum, o) => sum + o.discount, 0)
  const restaurantBill = Math.max(0, restaurantSubtotal - restaurantDiscount)
  const extraBill = invoice?.extraCharges || 0
  const restaurantVat = restaurantOrders.reduce((sum, o) => sum + o.vatAmount, 0)
  const roomVat = Math.max(0, (invoice?.vatAmount || 0) - restaurantVat)
  const hotelVatPercent = invoice?.declaredVatPercent ?? 15
  const vatRates = Array.from(new Set(restaurantOrders.map((o) => Number(o.vatPercent || 0))))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b)
  const hotelPartTotal = roomBill + roomVat + extraBill
  const restaurantPartTotal = restaurantBill + restaurantVat

  const handleDownloadPdf = async () => {
    if (!invoice || !documentRef.current) return
    setPdfBusy(true)
    const toastId = toast.loading('Generating PDF…')
    try {
      await downloadInvoicePdfFromElement(
        documentRef.current,
        invoicePdfFileName(invoice.invoiceNumber)
      )
      toast.success('PDF downloaded', { id: toastId })
    } catch (err) {
      console.error('Invoice PDF failed:', err)
      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast.error(`Failed to generate PDF: ${msg}`, { id: toastId })
    } finally {
      setPdfBusy(false)
    }
  }

  const handlePrintPdf = async () => {
    if (!invoice || !documentRef.current) return
    setPdfBusy(true)
    const toastId = toast.loading('Opening invoice for print…')
    try {
      const fileName = invoicePdfFileName(invoice.invoiceNumber)
      const opened = await openInvoicePdfInNewTab(documentRef.current, fileName)
      if (!opened) {
        toast.error('Pop-up blocked. Allow pop-ups for this site, or use Download PDF.', {
          id: toastId,
        })
        return
      }
      toast.success('Invoice opened in a new tab — print from the browser PDF viewer', {
        id: toastId,
      })
    } catch (err) {
      console.error('Invoice print preview failed:', err)
      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast.error(`Failed to open print preview: ${msg}`, { id: toastId })
    } finally {
      setPdfBusy(false)
    }
  }

  if (isLoading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading invoice...</div>
  }

  if (!invoice) {
    return <div className="p-8 text-sm text-red-600">Invoice not found.</div>
  }

  const guestName = invoice.booking.customer.name
  const guestPhone =
    invoice.booking.customer.phone ||
    invoice.booking.companyLedgerGuest?.phone ||
    '—'
  const registrationNumber =
    invoice.booking.companyLedgerGuest?.registrationNumber ||
    invoice.booking.customer.registrationNumber ||
    '—'
  const guestCount = (invoice.booking.adults ?? 1) + (invoice.booking.children ?? 0)
  const bookedNights = countBookedNights(
    new Date(invoice.booking.checkIn),
    new Date(invoice.booking.checkOut)
  )
  const roomRate =
    invoice.booking.room.type.basePrice ??
    (bookedNights > 0 ? Math.round(roomBill / bookedNights) : roomBill)
  const companyName =
    invoice.booking.companyLedger?.name ||
    invoice.booking.company ||
    invoice.booking.customer.company ||
    null
  const companyAddress = invoice.booking.companyLedger?.address || null
  const bookingStatus = invoice.booking.status
    ? formatBookingStatusFilterLabel(invoice.booking.status)
    : '—'
  const totalInWords = formatAmountInWords(invoice.totalAmount)

  const orderDateTimeByRef = new Map(
    restaurantOrders.map((o) => [o.id, chargeDateTime(o.createdAt)])
  )
  const orderVatPercentByLabel = new Map(
    restaurantOrders.map((o) => {
      const label = o.orderNumber ? `#${o.orderNumber}` : o.id.slice(-6)
      return [label, Number(o.vatPercent || 0)]
    })
  )
  const defaultRestaurantVatPercent =
    vatRates.length === 1 ? vatRates[0] : vatRates.length > 0 ? vatRates[0] : null
  const invoiceDateTime = chargeDateTime(invoice.createdAt)
  const stayChargeDateTime = splitDisplayDateTime(formatCheckIn(invoice.booking.checkIn))
  const lineItems = invoice.items ?? []

  const resolveItemDateTime = (type: string, referenceId?: string | null) => {
    if (type === 'room_charge' || type === 'extra_service') return stayChargeDateTime
    if (referenceId && orderDateTimeByRef.has(referenceId)) {
      return orderDateTimeByRef.get(referenceId)!
    }
    const orderMatch = restaurantOrders.find((o) => o.id === referenceId)
    if (orderMatch) return chargeDateTime(orderMatch.createdAt)
    return invoiceDateTime
  }

  const resolveOrderVatPercent = (description: string): number | null => {
    const match = description.match(/Order (#?\S+)\)/)
    if (match && orderVatPercentByLabel.has(match[1])) {
      const percent = orderVatPercentByLabel.get(match[1])!
      return percent > 0 ? percent : null
    }
    return defaultRestaurantVatPercent
  }

  const mapChargeItemToRow = (item: InvoicePrintData['items'][number]): InvoiceChargeRow => {
    const type = item.itemType || 'room_charge'
    const base = item.total
    const { date, time } = resolveItemDateTime(type, item.referenceId)
    return buildChargeRow({
      id: item.id,
      date,
      time,
      category: lineItemCategory(type),
      description: item.description,
      rate: base,
      vatPercent: null,
      vatAmount: 0,
    })
  }

  let hotelRows = lineItems
    .filter((item) => HOTEL_CHARGE_TYPES.has(item.itemType || ''))
    .map(mapChargeItemToRow)

  if (hotelRows.length === 0 && (roomBill > 0 || extraBill > 0)) {
    hotelRows = [
      ...(roomBill > 0
        ? [
            buildChargeRow({
              id: 'fb-room',
              date: stayChargeDateTime.date,
              time: stayChargeDateTime.time,
              category: '',
              description: `Room ${invoice.booking.room.roomNumber} (${invoice.booking.room.type.name}) – ${bookedNights} night${bookedNights !== 1 ? 's' : ''}`,
              rate: roomBill,
              vatPercent: roomVat > 0 ? hotelVatPercent : null,
              vatAmount: roomVat,
            }),
          ]
        : []),
      ...(extraBill > 0
        ? [
            buildChargeRow({
              id: 'fb-extra',
              date: stayChargeDateTime.date,
              time: stayChargeDateTime.time,
              category: 'Extra',
              description: 'Extra charges',
              rate: extraBill,
              vatPercent: null,
              vatAmount: 0,
            }),
          ]
        : []),
    ]
  } else {
    hotelRows = hotelRows.map((row, index) => {
      const isRoomLine =
        lineItems.find((item) => item.id === row.id)?.itemType === 'room_charge' ||
        (row.id === 'fb-room' && index === 0)
      if (!isRoomLine || roomVat <= 0) return row
      return buildChargeRow({
        ...row,
        vatPercent: hotelVatPercent,
        vatAmount: roomVat,
      })
    })
  }

  let restaurantRows = lineItems
    .filter((item) => RESTAURANT_CHARGE_TYPES.has(item.itemType || ''))
    .map((item) => {
      const row = mapChargeItemToRow(item)
      if (item.total <= 0 || item.description.toLowerCase().includes('discount')) {
        return buildChargeRow({ ...row, vatPercent: null, vatAmount: 0 })
      }
      const vatPercent = resolveOrderVatPercent(item.description)
      return buildChargeRow({
        ...row,
        vatPercent,
      })
    })

  if (restaurantRows.length === 0 && restaurantBill > 0) {
    restaurantRows = [
      buildChargeRow({
        id: 'fb-food',
        ...(restaurantOrders[0]
          ? chargeDateTime(restaurantOrders[0].createdAt)
          : invoiceDateTime),
        category: 'F&B',
        description: 'Restaurant charges',
        rate: restaurantBill,
        vatPercent: restaurantVat > 0 ? defaultRestaurantVatPercent : null,
        vatAmount: restaurantVat,
      }),
    ]
  }

  const renderChargeTable = (
    title: string,
    rows: InvoiceChargeRow[],
    sectionTotal: number
  ) => (
    <div className="rounded-lg border border-border p-4">
      <p className="text-[8pt] font-semibold uppercase tracking-wide mb-2">
        {title}
      </p>
      <table className="invoice-charge-table w-full text-[8.5pt]">
        <thead>
          <tr className="border-b text-left">
            <th className="invoice-charge-date py-2 pr-2 font-semibold">Date</th>
            <th className="invoice-charge-category py-2 pr-2 font-semibold">Category</th>
            <th className="invoice-charge-num py-2 pr-2 font-semibold text-right">Rate</th>
            <th className="invoice-charge-num py-2 pr-2 font-semibold text-right">VAT %</th>
            <th className="invoice-charge-num py-2 pr-2 font-semibold text-right">VAT Amount</th>
            <th className="invoice-charge-num py-2 font-semibold text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="border-b border-border">
              <td colSpan={6} className="py-2 text-center">
                No charges
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className="border-b border-border">
                <td className="invoice-charge-date py-2 pr-2 align-top">
                  <span className="block whitespace-nowrap">{row.date}</span>
                  {row.time ? (
                    <span className="block text-[7.5pt] whitespace-nowrap">{row.time}</span>
                  ) : null}
                </td>
                <td className="invoice-charge-category py-2 pr-2 align-top break-words">
                  {row.category ? (
                    <>
                      <span className="font-medium">{row.category}</span>
                      <span className="block text-[7.5pt]">{row.description}</span>
                    </>
                  ) : (
                    <span className="font-medium">{row.description}</span>
                  )}
                </td>
                <td className="invoice-charge-num py-2 pr-2 text-right whitespace-nowrap">
                  {row.rate < 0 ? '-' : ''}
                  {formatBdt(Math.abs(row.rate))}
                </td>
                <td className="invoice-charge-num py-2 pr-2 text-right whitespace-nowrap">
                  {row.vatPercent != null ? `${row.vatPercent}%` : '—'}
                </td>
                <td className="invoice-charge-num py-2 pr-2 text-right whitespace-nowrap">
                  {row.vatAmount > 0 ? formatBdt(row.vatAmount) : '—'}
                </td>
                <td className="invoice-charge-num py-2 text-right font-medium whitespace-nowrap">
                  {row.amount < 0 ? '-' : ''}
                  {formatBdt(Math.abs(row.amount))}
                </td>
              </tr>
            ))
          )}
          <tr className="border-t border-border">
            <td colSpan={4} className="py-2" />
            <td className="invoice-charge-num py-2 pr-2 text-right font-semibold whitespace-nowrap">
              Total
            </td>
            <td className="invoice-charge-num py-2 text-right font-semibold whitespace-nowrap">
              {formatBdt(sectionTotal)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="invoice-print-root min-h-screen flex flex-col bg-background print:min-h-0 print:h-auto print:block">
      <div className="flex-1 p-6 print:p-0 print:m-0 print:min-h-0 print:h-auto print:bg-white">
      {showToolbar && (
        <div className="mx-auto mb-4 flex max-w-4xl flex-wrap items-center justify-between gap-3 print:hidden">
          <div>
            <h1 className="text-lg font-semibold text-foreground">{title}</h1>
            {successBanner && (
              <p className="mt-1 text-sm text-emerald-700">{successBanner}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => void handlePrintPdf()}
              disabled={pdfBusy}
            >
              {pdfBusy ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Opening…
                </>
              ) : (
                'Print'
              )}
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={() => void handleDownloadPdf()}
              disabled={pdfBusy}
            >
              {pdfBusy ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating…
                </>
              ) : (
                'Download PDF'
              )}
            </Button>
            {onClose && (
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
            )}
          </div>
        </div>
      )}

      <main
        ref={documentRef}
        className="print-container invoice-print-page mx-auto max-w-4xl rounded-xl border border-border bg-card p-6 text-black print:border-0 print:bg-white print:p-0 print:shadow-none print:text-black"
      >
        <div className="invoice-a4-sheet text-black font-bold text-[9pt] print:border-0">
          <div className="invoice-pdf-header mb-4 flex items-start justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <div className="h-10 w-10 overflow-hidden rounded-lg border border-border bg-background print:bg-white">
                <Image
                  src="/brand-logo.png"
                  alt="RRP Dream Inn logo"
                  width={40}
                  height={40}
                  className="h-full w-full object-cover"
                />
              </div>
              <div>
                <p className="text-sm font-bold">RRP Dream Inn</p>
                <p className="text-[8pt]">Guest Invoice</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[8pt]">Invoice No</p>
              <p className="font-mono text-[9pt] font-semibold">{invoice.invoiceNumber}</p>
              <p className="text-[8pt]">
                {format(new Date(invoice.createdAt), 'MMM dd, yyyy')}
              </p>
            </div>
          </div>

          <div className="invoice-pdf-body">
          <div className="mb-4 grid grid-cols-1 gap-3 text-[8.5pt] md:grid-cols-2 md:items-start">
            <div className="space-y-4">
              <div className="rounded-lg border border-border p-3 space-y-1.5">
                <p>
                  <span>Guest name:</span>{' '}
                  <span className="font-semibold">{guestName}</span>
                </p>
                <p>
                  <span>Phone:</span> {guestPhone}
                </p>
                <p>
                  <span>Registration no.:</span>{' '}
                  {registrationNumber}
                </p>
              </div>

              <div className="rounded-lg border border-border p-3 space-y-1.5">
                <p>
                  <span>Company name:</span>{' '}
                  <span className="font-semibold">{companyName || 'Walk-in'}</span>
                </p>
                {companyName && companyAddress ? (
                  <p>
                    <span>Address:</span> {companyAddress}
                  </p>
                ) : null}
              </div>

              <div className="rounded-lg border border-border p-3">
                <p>
                  <span>Status:</span>{' '}
                  <span className="font-semibold">{bookingStatus}</span>
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-border p-3">
              <table className="w-full text-[8.5pt]">
                <tbody>
                  <tr className="border-b border-border">
                    <td className="py-2 pr-3 w-[40%]">Room</td>
                    <td className="py-2 font-medium">
                      {invoice.booking.room.roomNumber} · {invoice.booking.room.type.name}
                    </td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="py-2 pr-3">Room rate</td>
                    <td className="py-2 font-medium">{formatBdt(roomRate)}</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="py-2 pr-3">Guest</td>
                    <td className="py-2 font-medium">
                      {guestCount} guest{guestCount !== 1 ? 's' : ''}
                    </td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="py-2 pr-3">Nights</td>
                    <td className="py-2 font-medium">{bookedNights}</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="py-2 pr-3">Check-in</td>
                    <td className="py-2 font-medium">{formatCheckIn(invoice.booking.checkIn)}</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-3">Check-out</td>
                    <td className="py-2 font-medium">{formatCheckOut(invoice.booking.checkOut)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="mb-4 space-y-3 text-[8.5pt]">
            {renderChargeTable('Hotel', hotelRows, hotelPartTotal)}
            {renderChargeTable('Restaurant', restaurantRows, restaurantPartTotal)}
          </div>

          <div className="w-full text-[8.5pt]">
            <div className="rounded border border-border p-2.5">
              <table className="w-full">
                <tbody>
                  <tr>
                    <td className="py-1 pr-2 whitespace-nowrap">Combined Total</td>
                    <td className="py-1 text-right whitespace-nowrap">
                      ৳{(hotelPartTotal + restaurantPartTotal).toLocaleString()}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1 pr-2 whitespace-nowrap">Discount</td>
                    <td className="py-1 text-right whitespace-nowrap">
                      ৳{invoice.discount.toLocaleString()}
                    </td>
                  </tr>
                  <tr className="border-t border-border">
                    <td className="py-1.5 pr-2 font-semibold text-[9pt] whitespace-nowrap">
                      Total
                    </td>
                    <td className="py-1.5 text-right font-semibold text-[9pt] whitespace-nowrap">
                      ৳{invoice.totalAmount.toLocaleString()}
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="text-[8pt] border-t border-border pt-2 mt-1 italic">
                <span className="font-medium not-italic">In words: </span>
                {totalInWords}
              </p>
              <table className="w-full border-t border-border mt-1">
                <tbody>
                  <tr>
                    <td className="py-1 pr-2 whitespace-nowrap">Paid</td>
                    <td className="py-1 text-right whitespace-nowrap">
                      ৳{invoice.paidAmount.toLocaleString()}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1 pr-2 font-bold text-[9pt] whitespace-nowrap">Due</td>
                    <td className="py-1 text-right font-bold text-[9pt] whitespace-nowrap">
                      ৳{invoice.dueAmount.toLocaleString()}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="invoice-print-footer mt-6 text-[8pt] space-y-3">
            <p className="text-center">
              Thank you for choosing RRP Dream Inn. We look forward to welcoming you again.
            </p>

            <p className="text-center text-[8pt] leading-relaxed">{INVOICE_GUEST_AGREEMENT}</p>

            <div className="invoice-signatures grid grid-cols-2 gap-8 pt-2">
              <div className="invoice-signature-col">
                <div className="invoice-signature-line" />
                <p className="invoice-signature-label">Authorized Signature</p>
              </div>
              <div className="invoice-signature-col">
                <div className="invoice-signature-line" />
                <p className="invoice-signature-label">Guest Signature</p>
              </div>
            </div>

            <p className="invoice-generated-by font-normal text-center pt-2">
              Generated by {user?.name || invoice.booking.creator?.name || 'Staff'} ·{' '}
              {format(new Date(), 'dd MMM yyyy, h:mm a')}
            </p>
          </div>
          </div>
        </div>
      </main>
      </div>
      <AppDevelopedByFooter printHidden />
    </div>
  )
}
