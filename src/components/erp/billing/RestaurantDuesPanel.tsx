'use client'

import { Fragment, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { api } from '@/lib/api-client'
import { useAuthStore, canAccessAdmin } from '@/lib/auth-store'
import { useToast } from '@/hooks/use-toast'
import { formatBdt } from '@/lib/currency'
import { formatPaymentMethod, PAYMENT_METHOD_OPTIONS_WITH_PAYMENT } from '@/lib/payment-method'
import { formatGuestFolioStatus, formatOrderTypeLabel } from '@/lib/restaurant-order-dues'
import { formatRestaurantSettlementSource } from '@/lib/restaurant-order-settle'
import {
  BOOKING_DATE_PRESET_OPTIONS,
  resolveBookingDateRange,
  type BookingDatePreset,
} from '@/lib/booking-date-filter'
import { getPaginationPages } from '@/lib/pagination-pages'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  CalendarRange,
  ChevronDown,
  ChevronUp,
  Loader2,
  Search,
  UtensilsCrossed,
  Wallet,
} from 'lucide-react'

type DueStatusFilter = 'open' | 'settled' | 'all'
type DateFieldFilter = 'order' | 'settled'
type BillCategoryFilter = 'hotel' | 'counter' | 'all'

interface OrderDueItem {
  id: string
  quantity: number
  price: number
  lineTotal: number
  notes: string | null
  menuItem: { id: string; name: string; isVeg: boolean }
}

interface OrderDuePayment {
  id: string
  amount: number
  method: string
  paymentType: string
  reference: string | null
  notes: string | null
  settlementSource: string | null
  createdAt: string
  receiver: { id: string; name: string; role?: string }
}

interface RestaurantDueOrder {
  id: string
  orderNumber: string
  orderType: string
  status: string
  customerName: string | null
  customerPhone: string | null
  subtotal: number
  discount: number
  vatAmount: number
  vatPercent: number
  totalAmount: number
  paidAmount: number
  dueAmount: number
  isSettled: boolean
  notes: string | null
  createdAt: string
  settledAt: string | null
  bookingId: string | null
  billedToRoom: boolean
  hotelFolioOrder: boolean
  bookingStatus: string | null
  guestPaidAtHotel: boolean
  guestCheckoutAt: string | null
  room: { id: string; roomNumber: string; floor?: number } | null
  table: { id: string; tableNumber: string } | null
  creator: { id: string; name: string } | null
  items: OrderDueItem[]
  payments: OrderDuePayment[]
}

