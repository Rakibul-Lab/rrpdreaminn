'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { format, parseISO } from 'date-fns'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmailInput } from '@/components/ui/email-input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { IdDocumentScanner } from './IdDocumentScanner'
import { GuestSearchField, type GuestSearchResult } from './GuestSearchField'
import { CompanyLedgerSearchField } from './CompanyLedgerSearchField'
import { NationalityField } from '@/components/erp/shared/NationalityField'
import {
  DEFAULT_NATIONALITY,
  isBangladeshNationality,
  resolveIdTypeForNationality,
} from '@/lib/id-type-label'
import { NATIONALITY_OPTIONS } from '@/lib/nationalities'
import { ReservationDocumentView } from './ReservationDocumentView'
import type { IdDocumentType } from '@/lib/id-ocr'
import type { IdDocumentItem, IdScanResult } from './IdDocumentScanner'
import { Switch } from '@/components/ui/switch'
import { CheckCircle2, FilePenLine, LogIn, Plus } from 'lucide-react'
import {
  computeRoomBookingTotals,
  DEFAULT_VAT_PERCENT,
  VAT_PERCENT_INPUT_STEP,
} from '@/lib/booking-totals'
import { formatPaymentMethod, PAYMENT_METHOD_OPTIONS } from '@/lib/payment-method'
import {
  DEFAULT_GUEST_COMPANY,
  formatGuestCompany,
  formatReservationMealPlan,
} from '@/lib/reservation-terms'
import { useHotelTimes } from '@/hooks/use-hotel-times'
import {
  getCompleteReservationMissingFields,
  getInitialReservationMissingFields,
} from '@/lib/reservation-completion-fields'
import {
  applyHotelTimeToBookingInput,
  countHotelStayNights,
  describeStayPeriod,
  formatTime12h,
  isStayDatePickerRangeValid,
  minCheckoutDatePickerValue,
} from '@/lib/hotel-times'
import type { BookingDiscountType } from '@/lib/booking-discount'

interface Room {
  id: string
  roomNumber: string
  status: string
  type: { name: string; basePrice: number }
}

const STEP_LABELS = ['Guest', 'Stay', 'Payment', 'Confirm', 'Document']

function defaultStayDates() {
  const checkIn = new Date()
  const checkOut = new Date()
  checkOut.setDate(checkOut.getDate() + 1)
  return {
    checkIn: format(checkIn, 'yyyy-MM-dd'),
    checkOut: format(checkOut, 'yyyy-MM-dd'),
  }
}

function stayDatesValid(checkIn: string, checkOut: string) {
  return isStayDatePickerRangeValid(checkIn, checkOut)
}

function getInitialReservationGuestMissingFields(
  mode: GuestMode,
  guest: {
    selectedCustomerId: string
    guestName: string
    guestPhone: string
    guestNationality: string
  }
): string[] {
  const missing = getInitialReservationMissingFields({
    guestName: guest.guestName,
    guestPhone: guest.guestPhone,
    guestNationality: guest.guestNationality,
  })
  if (mode === 'existing' && !guest.selectedCustomerId) {
    missing.unshift('Guest selection')
  }
  return missing
}

type GuestMode = 'new' | 'existing'

type GuestDraft = {
  selectedCustomerId: string
  guestName: string
  guestCompany: string
  companyLedgerId: string
  guestPhone: string
  guestEmail: string
  guestAddress: string
  guestNationality: string
  idType: IdDocumentType
  idNumber: string
  registrationNumber: string
  idDocuments: IdDocumentItem[]
  existingDocsStatus: 'idle' | 'loading' | 'none' | 'found'
}

type StayDraft = {
  selectedRoomId: string
  checkInDate: string
  checkOutDate: string
  adults: string
  children: string
  withMeal: boolean
}

type PaymentDraft = {
  advancePayment: string
  advancePaymentMethod: string
  reservationNotes: string
  vatEditEnabled: boolean
  vatPercent: string
  discountEnabled: boolean
  discountType: BookingDiscountType
  discountValue: string
}

type ReservationWizardDraft = {
  step: number
  guest: GuestDraft
  stay: StayDraft
  payment: PaymentDraft
}

function emptyGuestDraft(): GuestDraft {
  return {
    selectedCustomerId: '',
    guestName: '',
    guestCompany: DEFAULT_GUEST_COMPANY,
    companyLedgerId: '',
    guestPhone: '',
    guestEmail: '',
    guestAddress: '',
    guestNationality: DEFAULT_NATIONALITY,
    idType: 'national_id',
    idNumber: '',
    registrationNumber: '',
    idDocuments: [],
    existingDocsStatus: 'idle',
  }
}

function emptyReservationDraft(vatPercent = String(DEFAULT_VAT_PERCENT)): ReservationWizardDraft {
  const dates = defaultStayDates()
  return {
    step: 1,
    guest: emptyGuestDraft(),
    stay: {
      selectedRoomId: '',
      checkInDate: dates.checkIn,
      checkOutDate: dates.checkOut,
      adults: '1',
      children: '0',
      withMeal: false,
    },
    payment: {
      advancePayment: '0',
      advancePaymentMethod: 'NONE',
      reservationNotes: '',
      vatEditEnabled: false,
      vatPercent,
      discountEnabled: false,
      discountType: 'PERCENTAGE',
      discountValue: '',
    },
  }
}

interface NewReservationWizardProps {
  editBookingId?: string
}

function toDatePickerValue(iso: string) {
  try {
    return format(parseISO(iso), 'yyyy-MM-dd')
  } catch {
    return format(new Date(iso), 'yyyy-MM-dd')
  }
}

