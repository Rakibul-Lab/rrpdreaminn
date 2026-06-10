'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { api } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  HOTEL_LOCATION,
  HOTEL_NAME,
  HOTEL_RESERVATION_FOOTER,
  HOTEL_TAGLINE,
  DEFAULT_SMOKING_STATUS,
  formatReservationMealPlan,
  RESERVATION_INTRO,
  formatGuestCompany,
  reservationPoliciesWithTimes,
} from '@/lib/reservation-terms'
import { useHotelTimes } from '@/hooks/use-hotel-times'
import { countHotelStayNights, applyHotelTimeToBookingInput } from '@/lib/hotel-times'
import { formatConfirmationNumber, reservationPdfFileName } from '@/lib/confirmation-number'
import { formatBdt } from '@/lib/currency'
import { bookingVatOptions, computeRoomBookingTotals } from '@/lib/booking-totals'
import { printReservationDocument } from '@/lib/print-reservation'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import {
  RESERVATION_REQUIRED_PLACEHOLDER,
  reservationDocValue,
  reservationIdLabel,
} from '@/lib/reservation-field-placeholders'

export interface ReservationDocumentData {
  id: string
  confirmationNumber?: string | null
  checkIn: string
  checkOut: string
  adults: number
  children: number
  totalRoomCharge: number
  advancePayment: number
  dueAmount: number
  vatApplied?: boolean
  vatPercent?: number
  vatAmount?: number
  totalWithVat?: number
  notes?: string | null
  status: string
  isInitialReservation?: boolean
  createdAt: string
  formOfPayment?: string
  company?: string | null
  withMeal?: boolean
  customer: {
    name: string
    phone: string
    company?: string | null
    email?: string | null
    address?: string | null
    idType?: string | null
    idNumber?: string | null
    registrationNumber?: string | null
    nationality?: string | null
  }
  room: { roomNumber: string; type: { name: string } }
  idDocuments?: { id: string; filePath: string; sortOrder: number }[]
  creator?: {
    id: string
    name: string
    email: string
    phone?: string | null
    role: string
  } | null
}

const STAFF_ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrator',
  HOTEL_STAFF: 'Hotel Staff',
  RESTAURANT_STAFF: 'Restaurant Staff',
}

function idTypeLabel(type?: string | null) {
  if (type === 'passport') return 'Passport'
  if (type === 'driving_license') return 'Driving License'
  if (type === 'national_id') return 'National ID (NID)'
  return type || '—'
}

interface ReservationDocumentViewProps {
  reservationId: string
  showToolbar?: boolean
  onClose?: () => void
}

