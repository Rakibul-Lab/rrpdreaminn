'use client'

import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Image from 'next/image'
import { format } from 'date-fns'
import { LogOut } from 'lucide-react'
import { api } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { StatusBadge } from '../shared/StatusBadge'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { formatBdt } from '@/lib/currency'
import { cn } from '@/lib/utils'
import {
  PAYMENT_METHOD_OPTIONS_WITH_PAYMENT,
  paymentRequiresLastFour,
  paymentRequiresReference,
  isValidPaymentAccountLastFour,
} from '@/lib/payment-method'
import { Switch } from '@/components/ui/switch'
import { useHotelTimes } from '@/hooks/use-hotel-times'
import type { BookingDiscountType } from '@/lib/booking-discount'

export interface CheckoutPreview {
  bookingId: string
  customerName: string
  roomNumber: string
  roomTypeName?: string
  checkIn?: string
  checkOut?: string
  bookedNights: number
  actualStayNights: number
  chargeableNights: number
  stayAdjustmentMode?: 'shrink' | 'extend' | null
  nightlyRate: number
  bookedRoomCharge: number
  extraChargesIfIncluded?: number
  roomCharges: number
  foodCharges: number
  extraCharges: number
  damageCharge?: number
  subtotal: number
  discount: number
  vatApplied?: boolean
  vatPercent: number
  vatAmount: number
  totalAmount: number
  totalPaid: number
  dueBeforeSettlement: number
  creditAmount?: number
  creditTransfers?: Array<{
    bookingId: string
    roomNumber: string
    roomTypeName: string
    customerName: string
    roomCharges: number
    foodCharges: number
    extraCharges: number
    transferTotal: number
  }>
  billTransferOut?: boolean
  billTransferTarget?: {
    bookingId: string
    roomNumber: string
    roomTypeName: string
    customerName: string
  }
  transferAmount?: number
  companyLedgerId?: string | null
  companyLedgerName?: string | null
  billToCompanyLedger?: boolean
}

type CheckedInBookingOption = {
  id: string
  room: { roomNumber: string; type?: { name: string } }
  customer: { name: string }
  billTransferredToBookingId?: string | null
}

interface CheckoutPageViewProps {
  bookingId: string
}

