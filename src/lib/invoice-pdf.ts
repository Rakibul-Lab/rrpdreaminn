import { jsPDF } from 'jspdf'
import { domToPng } from 'modern-screenshot'
import { getLogoDataUrl } from './reservation-document-html'

/** A4 width at 96 CSS px — standard document width */
const A4_WIDTH_PX = 794
/** ~300 DPI equivalent width for A4 (8.27 in × 300) */
const MAX_CAPTURE_WIDTH_PX = 2480
const CAPTURE_SCALE = 3
const JPEG_QUALITY = 0.96
const PAGE_MARGIN_MM = 8
const HEADER_BODY_GAP_MM = 2

type CapturedElement = {
  img: HTMLImageElement
  jpegDataUrl: string
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = src
  })
}

async function toCompressedJpegDataUrl(
  dataUrl: string,
  quality: number,
  maxWidth = MAX_CAPTURE_WIDTH_PX
): Promise<string> {
  const img = await loadImage(dataUrl)
  let w = img.naturalWidth || img.width
  let h = img.naturalHeight || img.height
  if (w > maxWidth) {
    h = Math.round((h * maxWidth) / w)
    w = maxWidth
  }

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return dataUrl

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', quality)
}

async function embedImagesAsDataUrls(root: HTMLElement): Promise<() => void> {
  const originals: { img: HTMLImageElement; src: string }[] = []
  const logoDataUrl = await getLogoDataUrl().catch(() => null)

  for (const img of Array.from(root.querySelectorAll('img'))) {
    originals.push({ img, src: img.src })
    if (logoDataUrl && (img.src.includes('brand-logo') || img.alt.includes('Dream Inn'))) {
      img.src = logoDataUrl
    }
  }

  return () => {
    originals.forEach(({ img, src }) => {
      img.src = src
    })
  }
}

function waitForImages(root: ParentNode): Promise<void> {
  const images = Array.from(root.querySelectorAll('img'))
  if (images.length === 0) return Promise.resolve()

  return Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete && img.naturalWidth > 0) resolve()
          else {
            img.onload = () => resolve()
            img.onerror = () => resolve()
          }
        })
    )
  ).then(() => undefined)
}

function sliceImageToDataUrl(
  img: HTMLImageElement,
  sourceY: number,
  sourceH: number
): string | null {
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = sourceH
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, sourceY, img.width, sourceH, 0, 0, img.width, sourceH)
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
}

function displayHeight(img: HTMLImageElement, displayW: number): number {
  return (img.height * displayW) / img.width
}

/** Source pixels that fit within a given display height at the target width. */
function sourceHeightForDisplay(img: HTMLImageElement, displayW: number, displayH: number): number {
  return Math.max(1, Math.round((displayH * img.width) / displayW))
}

function addCapturedImageToPdf(pdf: jsPDF, img: HTMLImageElement, jpegDataUrl: string): void {
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = PAGE_MARGIN_MM
  const maxW = pageWidth - margin * 2
  const maxH = pageHeight - margin * 2

  const sliceHeightPx = sourceHeightForDisplay(img, maxW, maxH)
  let sourceY = 0
  let page = 0

  while (sourceY < img.height) {
    if (page > 0) pdf.addPage()

    const sourceH = Math.min(sliceHeightPx, img.height - sourceY)
    const sliceDataUrl = sliceImageToDataUrl(img, sourceY, sourceH)
    if (!sliceDataUrl) {
      pdf.addImage(
        jpegDataUrl,
        'JPEG',
        margin,
        margin,
        maxW,
        displayHeight(img, maxW),
        undefined,
        'SLOW'
      )
      return
    }

    const sliceDisplayH = (sourceH * maxW) / img.width
    pdf.addImage(sliceDataUrl, 'JPEG', margin, margin, maxW, sliceDisplayH, undefined, 'SLOW')
    sourceY += sourceH
    page += 1
  }
}