export function ReservationDocumentView({
  reservationId,
  showToolbar = true,
  onClose,
}: ReservationDocumentViewProps) {
  const documentRef = useRef<HTMLDivElement>(null)
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const [logoSrc, setLogoSrc] = useState('/brand-logo.png')
  const { times, formatCheckInShort, formatCheckOutShort } = useHotelTimes()

  useEffect(() => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = '/reservation-a4.css'
    document.head.appendChild(link)
    return () => link.remove()
  }, [])

  useEffect(() => {
    import('@/lib/reservation-document-html')
      .then(({ getLogoDataUrl }) => getLogoDataUrl())
      .then(setLogoSrc)
      .catch(() => {})
  }, [])

  const { data, isLoading } = useQuery({
    queryKey: ['reservation-document', reservationId],
    queryFn: () => api.get<{ success: boolean; data: ReservationDocumentData }>(`/bookings/${reservationId}`),
    enabled: !!reservationId,
  })

  const reservation = data?.data

  const handleDownloadPdf = async () => {
    if (!reservation || !documentRef.current) return
    const fileName = reservationPdfFileName(reservation)
    setDownloadingPdf(true)
    const toastId = toast.loading('Generating PDF…')
    try {
      const { downloadReservationPdfFromElement } = await import('@/lib/reservation-pdf')
      await downloadReservationPdfFromElement(documentRef.current, fileName)
      toast.success('PDF downloaded', { id: toastId })
    } catch (err) {
      console.error('PDF generation failed:', err)
      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast.error(`Failed to generate PDF: ${msg}`, { id: toastId })
    } finally {
      setDownloadingPdf(false)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-80 w-full max-w-[210mm]" />
      </div>
    )
  }

  if (!reservation) {
    return <p className="text-red-600 text-sm">Reservation not found.</p>
  }

  const checkInDt = applyHotelTimeToBookingInput(reservation.checkIn, times.checkInTime)
  const checkOutDt = applyHotelTimeToBookingInput(reservation.checkOut, times.checkOutTime)
  const nights = countHotelStayNights(checkInDt, checkOutDt)
  const policies = reservationPoliciesWithTimes(times)
  const confirmationNo = formatConfirmationNumber(reservation)
  const guestsLabel = `${reservation.adults} adult(s)${reservation.children > 0 ? `, ${reservation.children} child(ren)` : ''}`
  const showMissingFields = reservation.isInitialReservation === true
  const idLabel = showMissingFields
    ? reservationIdLabel(
        reservation.customer.idType,
        reservation.customer.idNumber,
        { requiredWhenMissing: true }
      )
    : `${idTypeLabel(reservation.customer.idType)}${reservation.customer.idNumber ? ` — ${reservation.customer.idNumber}` : ''}`
  const idAttachments = reservation.idDocuments ?? []
  const placeholderClass = 'text-amber-700 italic'

  const vatTotals = computeRoomBookingTotals(
    reservation.totalRoomCharge,
    reservation.advancePayment,
    bookingVatOptions(reservation)
  )
  const vatApplied = reservation.vatApplied !== false
  const vatPercent = reservation.vatPercent ?? vatTotals.vatPercent
  const vatAmount = reservation.vatAmount ?? vatTotals.vatAmount
  const totalWithVat = reservation.totalWithVat ?? vatTotals.totalWithVat

  return (
    <div className="print-container flex flex-col items-center">
      {showToolbar && (
        <div className="mb-4 flex w-full max-w-[210mm] flex-wrap items-center justify-end gap-3 print:hidden">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => printReservationDocument()}>
              Print
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={() => void handleDownloadPdf()}
              disabled={downloadingPdf}
            >
              {downloadingPdf ? (
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

      <div
        id="reservation-document-root"
        ref={documentRef}
        className="reservation-document flex flex-col gap-6 print:gap-0"
      >
      <article
        id="reservation-document-article"
        className="reservation-a4-sheet box-border px-[14mm] pt-[12mm] pb-[16mm] shadow-md print:shadow-none print:px-[14mm] print:pt-[12mm] print:pb-[18mm]"
      >
        <header className="rd-header">
          <div className="rd-header-main">
            <div className="rd-brand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoSrc} alt={HOTEL_NAME} className="rd-logo" width={52} height={52} />
              <p className="rd-hotel-name">{HOTEL_NAME}</p>
              <p className="rd-hotel-sub">{HOTEL_LOCATION}</p>
              <p className="rd-hotel-tag">{HOTEL_TAGLINE}</p>
            </div>
          </div>
          <div className="rd-doc-title-block">
            <p className="rd-doc-title">Reservation Confirmation</p>
          </div>
        </header>

        {showMissingFields && (
          <section className="rd-block rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 print:border print:bg-transparent">
            <strong>Initial reservation</strong> — some required guest details are not yet provided.
            Fields marked {RESERVATION_REQUIRED_PLACEHOLDER} must be completed before check-in.
          </section>
        )}

        <section className="rd-block">
          <p className="rd-line">
            <span className="rd-label">Date:</span>{' '}
            <span className="rd-muted">{format(new Date(reservation.createdAt), 'dd/MM/yyyy')}</span>
          </p>
          <div className="rd-row-2">
            <p>
              <span className="rd-label">Attention:</span>{' '}
              <span className="rd-muted">{reservation.customer.name}</span>
            </p>
            <p>
              <span className="rd-label">Mobile Number:</span>{' '}
              <span className="rd-muted">{reservation.customer.phone}</span>
            </p>
          </div>
          <div className="rd-row-2">
            <p>
              <span className="rd-label">Company:</span>{' '}
              <span className="rd-muted">
                {formatGuestCompany(reservation.company ?? reservation.customer.company)}
              </span>
            </p>
            <p>
              <span className="rd-label">Email:</span>{' '}
              <span
                className={`rd-muted ${showMissingFields && !reservation.customer.email?.trim() ? placeholderClass : ''}`}
              >
                {reservationDocValue(reservation.customer.email, showMissingFields)}
              </span>
            </p>
          </div>
          <div className="rd-row-2">
            <p>
              <span className="rd-label">Nationality:</span>{' '}
              <span
                className={`rd-muted ${showMissingFields && !reservation.customer.nationality?.trim() ? placeholderClass : ''}`}
              >
                {reservationDocValue(reservation.customer.nationality, showMissingFields)}
              </span>
            </p>
            <p>
              <span className="rd-label">Registration No.:</span>{' '}
              <span
                className={`rd-muted ${showMissingFields && !reservation.customer.registrationNumber?.trim() ? placeholderClass : ''}`}
              >
                {reservationDocValue(
                  reservation.customer.registrationNumber,
                  showMissingFields
                )}
              </span>
            </p>
          </div>
          <p className="rd-intro">{RESERVATION_INTRO}</p>
        </section>

        <section className="rd-block">
          <div className="rd-details-cols">
            <div className="rd-details-col">
              <p>
                <span className="rd-label">Name of the Guest:</span>{' '}
                <span className="rd-muted">{reservation.customer.name}</span>
              </p>
              <p>
                <span className="rd-label">Confirmation No.:</span>{' '}
                <span className="rd-muted">{confirmationNo}</span>
              </p>
              <p>
                <span className="rd-label">Status:</span>{' '}
                <span className="rd-muted">{reservation.status.replace(/_/g, ' ')}</span>
              </p>
              <p>
                <span className="rd-label">Expected Arrival:</span>{' '}
                <span className="rd-muted">{formatCheckInShort(reservation.checkIn)}</span>
              </p>
              <p>
                <span className="rd-label">Expected Departure:</span>{' '}
                <span className="rd-muted">{formatCheckOutShort(reservation.checkOut)}</span>
              </p>
              <p>
                <span className="rd-label">No. of Night(s):</span>{' '}
                <span className="rd-muted">{nights}</span>
              </p>
              <p>
                <span className="rd-label">Room Type:</span>{' '}
                <span className="rd-muted">{reservation.room.type.name}</span>
              </p>
              <p>
                <span className="rd-label">Room No.:</span>{' '}
                <span className="rd-muted">{reservation.room.roomNumber}</span>
              </p>
              <p>
                <span className="rd-label">Meal Plan:</span>{' '}
                <span className="rd-muted">{formatReservationMealPlan(reservation.withMeal)}</span>
              </p>
              <p>
                <span className="rd-label">Address:</span>{' '}
                <span
                  className={`rd-muted ${showMissingFields && !reservation.customer.address?.trim() ? placeholderClass : ''}`}
                >
                  {reservationDocValue(reservation.customer.address, showMissingFields)}
                </span>
              </p>
            </div>
            <div className="rd-details-col">
              <p>
                <span className="rd-label">No. of Guests:</span>{' '}
                <span className="rd-muted">{guestsLabel}</span>
              </p>
              <p>
                <span className="rd-label">No. of Rooms:</span> <span className="rd-muted">1</span>
              </p>
              <p>
                <span className="rd-label">Smoking Status:</span>{' '}
                <span className="rd-muted">{DEFAULT_SMOKING_STATUS}</span>
              </p>
              <p>
                <span className="rd-label">Room Rate:</span>{' '}
                <span className="rd-muted">
                  {formatBdt(reservation.totalRoomCharge)} (total, {nights} night{nights > 1 ? 's' : ''})
                </span>
              </p>
              <p>
                <span className="rd-label">VAT:</span>{' '}
                <span className="rd-muted">
                  {vatApplied ? `${vatPercent}% — ${formatBdt(vatAmount)}` : 'Off'}
                </span>
              </p>
              {vatApplied && (
                <p>
                  <span className="rd-label">Total (incl. VAT):</span>{' '}
                  <span className="rd-muted">{formatBdt(totalWithVat)}</span>
                </p>
              )}
              <p>
                <span className="rd-label">Advance Paid:</span>{' '}
                <span className="rd-muted">{formatBdt(reservation.advancePayment)}</span>
              </p>
              <p>
                <span className="rd-label">Balance Due:</span>{' '}
                <span className="rd-muted">{formatBdt(reservation.dueAmount)}</span>
              </p>
              <p>
                <span className="rd-label">Form of Payment:</span>{' '}
                <span className="rd-muted">{reservation.formOfPayment || 'Not paid at booking'}</span>
              </p>
              <p>
                <span className="rd-label">ID (Check-in):</span>{' '}
                <span
                  className={`rd-muted ${showMissingFields && idLabel.includes(RESERVATION_REQUIRED_PLACEHOLDER) ? placeholderClass : ''}`}
                >
                  {idLabel}
                </span>
              </p>
              <p>
                <span className="rd-label">Remarks:</span>{' '}
                <span className="rd-muted">{reservation.notes || '—'}</span>
              </p>
            </div>
          </div>
        </section>

        <section className="rd-block">
          <h3 className="rd-terms-title">General Terms and Conditions</h3>
          <ul className="rd-terms-list">
            {policies.map((policy) => (
              <li key={policy.title}>
                <span className="rd-label">{policy.title}:</span> {policy.text}
              </li>
            ))}
          </ul>
        </section>

        <footer className="rd-document-footer">
          <div className="rd-signatures">
            <div className="rd-prepared-by">
              <p className="rd-prepared-by-title">Prepared by:</p>
              {reservation.creator ? (
                <div className="rd-prepared-by-details">
                  <p>
                    <span className="rd-label">Name:</span>{' '}
                    <span className="rd-muted">{reservation.creator.name}</span>
                  </p>
                  {reservation.creator.phone ? (
                    <p>
                      <span className="rd-label">Phone:</span>{' '}
                      <span className="rd-muted">{reservation.creator.phone}</span>
                    </p>
                  ) : null}
                  <p>
                    <span className="rd-label">Email:</span>{' '}
                    <span className="rd-muted">{reservation.creator.email}</span>
                  </p>
                  <p>
                    <span className="rd-label">Role:</span>{' '}
                    <span className="rd-muted">
                      {STAFF_ROLE_LABELS[reservation.creator.role] || reservation.creator.role}
                    </span>
                  </p>
                </div>
              ) : (
                <p className="rd-muted">—</p>
              )}
            </div>
            <div className="rd-signature-col rd-signature-col--guest">
              <div className="rd-signature-line" />
              <p className="rd-signature-label">Guest:</p>
            </div>
          </div>
          <p className="rd-footer-text">{HOTEL_RESERVATION_FOOTER}</p>
        </footer>
      </article>

      {(idAttachments.length > 0 || showMissingFields) && (
        <article
          id="reservation-id-attachments"
          className="reservation-a4-sheet reservation-a4-sheet--attachments box-border px-[14mm] pt-[12mm] pb-[16mm] shadow-md print:shadow-none print:px-[14mm] print:pt-[12mm] print:pb-[18mm]"
        >
          <header className="rd-header">
            <div className="rd-header-main">
              <div className="rd-brand">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logoSrc} alt={HOTEL_NAME} className="rd-logo" width={52} height={52} />
                <p className="rd-hotel-name">{HOTEL_NAME}</p>
                <p className="rd-hotel-sub">{HOTEL_LOCATION}</p>
              </div>
            </div>
            <div className="rd-doc-title-block">
              <p className="rd-doc-title">Guest ID Documents</p>
            </div>
          </header>
          <section className="rd-block">
            <p className="rd-line">
              <span className="rd-label">Confirmation No.:</span>{' '}
              <span className="rd-muted">{confirmationNo}</span>
            </p>
            <p className="rd-line">
              <span className="rd-label">Guest:</span>{' '}
              <span className="rd-muted">{reservation.customer.name}</span>
            </p>
            <p className="rd-line">
              <span className="rd-label">Nationality:</span>{' '}
              <span
                className={`rd-muted ${showMissingFields && !reservation.customer.nationality?.trim() ? placeholderClass : ''}`}
              >
                {reservationDocValue(reservation.customer.nationality, showMissingFields)}
              </span>
            </p>
            <p className="rd-line">
              <span className="rd-label">Registration No.:</span>{' '}
              <span
                className={`rd-muted ${showMissingFields && !reservation.customer.registrationNumber?.trim() ? placeholderClass : ''}`}
              >
                {reservationDocValue(
                  reservation.customer.registrationNumber,
                  showMissingFields
                )}
              </span>
            </p>
            <p className="rd-line">
              <span className="rd-label">ID:</span> <span className="rd-muted">{idLabel}</span>
            </p>
          </section>
          <section className="rd-id-attachments-grid">
            {idAttachments.length > 0 ? (
              idAttachments.map((doc, index) => (
                <figure key={doc.id} className="rd-id-attachment">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={doc.filePath}
                    alt={`ID document ${index + 1}`}
                    className="rd-id-attachment-img"
                  />
                  <figcaption className="rd-id-attachment-caption">Image {index + 1}</figcaption>
                </figure>
              ))
            ) : (
              <div className="rd-id-attachment rd-id-attachment--placeholder flex min-h-[180px] items-center justify-center border border-dashed border-amber-400 bg-amber-50 p-6 text-center text-sm text-amber-800 italic">
                {RESERVATION_REQUIRED_PLACEHOLDER}
                <br />
                ID document image(s) not attached
              </div>
            )}
          </section>
          <footer className="rd-document-footer">
            <p className="rd-footer-text">{HOTEL_RESERVATION_FOOTER}</p>
          </footer>
        </article>
      )}
      </div>
    </div>
  )
}
