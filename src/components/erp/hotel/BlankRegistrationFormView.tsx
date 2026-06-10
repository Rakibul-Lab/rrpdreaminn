'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DEFAULT_SMOKING_STATUS,
  HOTEL_LOCATION,
  HOTEL_NAME,
  HOTEL_RESERVATION_FOOTER,
  HOTEL_TAGLINE,
  reservationPoliciesWithTimes,
} from '@/lib/reservation-terms'
import {
  REGISTRATION_FORM_INTRO,
  REGISTRATION_FORM_PDF_FILENAME,
  REGISTRATION_FORM_TITLE,
} from '@/lib/registration-form-blank'
import { useHotelTimes } from '@/hooks/use-hotel-times'
import { printReservationDocument } from '@/lib/print-reservation'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

function BlankField({ wide = false }: { wide?: boolean }) {
  return <span className={cn('rd-blank-field', wide && 'rd-blank-field--wide')} aria-hidden />
}

interface BlankRegistrationFormViewProps {
  showToolbar?: boolean
}

export function BlankRegistrationFormView({ showToolbar = true }: BlankRegistrationFormViewProps) {
  const documentRef = useRef<HTMLDivElement>(null)
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const [logoSrc, setLogoSrc] = useState('/brand-logo.png')
  const { times } = useHotelTimes()
  const policies = reservationPoliciesWithTimes(times)

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

  const handleDownloadPdf = async () => {
    if (!documentRef.current) return
    setDownloadingPdf(true)
    const toastId = toast.loading('Generating PDF…')
    try {
      const { downloadReservationPdfFromElement } = await import('@/lib/reservation-pdf')
      await downloadReservationPdfFromElement(documentRef.current, REGISTRATION_FORM_PDF_FILENAME)
      toast.success('PDF downloaded', { id: toastId })
    } catch (err) {
      console.error('PDF generation failed:', err)
      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast.error(`Failed to generate PDF: ${msg}`, { id: toastId })
    } finally {
      setDownloadingPdf(false)
    }
  }

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
          </div>
        </div>
      )}

      <div
        id="registration-form-document-root"
        ref={documentRef}
        className="reservation-document flex flex-col gap-6 print:gap-0"
      >
        <article
          id="registration-form-document-article"
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
              <p className="rd-doc-title">{REGISTRATION_FORM_TITLE}</p>
            </div>
          </header>

          <section className="rd-block">
            <p className="rd-line">
              <span className="rd-label">Date:</span> <BlankField />
            </p>
            <div className="rd-row-2">
              <p>
                <span className="rd-label">Attention:</span> <BlankField wide />
              </p>
              <p>
                <span className="rd-label">Mobile Number:</span> <BlankField />
              </p>
            </div>
            <div className="rd-row-2">
              <p>
                <span className="rd-label">Company:</span> <BlankField />
              </p>
              <p>
                <span className="rd-label">Email:</span> <BlankField />
              </p>
            </div>
            <div className="rd-row-2">
              <p>
                <span className="rd-label">Nationality:</span> <BlankField />
              </p>
              <p>
                <span className="rd-label">Registration No.:</span> <BlankField />
              </p>
            </div>
            <p className="rd-intro">{REGISTRATION_FORM_INTRO}</p>
          </section>

          <section className="rd-block">
            <div className="rd-details-cols">
              <div className="rd-details-col">
                <p>
                  <span className="rd-label">Name of the Guest:</span> <BlankField wide />
                </p>
                <p>
                  <span className="rd-label">Confirmation No.:</span> <BlankField />
                </p>
                <p>
                  <span className="rd-label">Expected Arrival:</span> <BlankField />
                </p>
                <p>
                  <span className="rd-label">Expected Departure:</span> <BlankField />
                </p>
                <p>
                  <span className="rd-label">No. of Night(s):</span> <BlankField />
                </p>
                <p>
                  <span className="rd-label">Room Type:</span> <BlankField />
                </p>
                <p>
                  <span className="rd-label">Room No.:</span> <BlankField />
                </p>
                <p>
                  <span className="rd-label">Meal Plan:</span> <BlankField wide />
                </p>
                <p>
                  <span className="rd-label">Address:</span> <BlankField wide />
                </p>
              </div>
              <div className="rd-details-col">
                <p>
                  <span className="rd-label">No. of Guests:</span> <BlankField />
                </p>
                <p>
                  <span className="rd-label">No. of Rooms:</span> <BlankField />
                </p>
                <p>
                  <span className="rd-label">Smoking Status:</span>{' '}
                  <span className="rd-muted">{DEFAULT_SMOKING_STATUS}</span>
                </p>
                <p>
                  <span className="rd-label">Room Rate:</span> <BlankField wide />
                </p>
                <p>
                  <span className="rd-label">VAT:</span> <BlankField />
                </p>
                <p>
                  <span className="rd-label">Advance Paid:</span> <BlankField />
                </p>
                <p>
                  <span className="rd-label">Balance Due:</span> <BlankField />
                </p>
                <p>
                  <span className="rd-label">Form of Payment:</span> <BlankField />
                </p>
                <p>
                  <span className="rd-label">ID (Check-in):</span> <BlankField wide />
                </p>
                <p>
                  <span className="rd-label">Remarks:</span> <BlankField wide />
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
                <div className="rd-prepared-by-details">
                  <p>
                    <span className="rd-label">Name:</span> <BlankField wide />
                  </p>
                  <p>
                    <span className="rd-label">Phone:</span> <BlankField />
                  </p>
                  <p>
                    <span className="rd-label">Email:</span> <BlankField wide />
                  </p>
                  <p>
                    <span className="rd-label">Role:</span> <BlankField />
                  </p>
                </div>
              </div>
              <div className="rd-signature-col rd-signature-col--guest">
                <div className="rd-signature-line" />
                <p className="rd-signature-label">Guest:</p>
              </div>
            </div>
            <p className="rd-footer-text">{HOTEL_RESERVATION_FOOTER}</p>
          </footer>
        </article>

        <article
          id="registration-form-id-attachments"
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
              <span className="rd-label">Confirmation No.:</span> <BlankField />
            </p>
            <p className="rd-line">
              <span className="rd-label">Guest:</span> <BlankField wide />
            </p>
            <p className="rd-line">
              <span className="rd-label">Nationality:</span> <BlankField />
            </p>
            <p className="rd-line">
              <span className="rd-label">Registration No.:</span> <BlankField />
            </p>
            <p className="rd-line">
              <span className="rd-label">ID:</span> <BlankField wide />
            </p>
          </section>
          <section className="rd-id-attachments-grid">
            {[1, 2].map((index) => (
              <div
                key={index}
                className="rd-id-attachment rd-id-attachment--placeholder flex min-h-[180px] items-center justify-center border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500"
              >
                Attach ID document image {index}
              </div>
            ))}
          </section>
          <footer className="rd-document-footer">
            <p className="rd-footer-text">{HOTEL_RESERVATION_FOOTER}</p>
          </footer>
        </article>
      </div>
    </div>
  )
}