export function RestaurantDuesPanel() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const canBulkSettle = canAccessAdmin(user?.role) || user?.role === 'HOTEL_STAFF'
  const isRestaurantStaff = user?.role === 'RESTAURANT_STAFF'

  const [search, setSearch] = useState('')
  const [orderTypeFilter, setOrderTypeFilter] = useState('all')
  const [dueStatus, setDueStatus] = useState<DueStatusFilter>('open')
  const [billCategory, setBillCategory] = useState<BillCategoryFilter>('hotel')
  const [datePreset, setDatePreset] = useState<BookingDatePreset>('all')
  const [customDateFrom, setCustomDateFrom] = useState('')
  const [customDateTo, setCustomDateTo] = useState('')
  const [dateField, setDateField] = useState<DateFieldFilter>('order')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [settleOrder, setSettleOrder] = useState<RestaurantDueOrder | null>(null)
  const [bulkSettleOpen, setBulkSettleOpen] = useState(false)
  const [settleAmount, setSettleAmount] = useState('')
  const [settleMethod, setSettleMethod] = useState('CASH')
  const [settleReference, setSettleReference] = useState('')
  const [settleNotes, setSettleNotes] = useState('')
  const [bulkReference, setBulkReference] = useState('')
  const [bulkMethod, setBulkMethod] = useState('CASH')
  const [bulkNotes, setBulkNotes] = useState('')

  const dateRange = useMemo(
    () => resolveBookingDateRange(datePreset, customDateFrom, customDateTo),
    [datePreset, customDateFrom, customDateTo]
  )

  const { data, isLoading } = useQuery({
    queryKey: [
      'restaurant-dues',
      search,
      orderTypeFilter,
      dueStatus,
      billCategory,
      datePreset,
      customDateFrom,
      customDateTo,
      dateField,
      page,
      pageSize,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
        dueStatus,
        billCategory,
        dateField,
      })
      if (search.trim()) params.set('search', search.trim())
      if (orderTypeFilter !== 'all') params.set('orderType', orderTypeFilter)
      if (dateRange.dateFrom) params.set('dateFrom', dateRange.dateFrom)
      if (dateRange.dateTo) params.set('dateTo', dateRange.dateTo)
      return api.get<{
        success: boolean
        data: RestaurantDueOrder[]
        meta?: {
          total: number
          totalPages: number
          totalDueSum?: number
          openCount?: number
          settledCount?: number
        }
      }>(`/restaurant-orders/dues?${params.toString()}`)
    },
  })

  const orders = data?.data || []
  const total = data?.meta?.total || 0
  const totalPages = Math.max(data?.meta?.totalPages || 1, 1)
  const totalDueSum = data?.meta?.totalDueSum ?? 0
  const openCount = data?.meta?.openCount ?? 0
  const settledCount = data?.meta?.settledCount ?? 0
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeEnd = Math.min(page * pageSize, total)
  const pageNumbers = getPaginationPages(page, totalPages)

  const settleMutation = useMutation({
    mutationFn: (payload: {
      orderId: string
      amount?: number
      settleFull?: boolean
      method: string
      reference?: string
      notes?: string
    }) =>
      api.post(`/restaurant-orders/${payload.orderId}/settle`, {
        amount: payload.amount,
        settleFull: payload.settleFull,
        method: payload.method,
        reference: payload.reference || null,
        notes: payload.notes || null,
      }),
    onSuccess: (res: { message?: string }) => {
      queryClient.invalidateQueries({ queryKey: ['restaurant-dues'] })
      queryClient.invalidateQueries({ queryKey: ['payments'] })
      queryClient.invalidateQueries({ queryKey: ['payments-summary'] })
      toast({ title: 'Payment recorded', description: res?.message || 'Order settlement saved' })
      closeSettleDialog()
    },
    onError: (err: Error) => {
      toast({
        title: 'Settlement failed',
        description: err?.message || 'Could not record payment',
        variant: 'destructive',
      })
    },
  })

  const openSettleDialog = (order: RestaurantDueOrder) => {
    setSettleOrder(order)
    setSettleAmount(String(order.dueAmount))
    setSettleMethod('CASH')
    setSettleReference('')
    setSettleNotes('')
  }

  const closeSettleDialog = () => {
    setSettleOrder(null)
    setSettleAmount('')
    setSettleReference('')
    setSettleNotes('')
  }

  const bulkSettleMutation = useMutation({
    mutationFn: () =>
      api.post('/restaurant-orders/dues/settle-all', {
        method: bulkMethod,
        reference: bulkReference.trim(),
        notes: bulkNotes.trim() || null,
        orderType: orderTypeFilter,
        search: search.trim() || undefined,
        dateFrom: dateRange.dateFrom,
        dateTo: dateRange.dateTo,
        dateField,
      }),
    onSuccess: (res: { message?: string; data?: { settledCount?: number; totalSettled?: number } }) => {
      queryClient.invalidateQueries({ queryKey: ['restaurant-dues'] })
      queryClient.invalidateQueries({ queryKey: ['payments'] })
      queryClient.invalidateQueries({ queryKey: ['payments-summary'] })
      toast({
        title: 'All dues settled',
        description: res?.message || `Settled ${res?.data?.settledCount ?? 0} order(s)`,
      })
      setBulkSettleOpen(false)
      setBulkReference('')
      setBulkNotes('')
    },
    onError: (err: Error) => {
      toast({
        title: 'Bulk settlement failed',
        description: err?.message || 'Could not settle all dues',
        variant: 'destructive',
      })
    },
  })

  const submitSettle = (settleFull: boolean) => {
    if (!settleOrder) return
    if (!settleReference.trim()) {
      toast({
        title: 'Receipt required',
        description: 'Transaction / receipt number is required',
        variant: 'destructive',
      })
      return
    }
    const amount = parseFloat(settleAmount)
    if (!settleFull && (!Number.isFinite(amount) || amount <= 0)) {
      toast({ title: 'Invalid amount', description: 'Enter a valid payment amount', variant: 'destructive' })
      return
    }
    settleMutation.mutate({
      orderId: settleOrder.id,
      amount: settleFull ? undefined : amount,
      settleFull,
      method: settleMethod,
      reference: settleReference.trim(),
      notes: settleNotes.trim() || undefined,
    })
  }

  const submitBulkSettle = () => {
    if (!bulkReference.trim()) {
      toast({
        title: 'Receipt required',
        description: 'Transaction / receipt number is required',
        variant: 'destructive',
      })
      return
    }
    bulkSettleMutation.mutate()
  }

  const locationLabel = (order: RestaurantDueOrder) => {
    if (order.room) return `Room ${order.room.roomNumber}`
    if (order.table) return `Table ${order.table.tableNumber}`
    return '—'
  }

  const canSettleOrder = (order: RestaurantDueOrder) => {
    if (order.dueAmount <= 0.009) return false
    if (order.hotelFolioOrder && isRestaurantStaff) return false
    if (order.hotelFolioOrder && !canBulkSettle) return false
    return true
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-950">
        <p className="font-medium">How hotel ↔ restaurant billing works</p>
        <ol className="mt-2 list-decimal list-inside space-y-1 text-amber-900/90">
          <li>Room guest (e.g. Room 801) orders food → delivered to the room.</li>
          <li>Food charge is on the <strong>guest hotel bill</strong> (room + restaurant together at checkout).</li>
          <li>After guest pays the hotel, only the <strong>restaurant food amount</strong> stays here as due — hotel still owes the restaurant.</li>
          <li>Hotel staff uses <strong>Settle</strong> with a receipt number; restaurant then sees it as <strong>Hotel due settlement</strong> with full details.</li>
        </ol>
      </div>

      {canBulkSettle && dueStatus !== 'settled' && openCount > 0 && billCategory !== 'counter' && (
        <div className="flex justify-end">
          <Button
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={() => setBulkSettleOpen(true)}
          >
            Settle all open dues ({openCount})
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-lg bg-red-50">
              <Wallet className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Hotel owes restaurant</p>
              <p className="text-xl font-bold text-red-700">{formatBdt(totalDueSum)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-lg bg-amber-50">
              <UtensilsCrossed className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Open orders</p>
              <p className="text-xl font-bold text-foreground">{openCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-lg bg-emerald-50">
              <Wallet className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Settled (in view)</p>
              <p className="text-xl font-bold text-emerald-700">{settledCount}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search order, guest, room, table..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
                className="pl-9"
              />
            </div>
            <Select
              value={orderTypeFilter}
              onValueChange={(v) => {
                setOrderTypeFilter(v)
                setPage(1)
              }}
            >
              <SelectTrigger className="w-full sm:w-44">
                <SelectValue placeholder="Order type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="DINE_IN">Dine-in</SelectItem>
                <SelectItem value="TAKEAWAY">Takeaway</SelectItem>
                <SelectItem value="ROOM_SERVICE">Room service</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={billCategory}
              onValueChange={(v) => {
                setBillCategory(v as BillCategoryFilter)
                setPage(1)
              }}
            >
              <SelectTrigger className="w-full sm:w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hotel">Room guest bills (hotel due)</SelectItem>
                <SelectItem value="counter">Counter / dine-in / takeaway</SelectItem>
                <SelectItem value="all">All restaurant bills</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={dueStatus}
              onValueChange={(v) => {
                setDueStatus(v as DueStatusFilter)
                setPage(1)
              }}
            >
              <SelectTrigger className="w-full sm:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open dues only</SelectItem>
                <SelectItem value="settled">All settled</SelectItem>
                <SelectItem value="all">Open + settled</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={datePreset}
              onValueChange={(v) => {
                setDatePreset(v as BookingDatePreset)
                setPage(1)
              }}
            >
              <SelectTrigger className="w-full sm:w-44">
                <CalendarRange className="h-4 w-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="Date" />
              </SelectTrigger>
              <SelectContent>
                {BOOKING_DATE_PRESET_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={dateField}
              onValueChange={(v) => {
                setDateField(v as DateFieldFilter)
                setPage(1)
              }}
            >
              <SelectTrigger className="w-full sm:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="order">Filter by order date</SelectItem>
                <SelectItem value="settled">Filter by settlement date</SelectItem>
              </SelectContent>
            </Select>
            {datePreset === 'custom' && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">From</Label>
                  <Input
                    type="date"
                    value={customDateFrom}
                    onChange={(e) => {
                      setCustomDateFrom(e.target.value)
                      setPage(1)
                    }}
                    className="w-40"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">To</Label>
                  <Input
                    type="date"
                    value={customDateTo}
                    onChange={(e) => {
                      setCustomDateTo(e.target.value)
                      setPage(1)
                    }}
                    className="w-40"
                  />
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Order</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Guest</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Guest / hotel</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Due</TableHead>
                  <TableHead>Settled on</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 11 }).map((__, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-16" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : orders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center py-10 text-muted-foreground">
                      No restaurant dues found for the selected filters
                    </TableCell>
                  </TableRow>
                ) : (
                  orders.map((order) => {
                    const expanded = expandedId === order.id
                    return (
                      <Fragment key={order.id}>
                        <TableRow className="hover:bg-muted/40">
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => setExpandedId(expanded ? null : order.id)}
                            >
                              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </Button>
                          </TableCell>
                          <TableCell className="font-mono text-xs font-medium">{order.orderNumber}</TableCell>
                          <TableCell className="text-sm whitespace-nowrap">
                            {format(new Date(order.createdAt), 'dd MMM yyyy HH:mm')}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{formatOrderTypeLabel(order.orderType)}</Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            <div>{order.customerName || 'Walk-in'}</div>
                            {order.customerPhone && (
                              <div className="text-xs text-muted-foreground">{order.customerPhone}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">{locationLabel(order)}</TableCell>
                          <TableCell className="text-sm">
                            {order.hotelFolioOrder ? (
                              <Badge
                                variant="outline"
                                className={
                                  order.guestPaidAtHotel
                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                    : 'bg-sky-50 text-sky-800 border-sky-200'
                                }
                              >
                                {formatGuestFolioStatus(order.bookingStatus)}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">Counter bill</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-medium">{formatBdt(order.totalAmount)}</TableCell>
                          <TableCell className="text-right text-emerald-700">{formatBdt(order.paidAmount)}</TableCell>
                          <TableCell className="text-right font-semibold text-red-600">
                            {formatBdt(order.dueAmount)}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                            {order.settledAt
                              ? format(new Date(order.settledAt), 'dd MMM yyyy HH:mm')
                              : '—'}
                          </TableCell>
                          <TableCell className="text-right">
                            {canSettleOrder(order) ? (
                              <Button
                                size="sm"
                                className="bg-emerald-600 hover:bg-emerald-700 text-white h-8"
                                onClick={() => openSettleDialog(order)}
                              >
                                Settle
                              </Button>
                            ) : order.dueAmount > 0.009 && order.hotelFolioOrder ? (
                              <span className="text-xs text-muted-foreground">Hotel will settle</span>
                            ) : (
                              <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200" variant="outline">
                                Settled
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                        {expanded && (
                          <TableRow key={`${order.id}-details`} className="bg-muted/20">
                            <TableCell colSpan={12} className="p-4">
                              <div className="grid gap-4 lg:grid-cols-2">
                                <div className="space-y-3">
                                  <h4 className="font-semibold text-sm">Order items</h4>
                                  <div className="rounded-md border bg-background overflow-hidden">
                                    <table className="w-full text-sm">
                                      <thead className="bg-muted/50">
                                        <tr>
                                          <th className="text-left p-2 font-medium">Item</th>
                                          <th className="text-center p-2 font-medium">Qty</th>
                                          <th className="text-right p-2 font-medium">Rate</th>
                                          <th className="text-right p-2 font-medium">Total</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {order.items.map((item) => (
                                          <tr key={item.id} className="border-t">
                                            <td className="p-2">{item.menuItem.name}</td>
                                            <td className="p-2 text-center">{item.quantity}</td>
                                            <td className="p-2 text-right">{formatBdt(item.price)}</td>
                                            <td className="p-2 text-right">{formatBdt(item.lineTotal)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                  <div className="text-sm space-y-1">
                                    <div className="flex justify-between">
                                      <span className="text-muted-foreground">Subtotal</span>
                                      <span>{formatBdt(order.subtotal)}</span>
                                    </div>
                                    {order.discount > 0 && (
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">Discount</span>
                                        <span>-{formatBdt(order.discount)}</span>
                                      </div>
                                    )}
                                    <div className="flex justify-between">
                                      <span className="text-muted-foreground">VAT ({order.vatPercent}%)</span>
                                      <span>{formatBdt(order.vatAmount)}</span>
                                    </div>
                                    <div className="flex justify-between font-semibold border-t pt-1">
                                      <span>Grand total</span>
                                      <span>{formatBdt(order.totalAmount)}</span>
                                    </div>
                                  </div>
                                </div>
                                <div className="space-y-3">
                                  <h4 className="font-semibold text-sm">Order & payment details</h4>
                                  <div className="text-sm space-y-1 rounded-md border bg-background p-3">
                                    <p><span className="text-muted-foreground">Status:</span> {order.status}</p>
                                    <p><span className="text-muted-foreground">Created by:</span> {order.creator?.name || '—'}</p>
                                    {order.hotelFolioOrder && (
                                      <p className={order.guestPaidAtHotel ? 'text-emerald-700' : 'text-sky-700'}>
                                        {formatGuestFolioStatus(order.bookingStatus)}
                                        {order.guestPaidAtHotel
                                          ? ' — restaurant amount is due from hotel to restaurant.'
                                          : ' — will move to hotel→restaurant due after guest checkout.'}
                                      </p>
                                    )}
                                    {order.notes && (
                                      <p><span className="text-muted-foreground">Notes:</span> {order.notes}</p>
                                    )}
                                  </div>
                                  <h4 className="font-semibold text-sm">Payment history</h4>
                                  {order.payments.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">No payments recorded yet</p>
                                  ) : (
                                    <div className="rounded-md border bg-background overflow-hidden">
                                      <table className="w-full text-sm">
                                        <thead className="bg-muted/50">
                                          <tr>
                                            <th className="text-left p-2 font-medium">Date</th>
                                            <th className="text-left p-2 font-medium">Receipt #</th>
                                            <th className="text-left p-2 font-medium">Method</th>
                                            <th className="text-right p-2 font-medium">Amount</th>
                                            <th className="text-left p-2 font-medium">Source / staff</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {order.payments.map((p) => (
                                            <tr key={p.id} className="border-t">
                                              <td className="p-2 whitespace-nowrap">
                                                {format(new Date(p.createdAt), 'dd MMM yyyy HH:mm')}
                                              </td>
                                              <td className="p-2 font-mono text-xs">{p.reference || '—'}</td>
                                              <td className="p-2">{formatPaymentMethod(p.method)}</td>
                                              <td className="p-2 text-right">{formatBdt(p.amount)}</td>
                                              <td className="p-2">
                                                <div>{formatRestaurantSettlementSource(p.settlementSource, p.receiver)}</div>
                                                {p.notes && (
                                                  <div className="text-xs text-muted-foreground">{p.notes}</div>
                                                )}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-col gap-3 border-t bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {total === 0 ? 'No results' : `Showing ${rangeStart}–${rangeEnd} of ${total}`}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  setPageSize(Number(v))
                  setPage(1)
                }}
              >
                <SelectTrigger className="h-8 w-[110px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10 / page</SelectItem>
                  <SelectItem value="20">20 / page</SelectItem>
                  <SelectItem value="50">50 / page</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <div className="flex flex-wrap items-center gap-1">
                {pageNumbers.map((item, index) =>
                  item === 'ellipsis' ? (
                    <span
                      key={`ellipsis-${index}`}
                      className="flex h-8 min-w-8 items-center justify-center px-1 text-sm text-muted-foreground"
                    >
                      …
                    </span>
                  ) : (
                    <Button
                      key={item}
                      type="button"
                      variant="outline"
                      size="sm"
                      className={cn(
                        'h-8 min-w-8 px-2',
                        item === page &&
                          'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 hover:text-white'
                      )}
                      onClick={() => setPage(item)}
                    >
                      {item}
                    </Button>
                  )
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!settleOrder} onOpenChange={(open) => { if (!open) closeSettleDialog() }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Settle restaurant due</DialogTitle>
          </DialogHeader>
          {settleOrder && (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
                <p className="font-medium">{settleOrder.orderNumber}</p>
                <p className="text-muted-foreground">
                  {formatOrderTypeLabel(settleOrder.orderType)} · {locationLabel(settleOrder)}
                </p>
                <p className="text-red-700 font-semibold">
                  Due: {formatBdt(settleOrder.dueAmount)}
                </p>
              </div>
              <div>
                <Label>Amount (৳)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  max={settleOrder.dueAmount}
                  value={settleAmount}
                  onChange={(e) => setSettleAmount(e.target.value)}
                />
              </div>
              <div>
                <Label>Payment method</Label>
                <Select value={settleMethod} onValueChange={setSettleMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHOD_OPTIONS_WITH_PAYMENT.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Transaction / receipt number *</Label>
                <Input
                  value={settleReference}
                  onChange={(e) => setSettleReference(e.target.value)}
                  placeholder="Required — e.g. RCP-2026-001"
                  required
                />
              </div>
              <div>
                <Label>Notes (optional)</Label>
                <Textarea
                  value={settleNotes}
                  onChange={(e) => setSettleNotes(e.target.value)}
                  rows={2}
                />
              </div>
            </div>
          )}
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={closeSettleDialog}>Cancel</Button>
            <Button
              variant="outline"
              disabled={settleMutation.isPending}
              onClick={() => submitSettle(false)}
            >
              Record partial
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={settleMutation.isPending}
              onClick={() => submitSettle(true)}
            >
              {settleMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving…
                </>
              ) : (
                'Settle full due'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkSettleOpen} onOpenChange={setBulkSettleOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Settle all open restaurant dues</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              This will fully settle <strong className="text-foreground">{openCount}</strong> open room-guest
              food bill(s) matching your filters — amounts the hotel owes the restaurant after guests paid at checkout.
            </p>
            <p className="font-semibold text-red-700">Total due: {formatBdt(totalDueSum)}</p>
            <div>
              <Label>Transaction / receipt number *</Label>
              <Input
                value={bulkReference}
                onChange={(e) => setBulkReference(e.target.value)}
                placeholder="Required — e.g. HOTEL-RST-MAR-2026"
              />
            </div>
            <div>
              <Label>Payment method</Label>
              <Select value={bulkMethod} onValueChange={setBulkMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHOD_OPTIONS_WITH_PAYMENT.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea
                value={bulkNotes}
                onChange={(e) => setBulkNotes(e.target.value)}
                rows={2}
                placeholder="Monthly restaurant settlement..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkSettleOpen(false)}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={bulkSettleMutation.isPending}
              onClick={submitBulkSettle}
            >
              {bulkSettleMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Settling…
                </>
              ) : (
                'Settle all open dues'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