export function NewReservationWizard({ editBookingId }: NewReservationWizardProps = {}) {
  const queryClient = useQueryClient()
  const isEditMode = !!editBookingId
  const [completedReservationId, setCompletedReservationId] = useState<string | null>(null)
  const [checkedInOnConfirm, setCheckedInOnConfirm] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isInitialFlow, setIsInitialFlow] = useState(isEditMode)
  const [initialFlowFieldError, setInitialFlowFieldError] = useState<string[] | null>(null)
  const [guestMode, setGuestMode] = useState<GuestMode>(isEditMode ? 'existing' : 'new')
  const [editDraftLoaded, setEditDraftLoaded] = useState(false)
  const [idEntryStarted, setIdEntryStarted] = useState(isEditMode)
  const [defaultVatPercent, setDefaultVatPercent] = useState(DEFAULT_VAT_PERCENT)
  const [guestEmailBlocking, setGuestEmailBlocking] = useState(false)
  const [guestEmailVerificationToken, setGuestEmailVerificationToken] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<GuestMode, ReservationWizardDraft>>({
    new: emptyReservationDraft(),
    existing: emptyReservationDraft(),
  })
  const { times, formatCheckIn, formatCheckOut } = useHotelTimes()

  const activeDraft = drafts[guestMode]
  const step = activeDraft.step
  const { guest, stay, payment } = activeDraft
  const {
    selectedCustomerId,
    guestName,
    guestCompany,
    companyLedgerId,
    guestPhone,
    guestEmail,
    guestAddress,
    guestNationality,
    idType,
    idNumber,
    registrationNumber,
    idDocuments,
    existingDocsStatus,
  } = guest
  const { selectedRoomId, checkInDate, checkOutDate, adults, children, withMeal } = stay
  const {
    advancePayment,
    advancePaymentMethod,
    reservationNotes,
    vatEditEnabled,
    vatPercent,
    discountEnabled,
    discountType,
    discountValue,
  } = payment

  type DraftPatch = {
    step?: number
    guest?: Partial<GuestDraft>
    stay?: Partial<StayDraft>
    payment?: Partial<PaymentDraft>
  }

  const patchDraft = (patch: DraftPatch) => {
    setDrafts((prev) => {
      const cur = prev[guestMode]
      return {
        ...prev,
        [guestMode]: {
          ...cur,
          ...(patch.step !== undefined ? { step: patch.step } : {}),
          guest: patch.guest ? { ...cur.guest, ...patch.guest } : cur.guest,
          stay: patch.stay ? { ...cur.stay, ...patch.stay } : cur.stay,
          payment: patch.payment ? { ...cur.payment, ...patch.payment } : cur.payment,
        },
      }
    })
  }

  const patchDraftFor = (mode: GuestMode, patch: DraftPatch) => {
    setDrafts((prev) => {
      const cur = prev[mode]
      return {
        ...prev,
        [mode]: {
          ...cur,
          ...(patch.step !== undefined ? { step: patch.step } : {}),
          guest: patch.guest ? { ...cur.guest, ...patch.guest } : cur.guest,
          stay: patch.stay ? { ...cur.stay, ...patch.stay } : cur.stay,
          payment: patch.payment ? { ...cur.payment, ...patch.payment } : cur.payment,
        },
      }
    })
  }

  const patchGuest = (patch: Partial<GuestDraft>) => patchDraft({ guest: patch })

  const handleNationalityChange = (value: string) => {
    const trimmed = value.trim()
    const isKnownCountry = NATIONALITY_OPTIONS.some(
      (country) => country.toLowerCase() === trimmed.toLowerCase()
    )
    const wasBangladesh = isBangladeshNationality(guestNationality)

    const guestPatch: Partial<GuestDraft> = { guestNationality: value }

    if (isKnownCountry) {
      const isNowBangladesh = isBangladeshNationality(trimmed)
      if (isNowBangladesh && !wasBangladesh) {
        guestPatch.idType = 'national_id'
      } else if (!isNowBangladesh) {
        guestPatch.idType = resolveIdTypeForNationality(trimmed, idType)
      } else {
        guestPatch.idType = resolveIdTypeForNationality(trimmed, idType)
      }
    }

    patchGuest(guestPatch)

    if (isKnownCountry && idDocuments.length === 0 && !idNumber.trim()) {
      revertToInitialStage(trimmed)
    }
  }
  const patchStay = (patch: Partial<StayDraft>) => patchDraft({ stay: patch })
  const patchPayment = (patch: Partial<PaymentDraft>) => patchDraft({ payment: patch })
  const setStep = (nextStep: number) => patchDraft({ step: nextStep })

  const datesValid = stayDatesValid(checkInDate, checkOutDate)

  const { data: roomsData, isLoading: roomsLoading } = useQuery({
    queryKey: ['available-rooms', checkInDate, checkOutDate],
    queryFn: () =>
      api.get<{ success: boolean; data: Room[] }>(
        `/rooms?forBooking=true&checkIn=${encodeURIComponent(checkInDate)}&checkOut=${encodeURIComponent(checkOutDate)}&limit=200`
      ),
    enabled: datesValid,
  })

  const { data: editBookingData, isLoading: editBookingLoading } = useQuery({
    queryKey: ['edit-booking', editBookingId],
    queryFn: () =>
      api.get<{ success: boolean; data: Record<string, unknown> }>(`/bookings/${editBookingId}`),
    enabled: isEditMode,
  })

  useEffect(() => {
    if (!isEditMode || editDraftLoaded) return
    const booking = (editBookingData as { data?: Record<string, unknown> })?.data
    if (!booking) return

    const customer = booking.customer as Record<string, unknown> | undefined
    const room = booking.room as { id?: string } | undefined
    const idDocs = (booking.idDocuments as { filePath: string }[] | undefined) ?? []

    setDrafts({
      new: emptyReservationDraft(String(booking.vatPercent ?? defaultVatPercent)),
      existing: {
        step: 1,
        guest: {
          selectedCustomerId: String(booking.customerId ?? ''),
          guestName: String(customer?.name ?? ''),
          guestCompany: formatGuestCompany(
            (booking.company as string | undefined) ?? (customer?.company as string | undefined)
          ),
          companyLedgerId: String(booking.companyLedgerId ?? ''),
          guestPhone: String(customer?.phone ?? ''),
          guestEmail: String(customer?.email ?? ''),
          guestAddress: String(customer?.address ?? ''),
          guestNationality: String(customer?.nationality ?? DEFAULT_NATIONALITY),
          idType:
            customer?.idType === 'passport' ||
            customer?.idType === 'driving_license' ||
            customer?.idType === 'national_id'
              ? (customer.idType as IdDocumentType)
              : 'national_id',
          idNumber: String(customer?.idNumber ?? ''),
          registrationNumber: String(customer?.registrationNumber ?? ''),
          idDocuments: idDocs.map((d) => ({ path: d.filePath, previewUrl: d.filePath })),
          existingDocsStatus: idDocs.length > 0 ? 'found' : 'none',
        },
        stay: {
          selectedRoomId: String(room?.id ?? booking.roomId ?? ''),
          checkInDate: toDatePickerValue(String(booking.checkIn)),
          checkOutDate: toDatePickerValue(String(booking.checkOut)),
          adults: String(booking.adults ?? 1),
          children: String(booking.children ?? 0),
          withMeal: booking.withMeal === true,
        },
        payment: {
          advancePayment: String(booking.advancePayment ?? 0),
          advancePaymentMethod: 'NONE',
          reservationNotes: String(booking.notes ?? ''),
          vatEditEnabled: false,
          vatPercent: String(booking.vatPercent ?? defaultVatPercent),
          discountEnabled: (booking as { discountEnabled?: boolean }).discountEnabled === true,
          discountType:
            (booking as { discountType?: string }).discountType === 'FIXED'
              ? 'FIXED'
              : 'PERCENTAGE',
          discountValue: String((booking as { discountValue?: number }).discountValue ?? ''),
        },
      },
    })
    setIsInitialFlow(true)
    setGuestMode('existing')
    setIdEntryStarted(true)
    setEditDraftLoaded(true)
  }, [isEditMode, editBookingData, editDraftLoaded, defaultVatPercent])

  const { data: billingSettingsData } = useQuery({
    queryKey: ['billing-settings'],
    queryFn: () =>
      api.get<{ success: boolean; data: { vatPercent: number; vatAppliedByDefault: boolean } }>(
        '/settings/billing'
      ),
  })

  useEffect(() => {
    const settings = (billingSettingsData as { data?: { vatPercent: number } })?.data
    if (settings?.vatPercent == null) return
    const rate = String(settings.vatPercent)
    setDefaultVatPercent(settings.vatPercent)
    setDrafts((prev) => ({
      new: {
        ...prev.new,
        payment: {
          ...prev.new.payment,
          vatPercent: prev.new.payment.vatEditEnabled ? prev.new.payment.vatPercent : rate,
        },
      },
      existing: {
        ...prev.existing,
        payment: {
          ...prev.existing.payment,
          vatPercent: prev.existing.payment.vatEditEnabled
            ? prev.existing.payment.vatPercent
            : rate,
        },
      },
    }))
  }, [billingSettingsData])

  const availableRooms = useMemo(() => {
    const rooms = (
      ((roomsData as { data?: Room[] })?.data || []) as Room[]
    ).filter((r) => r.status === 'AVAILABLE')

    if (!isEditMode || !selectedRoomId) return rooms
    if (rooms.some((r) => r.id === selectedRoomId)) return rooms

    const booking = (editBookingData as { data?: { room?: Room } })?.data
    const currentRoom = booking?.room
    if (currentRoom?.id === selectedRoomId) {
      return [...rooms, currentRoom]
    }
    return rooms
  }, [roomsData, isEditMode, selectedRoomId, editBookingData])

  useEffect(() => {
    if (selectedRoomId && !availableRooms.some((r) => r.id === selectedRoomId)) {
      patchStay({ selectedRoomId: '' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only clear stale room when availability changes
  }, [availableRooms, selectedRoomId, guestMode])

  const resetForm = () => {
    setCompletedReservationId(null)
    setCheckedInOnConfirm(false)
    setIsInitialFlow(isEditMode)
    setInitialFlowFieldError(null)
    setIdEntryStarted(isEditMode)
    setGuestMode(isEditMode ? 'existing' : 'new')
    if (isEditMode) {
      setEditDraftLoaded(false)
    } else {
      setDrafts({
        new: emptyReservationDraft(String(defaultVatPercent)),
        existing: emptyReservationDraft(String(defaultVatPercent)),
      })
    }
  }

  const handleScanComplete = (result: IdScanResult) => {
    if (guestMode !== 'new') return
    const patch: Partial<GuestDraft> = {}
    if (result.name) patch.guestName = result.name.trim()
    if (result.idNumber) patch.idNumber = result.idNumber.replace(/\D/g, '')
    if (result.idType) patch.idType = result.idType
    if (Object.keys(patch).length > 0) patchDraftFor('new', { guest: patch })
  }

  const revertToInitialStage = (nationalityOverride?: string) => {
    const nationality = nationalityOverride ?? guestNationality
    setIdEntryStarted(false)
    if (!isEditMode) {
      setIsInitialFlow(true)
      patchGuest({
        idNumber: '',
        idType: resolveIdTypeForNationality(nationality, 'national_id'),
      })
    }
  }

  const handleIdDocumentsChange = (docs: IdDocumentItem[]) => {
    if (docs.length > 0) {
      setIsInitialFlow(false)
      setIdEntryStarted(true)
      patchGuest({
        idDocuments: docs,
        ...(guestMode === 'existing' ? { existingDocsStatus: 'found' as const } : {}),
      })
      return
    }

    patchGuest({
      idDocuments: [],
      ...(guestMode === 'existing' ? { existingDocsStatus: 'none' as const } : {}),
    })
    revertToInitialStage()
  }

  const loadGuestIdDocuments = async (customerId: string) => {
    patchDraftFor('existing', { guest: { existingDocsStatus: 'loading' } })
    try {
      const res = (await api.get<{ success: boolean; data: { paths: string[] } }>(
        `/customers/${customerId}/id-documents`
      )) as { success?: boolean; data?: { paths: string[] } }
      const paths = res.data?.paths ?? []
      patchDraftFor('existing', {
        guest: {
          idDocuments: paths.map((path) => ({ path, previewUrl: path })),
          existingDocsStatus: paths.length > 0 ? 'found' : 'none',
        },
      })
    } catch {
      patchDraftFor('existing', {
        guest: { idDocuments: [], existingDocsStatus: 'none' },
      })
    }
  }

  const applyExistingGuest = (selected: GuestSearchResult) => {
    const idTypeValue =
      selected.idType === 'national_id' ||
      selected.idType === 'passport' ||
      selected.idType === 'driving_license'
        ? selected.idType
        : drafts.existing.guest.idType

    patchDraftFor('existing', {
      guest: {
        selectedCustomerId: selected.id,
        guestName: selected.name,
        guestCompany: formatGuestCompany(selected.company),
        guestPhone: selected.phone,
        guestEmail: selected.email || '',
        guestAddress: selected.address || '',
        guestNationality: selected.nationality?.trim() || DEFAULT_NATIONALITY,
        idType: resolveIdTypeForNationality(
          selected.nationality?.trim() || DEFAULT_NATIONALITY,
          idTypeValue
        ),
        idNumber: selected.idNumber || '',
        // Registration is per reservation — never pre-fill from the guest profile.
        registrationNumber: '',
      },
    })
    void loadGuestIdDocuments(selected.id)
  }

  const clearExistingGuest = () => {
    patchDraftFor('existing', { guest: emptyGuestDraft() })
  }

  const estimatedRoomCharge = () => {
    if (!checkInDate || !checkOutDate || !selectedRoomId) return 0
    const room = availableRooms.find((r) => r.id === selectedRoomId)
    if (!room) return 0
    try {
      const ci = applyHotelTimeToBookingInput(checkInDate, times.checkInTime)
      const co = applyHotelTimeToBookingInput(checkOutDate, times.checkOutTime)
      const nights = countHotelStayNights(ci, co)
      return nights * room.type.basePrice
    } catch {
      return 0
    }
  }

  const parsedVatPercent = () => {
    const n = parseFloat(vatPercent)
    return Number.isNaN(n) || n < 0 ? defaultVatPercent : n
  }

  /** VAT rate used for totals — settings default unless edit mode is on. */
  const effectiveVatPercent = () =>
    vatEditEnabled ? parsedVatPercent() : defaultVatPercent

  const vatOptions = () => ({
    vatApplied: true,
    vatPercent: effectiveVatPercent(),
  })

  const parsedDiscountValue = () => Math.max(0, parseFloat(discountValue) || 0)

  const discountInput = () => ({
    discountEnabled,
    discountType,
    discountValue: parsedDiscountValue(),
  })

  const estimatedTotals = () => {
    const roomCharge = estimatedRoomCharge()
    const advance = parseFloat(advancePayment) || 0
    return computeRoomBookingTotals(roomCharge, advance, vatOptions(), discountInput())
  }

  const createCustomerMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('/customers', data),
  })

  const createReservationMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('/bookings', data),
  })

  const resolvedGuestNationality = () => guestNationality.trim() || DEFAULT_NATIONALITY

  const buildGuestProfilePayload = () => ({
    name: guestName.trim(),
    company: formatGuestCompany(guestCompany),
    phone: guestPhone.trim(),
    email: guestEmail.trim() || null,
    emailVerificationToken: guestEmailVerificationToken || undefined,
    address: guestAddress.trim() || null,
    nationality: resolvedGuestNationality(),
    idType,
    idNumber: idNumber.trim() || null,
    registrationNumber: registrationNumber.trim() || null,
    idDocPath: idDocuments[0]?.path || null,
  })

  const syncGuestProfile = async (customerId: string): Promise<boolean> => {
    const updateRes = (await api.put(`/customers/${customerId}`, buildGuestProfilePayload())) as {
      success?: boolean
      error?: string
    }

    if (!updateRes?.success) {
      toast.error(updateRes?.error || 'Failed to update guest profile')
      return false
    }

    return true
  }

  const resolveCustomerId = async (options?: {
    skipIdRequirement?: boolean
  }): Promise<string | null> => {
    if (!options?.skipIdRequirement && idDocuments.length === 0) {
      toast.error('Upload or scan at least one ID image before continuing')
      return null
    }

    if (guestMode === 'existing') {
      if (!selectedCustomerId) {
        toast.error('Please select a guest')
        return null
      }
      if (!guestName.trim() || !guestPhone.trim()) {
        toast.error('Guest name and phone are required')
        return null
      }
      if (!resolvedGuestNationality()) {
        toast.error('Nationality is required')
        return null
      }

      if (!(await syncGuestProfile(selectedCustomerId))) {
        return null
      }

      return selectedCustomerId
    }

    if (!guestName.trim() || !guestPhone.trim()) {
      toast.error('Guest name and phone are required')
      return null
    }
    if (!resolvedGuestNationality()) {
      toast.error('Nationality is required')
      return null
    }

    const res = (await createCustomerMutation.mutateAsync({
      ...buildGuestProfilePayload(),
      email: guestEmail.trim() || undefined,
      address: guestAddress.trim() || undefined,
      idNumber: idNumber.trim() || undefined,
      registrationNumber: registrationNumber.trim() || undefined,
      idDocPath: idDocuments[0]?.path || undefined,
    })) as { success?: boolean; data?: { id: string }; error?: string; message?: string }

    if (!res?.success || !res.data?.id) {
      toast.error(res?.error || res?.message || 'Failed to create guest profile')
      return null
    }

    if (res.message?.includes('already exists')) {
      toast.info('Guest profile found for this phone — continuing with existing record.')
    }

    if (!(await syncGuestProfile(res.data.id))) {
      return null
    }

    return res.data.id
  }

  const finishReservation = (
    bookingId: string,
    withCheckIn: boolean,
    kind: 'initial' | 'full' | 'updated' | 'completed' = 'full'
  ) => {
    setCheckedInOnConfirm(withCheckIn)
    setCompletedReservationId(bookingId)
    patchDraft({ step: 5 })
    queryClient.invalidateQueries({ queryKey: ['bookings'] })
    queryClient.invalidateQueries({ queryKey: ['customers-list'] })
    queryClient.invalidateQueries({ queryKey: ['customers'] })
    queryClient.invalidateQueries({ queryKey: ['available-rooms'] })
    queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    queryClient.invalidateQueries({ queryKey: ['rooms'] })
      queryClient.invalidateQueries({ queryKey: ['edit-booking', bookingId] })
      queryClient.invalidateQueries({ queryKey: ['reservation-document', bookingId] })
      queryClient.invalidateQueries({ queryKey: ['company-ledger-options'] })
      queryClient.invalidateQueries({ queryKey: ['company-ledger'] })

    const messages: Record<typeof kind, string> = {
      initial: 'Initial reservation saved — complete ID details later from bookings',
      full: 'Reservation created — print or download your document below',
      updated: 'Initial reservation updated — print or download your document below',
      completed: 'Reservation completed — print or download your document below',
    }
    toast.success(
      withCheckIn ? 'Reservation confirmed and guest checked in' : messages[kind]
    )
  }

  const submitReservation = async (options: {
    withCheckIn?: boolean
    asInitial?: boolean
    completeInitial?: boolean
  }) => {
    const { withCheckIn = false, asInitial = false, completeInitial = false } = options
    const skipId = asInitial || (isInitialFlow && !completeInitial)
    const customerId = await resolveCustomerId({ skipIdRequirement: skipId })
    if (!customerId || !selectedRoomId || !checkInDate || !checkOutDate) return

    if (!guestNationality.trim()) {
      toast.error('Nationality is required')
      return
    }

    if (completeInitial) {
      const missing = getCompleteReservationMissingFields({
        nationality: guestNationality,
        idNumber,
        email: guestEmail,
        address: guestAddress,
        registrationNumber,
        idDocumentCount: idDocuments.length,
      })
      if (missing.length > 0) {
        toast.error(`Please fill required fields: ${missing.join(', ')}`)
        return
      }
      if (guestEmailBlocking) {
        toast.error('Verify the guest email before completing the reservation')
        return
      }
    }

    setIsSubmitting(true)
    try {
      const idPaths =
        idDocuments.length > 0 ? idDocuments.map((d) => d.path) : undefined

      if (isEditMode && editBookingId) {
        const res = (await api.put(`/bookings/${editBookingId}`, {
          company: formatGuestCompany(guestCompany),
          roomId: selectedRoomId,
          checkIn: checkInDate,
          checkOut: checkOutDate,
          adults: parseInt(adults, 10),
          children: parseInt(children, 10),
          notes: reservationNotes.trim() || undefined,
          idDocumentPaths: idPaths,
          vatPercent: effectiveVatPercent(),
          withMeal,
          discountEnabled,
          discountType,
          discountValue: discountEnabled ? parsedDiscountValue() : 0,
          isInitialReservation: completeInitial ? false : true,
          customer: {
            name: guestName.trim(),
            phone: guestPhone.trim(),
            email: guestEmail.trim() || null,
            emailVerificationToken: guestEmailVerificationToken || undefined,
            address: guestAddress.trim() || null,
            nationality: guestNationality.trim() || DEFAULT_NATIONALITY,
            idType,
            idNumber: idNumber.trim() || null,
            registrationNumber: registrationNumber.trim() || null,
            idDocPath: idDocuments[0]?.path || null,
          },
        })) as { success?: boolean; data?: { id: string }; error?: string; message?: string }

        if (!res?.success) {
          toast.error(res?.error || res?.message || 'Failed to update reservation')
          return
        }

        finishReservation(
          editBookingId,
          false,
          completeInitial ? 'completed' : 'updated'
        )
        return
      }

      const saveAsInitial = asInitial || (isInitialFlow && idDocuments.length === 0)

      const res = (await createReservationMutation.mutateAsync({
        customerId,
        company: formatGuestCompany(guestCompany),
        companyLedgerId: companyLedgerId || undefined,
        roomId: selectedRoomId,
        checkIn: checkInDate,
        checkOut: checkOutDate,
        adults: parseInt(adults, 10),
        children: parseInt(children, 10),
        advancePayment: parseFloat(advancePayment) || 0,
        paymentMethod: advancePaymentMethod,
        notes: reservationNotes.trim() || undefined,
        idDocumentPaths: idPaths,
        vatApplied: true,
        vatPercent: effectiveVatPercent(),
        checkInNow: withCheckIn,
        isInitialReservation: saveAsInitial,
        withMeal,
        discountEnabled,
        discountType,
        discountValue: discountEnabled ? parsedDiscountValue() : 0,
      })) as {
        success?: boolean
        data?: { id: string; status?: string }
        error?: string
        message?: string
      }

      if (!res?.success || !res.data?.id) {
        toast.error(res?.error || res?.message || 'Failed to create reservation')
        return
      }

      const bookingId = res.data.id
      let didCheckIn = withCheckIn && res.data.status === 'CHECKED_IN'

      if (withCheckIn && !didCheckIn) {
        const checkInRes = (await api.post(`/bookings/check-in/${bookingId}`, {
          initialPayment: 0,
          paymentMethod: 'CASH',
        })) as { success?: boolean; error?: string; message?: string }

        if (!checkInRes?.success) {
          toast.error(checkInRes?.error || checkInRes?.message || 'Reservation saved but check-in failed')
          finishReservation(bookingId, false, saveAsInitial ? 'initial' : 'full')
          return
        }
        didCheckIn = true
      }

      finishReservation(bookingId, didCheckIn, saveAsInitial ? 'initial' : 'full')
    } catch {
      toast.error(isEditMode ? 'Failed to update reservation' : 'Failed to create reservation')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleConfirm = () => void submitReservation({ withCheckIn: false })
  const handleConfirmInitial = () => void submitReservation({ asInitial: true })
  const handleCompleteInitial = () => void submitReservation({ completeInitial: true })
  const handleConfirmWithCheckIn = () => void submitReservation({ withCheckIn: true })

  const hasRequiredIdDocs = idDocuments.length > 0
  const hasIdActivity = idDocuments.length > 0 || Boolean(idNumber.trim())
  const showCompleteRequiredMarkers = isEditMode
    ? hasIdActivity
    : !isInitialFlow && hasIdActivity
  const completeReservationMissing = getCompleteReservationMissingFields({
    nationality: guestNationality,
    idNumber,
    email: guestEmail,
    address: guestAddress,
    registrationNumber,
    idDocumentCount: idDocuments.length,
  })
  const canCompleteReservation = completeReservationMissing.length === 0
  const initialMissingFields = getInitialReservationGuestMissingFields(guestMode, {
    selectedCustomerId,
    guestName,
    guestPhone,
    guestNationality,
  })
  const guestDetailsReady = initialMissingFields.length === 0
  /** Step 1: initial fields only, or all completion fields once ID entry has started / full reservation. */
  const guestEmailInvalid = Boolean(guestEmail.trim()) && guestEmailBlocking
  const canGoStep2 =
    guestDetailsReady &&
    !guestEmailInvalid &&
    (isInitialFlow && !hasIdActivity ? true : completeReservationMissing.length === 0)
  const canGoStep3 = datesValid && Boolean(selectedRoomId) && !roomsLoading
  const advanceAmount = parseFloat(advancePayment) || 0
  const canGoStep4 =
    (!discountEnabled || parsedDiscountValue() > 0) &&
    (advanceAmount <= 0 || (advanceAmount > 0 && advancePaymentMethod !== 'NONE'))
  const canProceedToNextStep =
    step === 1 ? canGoStep2 : step === 2 ? canGoStep3 : step === 3 ? canGoStep4 : true
  const showInitialReservationOption =
    !isEditMode && idDocuments.length === 0 && !hasIdActivity

  useEffect(() => {
    if (initialMissingFields.length === 0) {
      setInitialFlowFieldError(null)
    }
  }, [initialMissingFields.length])

  const handleStartInitialReservation = () => {
    const missing = getInitialReservationGuestMissingFields(guestMode, {
      selectedCustomerId,
      guestName,
      guestPhone,
      guestNationality,
    })
    if (missing.length > 0) {
      setInitialFlowFieldError(missing)
      toast.error(`Please fill required fields: ${missing.join(', ')}`)
      return
    }
    setInitialFlowFieldError(null)
    setIsInitialFlow(true)
    setStep(2)
  }
  const showGuestDetails = guestMode === 'new' || !!selectedCustomerId

  const displayStep = completedReservationId ? 5 : step

  if (isEditMode && editBookingLoading && !editDraftLoaded) {
    return <p className="text-sm text-muted-foreground">Loading reservation…</p>
  }

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        {STEP_LABELS.map((label, i) => {
          const s = i + 1
          return (
            <div key={label} className="flex items-center gap-2">
              <div
                className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ${
                  displayStep >= s ? 'bg-amber-100 text-amber-800' : 'bg-muted text-muted-foreground'
                }`}
              >
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
                    displayStep >= s ? 'bg-amber-600 text-white' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {displayStep > s ? '✓' : s}
                </span>
                {label}
              </div>
              {s < STEP_LABELS.length && (
                <div className={`hidden sm:block w-6 h-0.5 ${displayStep > s ? 'bg-amber-500' : 'bg-border'}`} />
              )}
            </div>
          )
        })}
      </div>

      {displayStep === 5 && completedReservationId ? (
        <div className="space-y-6">
          <Card className="border-emerald-200 bg-emerald-50 print:hidden">
            <CardContent className="p-4 flex items-start gap-3">
              <CheckCircle2 className="h-8 w-8 text-emerald-600 shrink-0" />
              <div>
                <h2 className="font-semibold text-emerald-900">
                  {checkedInOnConfirm ? 'Reservation confirmed & checked in' : 'Reservation confirmed'}
                </h2>
                <p className="text-sm text-emerald-800 mt-1">
                  {checkedInOnConfirm
                    ? 'Guest is checked in and the room is marked occupied. Print or download the document below.'
                    : 'Your reservation is saved. Print or download the document below, then close this tab or create another reservation.'}
                </p>
              </div>
            </CardContent>
          </Card>

          <ReservationDocumentView
            reservationId={completedReservationId}
            showToolbar
            onClose={() => window.close()}
          />

          <div className="flex flex-wrap gap-3 print:hidden">
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => {
                resetForm()
              }}
            >
              <Plus className="h-4 w-4" />
              Create another reservation
            </Button>
            <Button variant="ghost" onClick={() => window.close()}>
              Close tab
            </Button>
          </div>
        </div>
      ) : (
        <>
          {step === 1 && (
            <div className="space-y-4">
              {!isEditMode && (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={guestMode === 'new' ? 'default' : 'outline'}
                    size="sm"
                    className={guestMode === 'new' ? 'bg-amber-600 hover:bg-amber-700' : ''}
                    onClick={() => {
                      setGuestMode('new')
                      setIsInitialFlow(false)
                    }}
                  >
                    New guest
                  </Button>
                  <Button
                    type="button"
                    variant={guestMode === 'existing' ? 'default' : 'outline'}
                    size="sm"
                    className={guestMode === 'existing' ? 'bg-amber-600 hover:bg-amber-700' : ''}
                    onClick={() => setGuestMode('existing')}
                  >
                    Existing guest
                  </Button>
                </div>
              )}
              {isEditMode && (
                <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Editing initial reservation — fill all fields marked * (NID, email, address,
                  registration number, and ID images), then use Complete reservation before check-in.
                </div>
              )}

              {guestMode === 'existing' && (
                <>
                  <GuestSearchField
                    selectedId={selectedCustomerId}
                    selectedLabel={
                      selectedCustomerId
                        ? `${guestName || 'Guest'}${guestPhone ? ` — ${guestPhone}` : ''}`
                        : undefined
                    }
                    onSelect={applyExistingGuest}
                    onClear={clearExistingGuest}
                  />
                  {!selectedCustomerId && (
                    <p className="text-sm text-muted-foreground">
                      Search and select a guest to load their profile and ID documents.
                    </p>
                  )}
                </>
              )}

              {showGuestDetails && (
                <>
                  {existingDocsStatus === 'loading' && (
                    <p className="text-sm text-muted-foreground">Loading previous ID files…</p>
                  )}
                  {guestMode === 'existing' &&
                    existingDocsStatus === 'none' &&
                    showInitialReservationOption &&
                    !isInitialFlow && (
                      <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                        No previous ID files found for this guest. Upload ID documents or use{' '}
                        <strong>Initial reservation</strong> to continue without ID for now.
                      </div>
                    )}
                  {guestMode === 'new' && showInitialReservationOption && !isInitialFlow && (
                    <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      Upload or scan at least one ID image to continue — or use{' '}
                      <strong>Initial reservation</strong> below to save without ID for now.
                    </div>
                  )}
                  {isInitialFlow && showInitialReservationOption && (
                    <div className="rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900">
                      <strong>Initial reservation</strong> — guest name, phone, and nationality for
                      now. NID and ID images can be added later before check-in. Missing fields will
                      show on the confirmation document.
                    </div>
                  )}

                  <NationalityField
                    value={guestNationality}
                    onChange={handleNationalityChange}
                    label="Nationality *"
                    placeholder="Select nationality…"
                  />

                  {showCompleteRequiredMarkers && (
                    <p className="text-sm font-medium text-foreground">ID document images *</p>
                  )}

                  <IdDocumentScanner
                nationality={guestNationality}
                idType={idType}
                onIdTypeChange={(type) => {
                  patchGuest({ idType: type })
                  if (idDocuments.length > 0 || idNumber.trim()) {
                    setIsInitialFlow(false)
                    setIdEntryStarted(true)
                  } else if (type === 'passport' || type === 'driving_license') {
                    setIsInitialFlow(false)
                    setIdEntryStarted(true)
                  } else if (idDocuments.length === 0 && !idNumber.trim()) {
                    revertToInitialStage()
                  }
                }}
                documents={idDocuments}
                onDocumentsChange={handleIdDocumentsChange}
                onScanComplete={(result) => {
                  if (result.documents.length > 0) {
                    setIsInitialFlow(false)
                    setIdEntryStarted(true)
                    handleScanComplete(result)
                  } else {
                    revertToInitialStage()
                  }
                }}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Full name *</Label>
                      <Input
                        value={guestName}
                        onChange={(e) => patchGuest({ guestName: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Company</Label>
                      <CompanyLedgerSearchField
                        selectedLedgerId={companyLedgerId}
                        selectedLabel={guestCompany}
                        onSelect={(company) =>
                          patchGuest({
                            companyLedgerId: company.id,
                            guestCompany: company.name,
                          })
                        }
                        onClear={() =>
                          patchGuest({
                            companyLedgerId: '',
                            guestCompany: DEFAULT_GUEST_COMPANY,
                          })
                        }
                      />
                      {companyLedgerId ? (
                        <p className="text-xs text-muted-foreground">
                          Guest will be added to this company ledger on reservation. Checkout can be
                          billed to the company without payment.
                        </p>
                      ) : null}
                    </div>
                    <div className="space-y-1">
                      <Label>
                        NID / Passport number{showCompleteRequiredMarkers ? ' *' : ''}
                      </Label>
                      <Input
                        value={idNumber}
                        onChange={(e) => {
                          const value = e.target.value
                          if (value.trim()) {
                            setIsInitialFlow(false)
                            setIdEntryStarted(true)
                          } else if (idDocuments.length === 0) {
                            revertToInitialStage()
                          }
                          patchGuest({ idNumber: value })
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>
                        Registration number{showCompleteRequiredMarkers ? ' *' : ''}
                      </Label>
                      <Input
                        value={registrationNumber}
                        onChange={(e) => patchGuest({ registrationNumber: e.target.value })}
                        placeholder="Guest registration / reference no."
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Phone *</Label>
                      <Input
                        id={guestMode === 'new' ? 'guest-phone' : undefined}
                        value={guestPhone}
                        onChange={(e) => patchGuest({ guestPhone: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Email{showCompleteRequiredMarkers ? ' *' : ''}</Label>
                      <EmailInput
                        value={guestEmail}
                        onChange={(email) => patchGuest({ guestEmail: email })}
                        optional={!showCompleteRequiredMarkers}
                        onValidationChange={(result) => {
                          setGuestEmailBlocking(result.isBlocking)
                          setGuestEmailVerificationToken(result.verificationToken ?? null)
                        }}
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <Label>Address{showCompleteRequiredMarkers ? ' *' : ''}</Label>
                      <Input
                        value={guestAddress}
                        onChange={(e) => patchGuest({ guestAddress: e.target.value })}
                      />
                    </div>
                {idDocuments.length > 0 ? (
                  <p className="text-xs text-emerald-600 sm:col-span-2">
                    {idDocuments.length} ID image(s) attached — included on confirmation page 2
                  </p>
                ) : isInitialFlow ? (
                  <p className="text-xs text-sky-700 sm:col-span-2">
                    ID images optional for initial reservation
                    {showCompleteRequiredMarkers ? ' (required * to complete)' : ' — add before check-in'}.
                  </p>
                ) : (
                  <p className="text-xs text-amber-700 sm:col-span-2">
                    At least one ID image is required, or continue as initial reservation below.
                  </p>
                )}
              </div>
                </>
              )}
              {showInitialReservationOption && (
                <>
                  {initialFlowFieldError && initialFlowFieldError.length > 0 && (
                    <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
                      <p className="font-medium">Required fields to continue as initial reservation:</p>
                      <ul className="mt-1 list-disc pl-5">
                        {initialFlowFieldError.map((field) => (
                          <li key={field}>{field}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full border-sky-400 text-sky-800 hover:bg-sky-50"
                    onClick={handleStartInitialReservation}
                  >
                    <FilePenLine className="h-4 w-4 mr-2" />
                    Continue as initial reservation (without ID for now)
                  </Button>
                  <p className="text-xs text-muted-foreground text-center">
                    Requires full name, phone, and nationality
                    {guestMode === 'existing' ? ', and guest selection' : ''}. NID and ID images can
                    be added later.
                  </p>
                </>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground rounded-md bg-muted/50 p-2">
                {describeStayPeriod(times)}
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Arrival date *</Label>
                  <Input
                    type="date"
                    value={checkInDate}
                    onChange={(e) => {
                      const nextIn = e.target.value
                      const patch: Partial<StayDraft> = { checkInDate: nextIn }
                      const minOut = minCheckoutDatePickerValue(nextIn)
                      if (minOut && checkOutDate && checkOutDate <= nextIn) {
                        patch.checkOutDate = minOut
                      }
                      patchStay(patch)
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Check-in from {formatTime12h(times.checkInTime)}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Departure date *</Label>
                  <Input
                    type="date"
                    min={minCheckoutDatePickerValue(checkInDate)}
                    value={checkOutDate}
                    onChange={(e) => patchStay({ checkOutDate: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Check-out by {formatTime12h(times.checkOutTime)} on this day
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Room *</Label>
                <Select
                  value={selectedRoomId}
                  onValueChange={(value) => patchStay({ selectedRoomId: value })}
                  disabled={!datesValid || roomsLoading}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        !datesValid
                          ? 'Select valid check-in and check-out dates'
                          : roomsLoading
                            ? 'Loading available rooms...'
                            : availableRooms.length === 0
                              ? 'No rooms available for these dates'
                              : 'Choose room'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {availableRooms.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        Room {r.roomNumber} — {r.type.name} (৳{r.type.basePrice}/night)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {datesValid && !roomsLoading && (
                  <p className="text-xs text-muted-foreground">
                    {availableRooms.length} room{availableRooms.length === 1 ? '' : 's'} available for this stay
                  </p>
                )}
              </div>
              <Card className="border-amber-200 bg-amber-50/40">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-amber-900">Meal plan</p>
                      <p className="text-xs text-muted-foreground">
                        {withMeal
                          ? 'Full board with breakfast complimentary — shown on confirmation document'
                          : 'Breakfast (complementary) — shown on confirmation document'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`text-xs font-medium ${!withMeal ? 'text-amber-900' : 'text-muted-foreground'}`}
                      >
                        Without meal
                      </span>
                      <Switch
                        checked={withMeal}
                        onCheckedChange={(on) => patchStay({ withMeal: on })}
                        aria-label="With meal"
                      />
                      <span
                        className={`text-xs font-medium ${withMeal ? 'text-amber-900' : 'text-muted-foreground'}`}
                      >
                        With meal
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-amber-800">
                    Meal plan on document:{' '}
                    <strong>{formatReservationMealPlan(withMeal)}</strong>
                  </p>
                </CardContent>
              </Card>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Adults</Label>
                  <Input
                    type="number"
                    min={1}
                    value={adults}
                    onChange={(e) => patchStay({ adults: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Children</Label>
                  <Input
                    type="number"
                    min={0}
                    value={children}
                    onChange={(e) => patchStay({ children: e.target.value })}
                  />
                </div>
              </div>
              {estimatedRoomCharge() > 0 && (
                <Card className="bg-amber-50 border-amber-200">
                  <CardContent className="p-3 text-sm font-medium text-amber-800">
                    Estimated total: ৳{estimatedTotals().totalWithVat.toLocaleString()}
                    {` (incl. VAT ${effectiveVatPercent()}%)`}
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <Card className="border-amber-200 bg-amber-50/40">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-amber-900">VAT</p>
                      <p className="text-xs text-muted-foreground">
                        Applied at {effectiveVatPercent()}%
                        {!vatEditEnabled ? ' (from settings)' : ' (custom rate)'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Edit</span>
                      <span className="text-xs font-medium text-amber-900 min-w-[22px]">
                        {vatEditEnabled ? 'On' : 'Off'}
                      </span>
                      <Switch
                        checked={vatEditEnabled}
                        onCheckedChange={(on) => {
                          patchPayment({
                            vatEditEnabled: on,
                            ...(on && (!vatPercent || vatPercent === '0')
                              ? { vatPercent: String(defaultVatPercent) }
                              : {}),
                          })
                        }}
                      />
                    </div>
                  </div>
                  {vatEditEnabled ? (
                    <div className="space-y-1">
                      <Label className="text-xs">VAT rate (%)</Label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step={VAT_PERCENT_INPUT_STEP}
                        value={vatPercent}
                        onChange={(e) => patchPayment({ vatPercent: e.target.value })}
                        className="h-9 bg-card"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Override the default rate for this reservation only.
                      </p>
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      Turn <strong>Edit</strong> on to change the VAT rate for this booking.
                    </p>
                  )}
                </CardContent>
              </Card>
              <Card className="border-emerald-200 bg-emerald-50/40">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-emerald-900">Discount</p>
                      <p className="text-xs text-muted-foreground">
                        Applied to room charge before VAT
                      </p>
                    </div>
                    <Switch
                      checked={discountEnabled}
                      onCheckedChange={(on) => {
                        patchPayment({
                          discountEnabled: on,
                          ...(!on ? { discountValue: '' } : {}),
                        })
                      }}
                    />
                  </div>
                  {discountEnabled && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Discount type</Label>
                        <Select
                          value={discountType}
                          onValueChange={(value) =>
                            patchPayment({ discountType: value as BookingDiscountType })
                          }
                        >
                          <SelectTrigger className="h-9 bg-card">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="PERCENTAGE">Percentage (%)</SelectItem>
                            <SelectItem value="FIXED">Fixed amount (BDT)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">
                          {discountType === 'PERCENTAGE' ? 'Discount (%)' : 'Discount (BDT)'}
                        </Label>
                        <Input
                          type="text"
                          inputMode="decimal"
                          value={discountValue}
                          onChange={(e) => patchPayment({ discountValue: e.target.value })}
                          placeholder={discountType === 'PERCENTAGE' ? 'e.g. 10' : 'e.g. 500'}
                          className="h-9 bg-card"
                        />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Advance payment (BDT)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={advancePayment}
                    onChange={(e) => patchPayment({ advancePayment: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Form of payment</Label>
                  <Select
                    value={advancePaymentMethod}
                    onValueChange={(value) => patchPayment({ advancePaymentMethod: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select method" />
                    </SelectTrigger>
                    <SelectContent>
                      {PAYMENT_METHOD_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Shown on the reservation confirmation (print/PDF).
                  </p>
                </div>
              </div>
              <Card className="bg-muted/50">
                <CardContent className="p-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>Room charge</span>
                    <span>৳{estimatedRoomCharge().toLocaleString()}</span>
                  </div>
                  {discountEnabled && estimatedTotals().discountAmount > 0 && (
                    <div className="flex justify-between text-emerald-700">
                      <span>
                        Discount
                        {discountType === 'PERCENTAGE' ? ` (${parsedDiscountValue()}%)` : ''}
                      </span>
                      <span>-৳{estimatedTotals().discountAmount.toLocaleString()}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>VAT ({effectiveVatPercent()}%)</span>
                    <span>৳{estimatedTotals().vatAmount.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Total (incl. VAT)</span>
                    <span>৳{estimatedTotals().totalWithVat.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Advance paid</span>
                    <span>৳{(parseFloat(advancePayment) || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Form of payment</span>
                    <span>
                      {(parseFloat(advancePayment) || 0) > 0 && advancePaymentMethod !== 'NONE'
                        ? formatPaymentMethod(advancePaymentMethod)
                        : 'Not paid at booking'}
                    </span>
                  </div>
                  <div className="flex justify-between font-bold border-t pt-2">
                    <span>Due (incl. VAT)</span>
                    <span className="text-red-600">
                      ৳{estimatedTotals().dueAmount.toLocaleString()}
                    </span>
                  </div>
                </CardContent>
              </Card>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  value={reservationNotes}
                  onChange={(e) => patchPayment({ reservationNotes: e.target.value })}
                  rows={2}
                />
              </div>
            </div>
          )}

          {step === 4 && (
            <Card>
              <CardContent className="p-4 space-y-2 text-sm">
                <h3 className="font-semibold">Reservation summary</h3>
                <div className="grid grid-cols-2 gap-2">
                  <span className="text-muted-foreground">Guest</span>
                  <span className="font-medium">
                    {guestName || '—'}
                  </span>
                  <span className="text-muted-foreground">Company</span>
                  <span>{formatGuestCompany(guestCompany)}</span>
                  <span className="text-muted-foreground">Room</span>
                  <span>{availableRooms.find((r) => r.id === selectedRoomId)?.roomNumber}</span>
                  <span className="text-muted-foreground">Check-in</span>
                  <span>{checkInDate ? formatCheckIn(checkInDate) : '—'}</span>
                  <span className="text-muted-foreground">Check-out</span>
                  <span>{checkOutDate ? formatCheckOut(checkOutDate) : '—'}</span>
                  <span className="text-muted-foreground">Meal plan</span>
                  <span>{formatReservationMealPlan(withMeal)}</span>
                  {discountEnabled && estimatedTotals().discountAmount > 0 && (
                    <>
                      <span className="text-muted-foreground">Discount</span>
                      <span className="text-emerald-700">
                        -৳{estimatedTotals().discountAmount.toLocaleString()}
                      </span>
                    </>
                  )}
                  <span className="text-muted-foreground">
                    Total (incl. VAT)
                  </span>
                  <span>৳{estimatedTotals().totalWithVat.toLocaleString()}</span>
                  <span className="text-muted-foreground">
                    Due (incl. VAT)
                  </span>
                  <span className="text-red-600 font-medium">
                    ৳{estimatedTotals().dueAmount.toLocaleString()}
                  </span>
                  <span className="text-muted-foreground">Advance paid</span>
                  <span>৳{(parseFloat(advancePayment) || 0).toLocaleString()}</span>
                  <span className="text-muted-foreground">Form of payment</span>
                  <span>
                    {(parseFloat(advancePayment) || 0) > 0
                      ? formatPaymentMethod(advancePaymentMethod)
                      : 'Not paid at booking'}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground pt-2">
                  {isInitialFlow && !hasRequiredIdDocs ? (
                    <>
                      Use <strong>Save initial reservation</strong> to save without ID. You can edit
                      and complete guest details from bookings before check-in.
                    </>
                  ) : isEditMode ? (
                    <>
                      Use <strong>Save changes</strong> to keep as initial, or{' '}
                      <strong>Complete reservation</strong> when all fields marked * are filled,
                      including ID images.
                    </>
                  ) : (
                    <>
                      Use <strong>Confirm reservation</strong> to save as reserved only, or{' '}
                      <strong>Confirm reservation with check-in</strong> to check the guest in
                      immediately (room marked occupied).
                    </>
                  )}
                </p>
              </CardContent>
            </Card>
          )}

          <div className="flex flex-wrap gap-2 pt-2 border-t">
            {step > 1 && (
              <Button variant="outline" onClick={() => setStep(Math.max(1, step - 1))}>
                Back
              </Button>
            )}
            {step < 4 ? (
              <Button
                className="bg-amber-600 hover:bg-amber-700 text-white ml-auto"
                disabled={!canProceedToNextStep}
                onClick={() => setStep(Math.min(4, step + 1))}
              >
                Next
              </Button>
            ) : (
              <>
                {isEditMode ? (
                  <>
                    <Button
                      variant="outline"
                      className="ml-auto"
                      disabled={isSubmitting}
                      onClick={() => void submitReservation({})}
                    >
                      {isSubmitting ? 'Please wait...' : 'Save changes'}
                    </Button>
                    <Button
                      className="bg-amber-600 hover:bg-amber-700 text-white"
                      disabled={isSubmitting || !canCompleteReservation}
                      onClick={handleCompleteInitial}
                    >
                      {isSubmitting ? 'Please wait...' : 'Complete reservation'}
                    </Button>
                  </>
                ) : isInitialFlow && !hasRequiredIdDocs ? (
                  <Button
                    className="bg-sky-600 hover:bg-sky-700 text-white ml-auto"
                    disabled={isSubmitting || createCustomerMutation.isPending}
                    onClick={handleConfirmInitial}
                  >
                    {isSubmitting ? 'Please wait...' : 'Save initial reservation'}
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      className="ml-auto"
                      disabled={isSubmitting || createCustomerMutation.isPending}
                      onClick={handleConfirm}
                    >
                      {isSubmitting ? 'Please wait...' : 'Confirm reservation'}
                    </Button>
                    <Button
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                      disabled={isSubmitting || createCustomerMutation.isPending}
                      onClick={handleConfirmWithCheckIn}
                    >
                      <LogIn className="h-4 w-4 mr-2" />
                      {isSubmitting ? 'Processing...' : 'Confirm reservation with check-in'}
                    </Button>
                  </>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}