export function CheckoutPageView({ bookingId }: CheckoutPageViewProps) {
  const queryClient = useQueryClient()
  const { formatCheckIn, formatCheckOut } = useHotelTimes()
  const [checkOutPayment, setCheckOutPayment] = useState('0')
  const [checkOutPaymentMethod, setCheckOutPaymentMethod] = useState('CASH')
  const [checkOutPaymentReference, setCheckOutPaymentReference] = useState('')
  const [checkOutPaymentLastFour, setCheckOutPaymentLastFour] = useState('')
  const [checkOutPaymentNotes, setCheckOutPaymentNotes] = useState('')
  const [extraChargesEnabled, setExtraChargesEnabled] = useState(false)
  const [damageChargesEnabled, setDamageChargesEnabled] = useState(false)
  const [damageChargeAmount, setDamageChargeAmount] = useState('')
  const [debouncedDamageAmount, setDebouncedDamageAmount] = useState(0)
  const [discountEnabled, setDiscountEnabled] = useState(false)
  const [discountType, setDiscountType] = useState<BookingDiscountType>('PERCENTAGE')
  const [discountValue, setDiscountValue] = useState('')
  const [debouncedDiscountValue, setDebouncedDiscountValue] = useState(0)
  const [roomCreditTransferEnabled, setRoomCreditTransferEnabled] = useState(false)
  const [billTransferTargetId, setBillTransferTargetId] = useState<string | null>(null)

  const parsedDamageAmount = Math.max(0, parseFloat(damageChargeAmount) || 0)
  const parsedDiscountValue = Math.max(0, parseFloat(discountValue) || 0)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedDamageAmount(damageChargesEnabled ? parsedDamageAmount : 0)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [damageChargeAmount, damageChargesEnabled, parsedDamageAmount])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedDiscountValue(discountEnabled ? parsedDiscountValue : 0)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [discountValue, discountEnabled, parsedDiscountValue])

  const { data: checkedInBookingsData } = useQuery({
    queryKey: ['checked-in-bookings-for-transfer'],
    queryFn: () =>
      api.get<{
        success: boolean
        data: CheckedInBookingOption[]
      }>('/bookings?status=CHECKED_IN&limit=200'),
  })

  const transferRoomOptions =
    (checkedInBookingsData as { data?: CheckedInBookingOption[] } | undefined)?.data?.filter(
      (b) => b.id !== bookingId && !b.billTransferredToBookingId
    ) ?? []

  const isBillTransferOut = roomCreditTransferEnabled && !!billTransferTargetId

  const { data: checkoutPreviewData, isFetching: checkoutPreviewFetching } = useQuery({
      queryKey: [
        'checkout-preview',
        bookingId,
        extraChargesEnabled,
        damageChargesEnabled,
        debouncedDamageAmount,
        discountEnabled,
        discountType,
        debouncedDiscountValue,
        roomCreditTransferEnabled,
        billTransferTargetId,
      ],
      queryFn: () => {
        const params = new URLSearchParams()
        params.set('includeExtraCharges', extraChargesEnabled ? 'true' : 'false')
        params.set('includeDamageCharge', damageChargesEnabled ? 'true' : 'false')
        params.set('includeDiscount', discountEnabled ? 'true' : 'false')
        params.set('discountType', discountType)
        params.set('roomCreditTransferEnabled', roomCreditTransferEnabled ? 'true' : 'false')
        if (damageChargesEnabled) {
          params.set('damageChargeAmount', String(debouncedDamageAmount))
        }
        if (discountEnabled) {
          params.set('discountValue', String(debouncedDiscountValue))
        }
        if (roomCreditTransferEnabled && billTransferTargetId) {
          params.set('creditTransferBookingIds', billTransferTargetId)
        }
        const qs = params.toString()
        return api.get<{ success: boolean; data: CheckoutPreview; error?: string }>(
          `/bookings/check-out/${bookingId}${qs ? `?${qs}` : ''}`
        )
      },
      enabled: !!bookingId,
      retry: false,
      placeholderData: (previous) => previous,
    })

  const previewRes = checkoutPreviewData as
    | { success?: boolean; data?: CheckoutPreview; error?: string; message?: string }
    | undefined
  const checkoutPreview = previewRes?.success !== false ? previewRes?.data : undefined
  const previewApiError =
    previewRes?.success === false ? previewRes.error || previewRes.message : undefined
  const isCompanyLedgerCheckout = checkoutPreview?.billToCompanyLedger === true

  const checkOutDue =
    isBillTransferOut ? 0 : (checkoutPreview?.dueBeforeSettlement ?? 0)
  const checkOutCredit = checkoutPreview?.creditAmount ?? 0
  const checkOutPaymentAmount = parseFloat(checkOutPayment) || 0
  const checkOutRemaining = Math.max(checkOutDue - checkOutPaymentAmount, 0)
  const showPaymentReference =
    checkOutPaymentAmount > 0 && paymentRequiresReference(checkOutPaymentMethod)
  const showPaymentLastFour =
    checkOutPaymentAmount > 0 && paymentRequiresLastFour(checkOutPaymentMethod)

  const handlePaymentMethodChange = (method: string) => {
    setCheckOutPaymentMethod(method)
    if (!paymentRequiresReference(method)) {
      setCheckOutPaymentReference('')
    }
    if (!paymentRequiresLastFour(method)) {
      setCheckOutPaymentLastFour('')
    }
  }
  const companyLedgerDue = isCompanyLedgerCheckout
    ? Math.max(0, checkOutDue - checkOutPaymentAmount)
    : 0

  useEffect(() => {
    setCheckOutPayment((prev) => {
      const next = isCompanyLedgerCheckout ? '0' : String(checkOutDue || 0)
      return prev === next ? prev : next
    })
  }, [checkOutDue, isCompanyLedgerCheckout])

  const checkOutMutation = useMutation({
    mutationFn: () =>
      api.post(`/bookings/check-out/${bookingId}`, {
        finalPayment:
          isBillTransferOut ? 0 : isCompanyLedgerCheckout ? checkOutPaymentAmount : checkOutDue > 0 ? checkOutPaymentAmount : 0,
        paymentMethod: checkOutPaymentMethod,
        paymentReference:
          checkOutPaymentAmount > 0 && showPaymentReference
            ? checkOutPaymentReference.trim() || undefined
            : undefined,
        paymentAccountLastFour:
          checkOutPaymentAmount > 0 && showPaymentLastFour
            ? checkOutPaymentLastFour.trim() || undefined
            : undefined,
        paymentNotes: checkOutPaymentNotes || undefined,
        includeExtraCharges: extraChargesEnabled,
        includeDamageCharge: damageChargesEnabled,
        damageChargeAmount: damageChargesEnabled ? parsedDamageAmount : 0,
        includeDiscount: discountEnabled,
        discountType,
        discountValue: discountEnabled ? parsedDiscountValue : 0,
        roomCreditTransferEnabled,
        creditTransferBookingIds:
          roomCreditTransferEnabled && billTransferTargetId ? [billTransferTargetId] : [],
      }),
    onSuccess: (res: {
      success?: boolean
      data?: {
        invoiceId?: string
        creditAmount?: number
        billTransferOut?: boolean
        targetRoomNumber?: string
      }
      message?: string
      error?: string
    }) => {
      if (!res?.success) {
        toast.error(res?.error || res?.message || 'Failed to check out')
        return
      }
      queryClient.invalidateQueries({ queryKey: ['bookings'] })
      queryClient.invalidateQueries({ queryKey: ['checked-in-bookings-for-transfer'] })
      queryClient.invalidateQueries({ queryKey: ['company-ledger'] })
      queryClient.invalidateQueries({ queryKey: ['company-ledger-detail'] })
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['rooms'] })

      if (res?.data?.billTransferOut) {
        toast.success(
          res.message ||
            `Checked out. Bill transferred to Room ${res.data.targetRoomNumber ?? ''}.`
        )
        if (typeof window !== 'undefined' && window.opener) {
          window.close()
        } else {
          window.location.replace('/')
        }
        return
      }

      const invoiceId = res?.data?.invoiceId
      const credit = res?.data?.creditAmount
      if (invoiceId) {
        const msg = credit && credit > 0
          ? `Check-out complete. Overpaid by ${formatBdt(credit)} — refund may apply.`
          : 'Check-out complete. Print or download the invoice below.'
        window.location.replace(
          `/invoice/${invoiceId}?from=checkout&msg=${encodeURIComponent(msg)}`
        )
        return
      }
      toast.success(res.message || 'Guest checked out successfully')
    },
    onError: (err: Error) => {
      toast.error(err?.message || 'Failed to check out')
    },
  })

  if (previewApiError && !checkoutPreviewFetching) {
    const message =
      typeof previewApiError === 'string'
        ? previewApiError
        : (previewApiError as Error)?.message || 'Unable to load check-out'
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
        {message}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-8">
      <Card className="border-amber-200/60 bg-muted/60">
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 overflow-hidden rounded-lg border bg-card">
                <Image
                  src="/brand-logo.png"
                  alt="RRP Dream Inn logo"
                  width={40}
                  height={40}
                  className="h-full w-full object-cover"
                />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">RRP Dream Inn</p>
                <p className="text-xs text-muted-foreground">Final Check-out & Invoice Settlement</p>
              </div>
            </div>
            <StatusBadge status="CHECKED_IN" />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Stay & reservation</CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-3 text-sm">
          {checkoutPreviewFetching && !checkoutPreview ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/50 p-3">
                <p className="text-muted-foreground">Guest</p>
                <p className="font-semibold text-right">{checkoutPreview?.customerName ?? '—'}</p>
                <p className="text-muted-foreground">Room</p>
                <p className="font-medium text-right">
                  {checkoutPreview?.roomNumber ?? '—'}
                  {checkoutPreview?.roomTypeName ? ` · ${checkoutPreview.roomTypeName}` : ''}
                </p>
                <p className="text-muted-foreground">Reserved nights</p>
                <p className="font-semibold text-right">{checkoutPreview?.bookedNights ?? '—'} night(s)</p>
                <p className="text-muted-foreground">Reservation period</p>
                <p className="font-medium text-right text-xs">
                  {checkoutPreview?.checkIn
                    ? `${formatCheckIn(checkoutPreview.checkIn)} → ${formatCheckOut(checkoutPreview.checkOut!)}`
                    : '—'}
                </p>
                <p className="text-muted-foreground">Actual stay (today)</p>
                <p className="font-semibold text-right text-amber-700">
                  {checkoutPreview?.actualStayNights ?? '—'} night(s)
                </p>
                <p className="text-muted-foreground">Rate per night</p>
                <p className="font-medium text-right">{formatBdt(checkoutPreview?.nightlyRate ?? 0)}</p>
                <p className="text-muted-foreground">Current room charge</p>
                <p className="font-medium text-right">{formatBdt(checkoutPreview?.roomCharges ?? 0)}</p>
                {checkoutPreview?.chargeableNights != null &&
                  checkoutPreview.chargeableNights !== checkoutPreview.bookedNights && (
                    <>
                      <p className="text-muted-foreground col-span-2 text-xs text-amber-700">
                        Stay adjusted: {checkoutPreview.chargeableNights} of {checkoutPreview.bookedNights}{' '}
                        reserved night(s) charged
                      </p>
                    </>
                  )}
              </div>

              <p className="text-xs text-muted-foreground px-1">
                To change nights or add an early checkout fee, use <strong>Adjust stay</strong> on the
                bookings list before checking out.
              </p>
            </>
          )}

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">Include extra charges</p>
              <p className="text-xs text-muted-foreground">Late checkout and other room extras</p>
            </div>
            <Switch checked={extraChargesEnabled} onCheckedChange={setExtraChargesEnabled} />
          </div>

          <div className="rounded-lg border border-border p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">Damage charges</p>
                <p className="text-xs text-muted-foreground">Added to invoice when enabled</p>
              </div>
              <Switch
                checked={damageChargesEnabled}
                onCheckedChange={(on) => {
                  setDamageChargesEnabled(on)
                  if (!on) {
                    setDamageChargeAmount('')
                    setDebouncedDamageAmount(0)
                  }
                }}
              />
            </div>
            {damageChargesEnabled && (
              <div className="space-y-2">
                <Label htmlFor="damage-charge-amount">Damage amount (BDT)</Label>
                <Input
                  id="damage-charge-amount"
                  type="text"
                  inputMode="decimal"
                  value={damageChargeAmount}
                  onChange={(e) => setDamageChargeAmount(e.target.value)}
                  placeholder="Enter damage charge"
                />
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">Discount</p>
                <p className="text-xs text-muted-foreground">
                  Applied to room and extras before VAT — included on invoice
                </p>
              </div>
              <Switch
                checked={discountEnabled}
                onCheckedChange={(on) => {
                  setDiscountEnabled(on)
                  if (!on) {
                    setDiscountValue('')
                    setDebouncedDiscountValue(0)
                  }
                }}
              />
            </div>
            {discountEnabled && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Discount type</Label>
                  <Select
                    value={discountType}
                    onValueChange={(value) => setDiscountType(value as BookingDiscountType)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PERCENTAGE">Percentage (%)</SelectItem>
                      <SelectItem value="FIXED">Fixed amount (BDT)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{discountType === 'PERCENTAGE' ? 'Discount (%)' : 'Discount (BDT)'}</Label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    placeholder={discountType === 'PERCENTAGE' ? 'e.g. 10' : 'e.g. 500'}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-indigo-950">Transfer bill to another room</p>
                <p className="text-xs text-muted-foreground">
                  Check out this room without payment — charges move to a checked-in room (e.g. Room
                  801 → Room 803)
                </p>
              </div>
              <Switch
                checked={roomCreditTransferEnabled}
                onCheckedChange={(on) => {
                  setRoomCreditTransferEnabled(on)
                  if (!on) setBillTransferTargetId(null)
                }}
              />
            </div>
            {roomCreditTransferEnabled && (
              <div className="space-y-2">
                {transferRoomOptions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No other checked-in rooms available to receive this bill.
                  </p>
                ) : (
                  <div className="max-h-40 space-y-2 overflow-y-auto rounded-md border border-indigo-100 bg-white p-2">
                    {transferRoomOptions.map((option) => (
                      <label
                        key={option.id}
                        className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-indigo-50"
                      >
                        <input
                          type="radio"
                          name="billTransferTarget"
                          className="mt-1"
                          checked={billTransferTargetId === option.id}
                          onChange={() => setBillTransferTargetId(option.id)}
                        />
                        <span className="text-sm">
                          <strong>Room {option.room.roomNumber}</strong>
                          {option.room.type?.name ? ` · ${option.room.type.name}` : ''}
                          <span className="block text-xs text-muted-foreground">
                            {option.customer.name}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                <p className="text-xs text-indigo-900">
                  This room checks out with no payment. Its charges will appear on the selected
                  room&apos;s invoice when that room checks out.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {isCompanyLedgerCheckout && checkoutPreview?.companyLedgerName && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 px-4 py-3 text-sm text-indigo-950">
          <strong>Company ledger checkout</strong> — unpaid balance will be billed to{' '}
          <strong>{checkoutPreview.companyLedgerName}</strong>. Payment now is optional.
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Invoice details</CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-2 text-sm">
          {checkoutPreviewFetching && !checkoutPreview ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <p className="text-muted-foreground">Room charges</p>
              <p className="font-medium text-right">{formatBdt(checkoutPreview?.roomCharges ?? 0)}</p>
              <p className="text-muted-foreground">Restaurant</p>
              <p className="font-medium text-right">{formatBdt(checkoutPreview?.foodCharges ?? 0)}</p>
              <p className="text-muted-foreground">Extra charges</p>
              <p
                className={cn(
                  'font-medium text-right',
                  !extraChargesEnabled && 'text-muted-foreground line-through'
                )}
              >
                {formatBdt(
                  Math.max(0, (checkoutPreview?.extraCharges ?? 0) - (checkoutPreview?.damageCharge ?? 0))
                )}
              </p>
              {(checkoutPreview?.damageCharge ?? 0) > 0 && (
                <>
                  <p className="text-muted-foreground">Damage charges</p>
                  <p className="font-medium text-right text-amber-800">
                    {formatBdt(checkoutPreview?.damageCharge ?? 0)}
                  </p>
                </>
              )}
              {(checkoutPreview?.creditTransfers ?? []).map((transfer) => (
                <div key={transfer.bookingId} className="contents">
                  <p className="text-muted-foreground col-span-2 text-xs text-indigo-800 pt-1">
                    Transferred from Room {transfer.roomNumber} ({transfer.customerName})
                  </p>
                  <p className="text-muted-foreground pl-2">Room</p>
                  <p className="font-medium text-right">{formatBdt(transfer.roomCharges)}</p>
                  {transfer.foodCharges > 0 && (
                    <>
                      <p className="text-muted-foreground pl-2">Restaurant</p>
                      <p className="font-medium text-right">{formatBdt(transfer.foodCharges)}</p>
                    </>
                  )}
                  {transfer.extraCharges > 0 && (
                    <>
                      <p className="text-muted-foreground pl-2">Extras</p>
                      <p className="font-medium text-right">{formatBdt(transfer.extraCharges)}</p>
                    </>
                  )}
                </div>
              ))}
              {(checkoutPreview?.discount ?? 0) > 0 && (
                <>
                  <p className="text-muted-foreground">Discount</p>
                  <p className="font-medium text-right text-emerald-700">
                    -{formatBdt(checkoutPreview?.discount ?? 0)}
                  </p>
                </>
              )}
              <p className="text-muted-foreground">
                VAT (
                {checkoutPreview?.vatApplied === false ? 'none' : `${checkoutPreview?.vatPercent ?? 0}%`} ·
                reservation)
              </p>
              <p className="font-medium text-right">{formatBdt(checkoutPreview?.vatAmount ?? 0)}</p>
              {checkoutPreview?.billTransferOut && checkoutPreview.billTransferTarget && (
                <>
                  <p className="text-muted-foreground col-span-2 text-xs text-indigo-800 pt-1 border-t">
                    Bill transfers to Room {checkoutPreview.billTransferTarget.roomNumber} (
                    {checkoutPreview.billTransferTarget.customerName})
                  </p>
                  <p className="text-muted-foreground">Amount transferring</p>
                  <p className="font-medium text-right text-indigo-800">
                    {formatBdt(checkoutPreview.transferAmount ?? 0)}
                  </p>
                </>
              )}
              <p className="text-muted-foreground font-semibold">Invoice total</p>
              <p className="font-semibold text-right">{formatBdt(checkoutPreview?.totalAmount ?? 0)}</p>
              <p className="text-muted-foreground">Paid</p>
              <p className="font-medium text-right text-emerald-700">
                {formatBdt(checkoutPreview?.totalPaid ?? 0)}
              </p>
              <p className="text-muted-foreground">Current due</p>
              <p
                className={cn(
                  'font-semibold text-right',
                  isBillTransferOut || isCompanyLedgerCheckout ? 'text-indigo-700' : 'text-red-600'
                )}
              >
                {isBillTransferOut ? formatBdt(0) : formatBdt(checkOutDue)}
              </p>
              {isCompanyLedgerCheckout && checkOutDue > 0 && (
                <>
                  <p className="text-muted-foreground">Due on company ledger</p>
                  <p className="font-semibold text-right text-indigo-800">
                    {formatBdt(companyLedgerDue)}
                  </p>
                </>
              )}
              {checkOutCredit > 0 && (
                <>
                  <p className="text-muted-foreground">Overpaid</p>
                  <p className="font-semibold text-right text-emerald-700">{formatBdt(checkOutCredit)}</p>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {!isBillTransferOut && (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {isCompanyLedgerCheckout ? 'Payment now (optional)' : 'Final payment'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Amount (BDT)</Label>
              <Input
                type="number"
                min="0"
                value={checkOutPayment}
                onChange={(e) => setCheckOutPayment(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Remaining:{' '}
                <span
                  className={
                    checkOutRemaining > 0 ? 'text-red-600 font-semibold' : 'text-emerald-600 font-semibold'
                  }
                >
                  {formatBdt(checkOutRemaining)}
                </span>
              </p>
            </div>
            <div className="space-y-2">
              <Label>Payment method</Label>
              <Select value={checkOutPaymentMethod} onValueChange={handlePaymentMethodChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHOD_OPTIONS_WITH_PAYMENT.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {(showPaymentReference || showPaymentLastFour) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {showPaymentReference && (
                <div className="space-y-2">
                  <Label>
                    Reference <span className="text-red-600">*</span>
                  </Label>
                  <Input
                    placeholder="e.g. transaction ID or receipt number"
                    value={checkOutPaymentReference}
                    onChange={(e) => setCheckOutPaymentReference(e.target.value)}
                  />
                </div>
              )}
              {showPaymentLastFour && (
                <div className="space-y-2">
                  <Label>
                    Last 4 digits <span className="text-red-600">*</span>
                  </Label>
                  <Input
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="e.g. 4567"
                    value={checkOutPaymentLastFour}
                    onChange={(e) =>
                      setCheckOutPaymentLastFour(
                        e.target.value.replace(/\D/g, '').slice(0, 4)
                      )
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Required for{' '}
                    {checkOutPaymentMethod === 'CARD'
                      ? 'card'
                      : checkOutPaymentMethod.toLowerCase().replace(/_/g, ' ')}
                  </p>
                </div>
              )}
            </div>
          )}
          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            <Input value={checkOutPaymentNotes} onChange={(e) => setCheckOutPaymentNotes(e.target.value)} />
          </div>
        </CardContent>
      </Card>
      )}

      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        <Button variant="outline" onClick={() => window.close()}>
          Cancel
        </Button>
        <Button
          className="bg-slate-800 hover:bg-slate-900 text-white"
          disabled={
            checkOutMutation.isPending ||
            !bookingId ||
            checkoutPreviewFetching ||
            (damageChargesEnabled && parsedDamageAmount <= 0) ||
            (discountEnabled && parsedDiscountValue <= 0) ||
            (roomCreditTransferEnabled && !billTransferTargetId) ||
            (!isBillTransferOut &&
              !isCompanyLedgerCheckout &&
              checkOutDue > 0 &&
              (checkOutPaymentAmount <= 0 || checkOutPaymentAmount < checkOutDue))
          }
          onClick={() => {
            if (damageChargesEnabled && parsedDamageAmount <= 0) {
              toast.error('Enter a damage charge amount greater than zero, or turn damage charges off.')
              return
            }
            if (discountEnabled && parsedDiscountValue <= 0) {
              toast.error('Enter a discount greater than zero, or turn discount off.')
              return
            }
            if (roomCreditTransferEnabled && !billTransferTargetId) {
              toast.error('Select a checked-in room to receive this bill, or turn bill transfer off.')
              return
            }
            if (
              !isBillTransferOut &&
              !isCompanyLedgerCheckout &&
              checkOutDue > 0 &&
              checkOutPaymentAmount < checkOutDue
            ) {
              toast.error('Please clear full due amount before checkout.')
              return
            }
            if (isCompanyLedgerCheckout && checkOutPaymentAmount > checkOutDue) {
              toast.error('Payment cannot exceed the current due amount.')
              return
            }
            if (checkOutPaymentAmount > 0 && showPaymentReference && !checkOutPaymentReference.trim()) {
              toast.error('Payment reference is required for this payment method.')
              return
            }
            if (
              checkOutPaymentAmount > 0 &&
              showPaymentLastFour &&
              !isValidPaymentAccountLastFour(checkOutPaymentLastFour)
            ) {
              toast.error('Enter exactly 4 digits for card / bKash / Nagad / Upay.')
              return
            }
            checkOutMutation.mutate()
          }}
        >
          <LogOut className="h-4 w-4 mr-2" />
          {checkOutMutation.isPending
            ? 'Processing…'
            : isBillTransferOut
              ? 'Transfer bill & check out'
              : isCompanyLedgerCheckout
                ? 'Bill to company & check out'
                : 'Settle & check out'}
        </Button>
      </div>
    </div>
  )
}