function addCapturedImageWithRepeatingHeader(
  pdf: jsPDF,
  header: CapturedElement,
  body: CapturedElement
): boolean {
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = PAGE_MARGIN_MM
  const maxW = pageWidth - margin * 2
  const maxH = pageHeight - margin * 2

  const headerDisplayH = displayHeight(header.img, maxW)
  const bodySliceMaxH = maxH - headerDisplayH - HEADER_BODY_GAP_MM

  if (bodySliceMaxH <= 12) {
    return false
  }

  const bodySliceHeightPx = sourceHeightForDisplay(body.img, maxW, bodySliceMaxH)
  const bodyY = margin + headerDisplayH + HEADER_BODY_GAP_MM
  let sourceY = 0
  let page = 0

  while (sourceY < body.img.height) {
    if (page > 0) pdf.addPage()

    pdf.addImage(
      header.jpegDataUrl,
      'JPEG',
      margin,
      margin,
      maxW,
      headerDisplayH,
      undefined,
      'SLOW'
    )

    const sourceH = Math.min(bodySliceHeightPx, body.img.height - sourceY)
    const sliceDataUrl = sliceImageToDataUrl(body.img, sourceY, sourceH)
    if (!sliceDataUrl) return false

    const sliceDisplayH = (sourceH * maxW) / body.img.width
    pdf.addImage(sliceDataUrl, 'JPEG', margin, bodyY, maxW, sliceDisplayH, undefined, 'SLOW')
    sourceY += sourceH
    page += 1
  }

  return true
}

async function captureElement(element: HTMLElement): Promise<CapturedElement> {
  await waitForImages(element)

  const pngDataUrl = await domToPng(element, {
    scale: CAPTURE_SCALE,
    backgroundColor: '#ffffff',
    width: A4_WIDTH_PX,
    height: element.scrollHeight,
    timeout: 60_000,
  })

  const jpegDataUrl = await toCompressedJpegDataUrl(pngDataUrl, JPEG_QUALITY, MAX_CAPTURE_WIDTH_PX)
  const img = await loadImage(jpegDataUrl)
  return { img, jpegDataUrl }
}

export function invoicePdfFileName(invoiceNumber: string): string {
  const safe = invoiceNumber.replace(/[^\w-]+/g, '_')
  return `invoice-${safe}.pdf`
}

async function buildInvoicePdfFromElement(element: HTMLElement): Promise<jsPDF> {
  const prevWidth = element.style.width
  const prevMaxWidth = element.style.maxWidth
  const prevBoxSizing = element.style.boxSizing

  element.style.boxSizing = 'border-box'
  element.style.width = `${A4_WIDTH_PX}px`
  element.style.maxWidth = `${A4_WIDTH_PX}px`

  const restoreImages = await embedImagesAsDataUrls(element)

  try {
    await waitForImages(element)
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))

    const headerEl = element.querySelector('.invoice-pdf-header') as HTMLElement | null
    const bodyEl = element.querySelector('.invoice-pdf-body') as HTMLElement | null

    const pdf = new jsPDF({
      unit: 'mm',
      format: 'a4',
      orientation: 'portrait',
      compress: true,
    })

    if (headerEl && bodyEl) {
      const [header, body] = await Promise.all([captureElement(headerEl), captureElement(bodyEl)])
      const paginated = addCapturedImageWithRepeatingHeader(pdf, header, body)
      if (!paginated) {
        const sheet = element.querySelector('.invoice-a4-sheet') as HTMLElement | null
        const captured = await captureElement(sheet ?? element)
        addCapturedImageToPdf(pdf, captured.img, captured.jpegDataUrl)
      }
    } else {
      const captured = await captureElement(element)
      addCapturedImageToPdf(pdf, captured.img, captured.jpegDataUrl)
    }

    return pdf
  } finally {
    restoreImages()
    element.style.width = prevWidth
    element.style.maxWidth = prevMaxWidth
    element.style.boxSizing = prevBoxSizing
  }
}

export async function downloadInvoicePdfFromElement(
  element: HTMLElement,
  fileName: string
): Promise<void> {
  const pdf = await buildInvoicePdfFromElement(element)
  pdf.save(fileName)
}

/** Opens the invoice PDF in a new browser tab (native PDF viewer + print). */
export async function openInvoicePdfInNewTab(
  element: HTMLElement,
  fileName: string
): Promise<boolean> {
  const pdf = await buildInvoicePdfFromElement(element)
  const blob = pdf.output('blob')
  const url = URL.createObjectURL(blob)
  const tab = window.open(url, '_blank', 'noopener,noreferrer')

  if (!tab) {
    URL.revokeObjectURL(url)
    return false
  }

  try {
    tab.document.title = fileName
  } catch {
    // Native PDF viewer tabs may not expose document.title
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000)
  return true
}
