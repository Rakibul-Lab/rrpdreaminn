'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { StatusBadge } from '../shared/StatusBadge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Plus, Search, LogIn, LogOut, XCircle, Eye, DollarSign, Receipt } from 'lucide-react';
import Image from 'next/image';

interface Booking {
  id: string;
  customerId: string;
  roomId: string;
  status: 'RESERVED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED';
  checkIn: string;
  checkOut: string;
  actualCheckIn?: string | null;
  actualCheckOut?: string | null;
  adults: number;
  children: number;
  totalRoomCharge: number;
  advancePayment: number;
  dueAmount: number;
  notes?: string | null;
  customer: { id: string; name: string; phone: string; email?: string };
  room: { id: string; roomNumber: string; type: { name: string; basePrice: number } };
}

interface Customer {
  id: string;
  name: string;
  phone: string;
  email?: string;
}

interface Room {
  id: string;
  roomNumber: string;
  status: string;
  type: { name: string; basePrice: number };
}

interface CheckoutPreview {
  bookingId: string;
  customerName: string;
  roomNumber: string;
  roomCharges: number;
  foodCharges: number;
  extraCharges: number;
  subtotal: number;
  discount: number;
  vatPercent: number;
  vatAmount: number;
  totalAmount: number;
  totalPaid: number;
  dueBeforeSettlement: number;
  lateCheckoutCharge: number;
}

export function BookingsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [step, setStep] = useState(1);

  // Create booking form state
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [checkInDate, setCheckInDate] = useState('');
  const [checkOutDate, setCheckOutDate] = useState('');
  const [adults, setAdults] = useState('1');
  const [children, setChildren] = useState('0');
  const [advancePayment, setAdvancePayment] = useState('0');
  const [bookingNotes, setBookingNotes] = useState('');

  // New customer form
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [newCustomerEmail, setNewCustomerEmail] = useState('');
  const [showNewCustomer, setShowNewCustomer] = useState(false);

  // Check-in dialog state
  const [checkInDialogOpen, setCheckInDialogOpen] = useState(false);
  const [checkInBookingId, setCheckInBookingId] = useState<string | null>(null);
  const [checkInPayment, setCheckInPayment] = useState('0');
  const [checkInPaymentMethod, setCheckInPaymentMethod] = useState('CASH');
  const [checkOutDialogOpen, setCheckOutDialogOpen] = useState(false);
  const [checkOutBookingId, setCheckOutBookingId] = useState<string | null>(null);
  const [checkOutPayment, setCheckOutPayment] = useState('0');
  const [checkOutPaymentMethod, setCheckOutPaymentMethod] = useState('CASH');
  const [checkOutPaymentReference, setCheckOutPaymentReference] = useState('');
  const [checkOutPaymentNotes, setCheckOutPaymentNotes] = useState('');

  const buildQuery = () => {
    const params: string[] = [`page=${page}`, 'limit=20'];
    if (statusFilter !== 'all') params.push(`status=${statusFilter}`);
    return `/bookings?${params.join('&')}`;
  };

  const { data: bookingsData, isLoading } = useQuery({
    queryKey: ['bookings', statusFilter, page],
    queryFn: () => api.get<{ success: boolean; data: Booking[]; meta: { total: number; page: number; totalPages: number } }>(buildQuery()),
  });

  const { data: customersData } = useQuery({
    queryKey: ['customers-list'],
    queryFn: () => api.get<{ success: boolean; data: Customer[] }>('/customers?limit=100'),
  });

  const { data: roomsData } = useQuery({
    queryKey: ['available-rooms'],
    queryFn: () => api.get<{ success: boolean; data: Room[] }>('/rooms?status=AVAILABLE&limit=100'),
  });

  const { data: checkoutPreviewData } = useQuery({
    queryKey: ['checkout-preview', checkOutBookingId],
    queryFn: () =>
      api.get<{ success: boolean; data: CheckoutPreview }>(
        `/bookings/check-out/${checkOutBookingId}`
      ),
    enabled: !!checkOutBookingId && checkOutDialogOpen,
  });

  const bookings = ((bookingsData as any)?.data || []) as Booking[];
  const totalBookings = (bookingsData as any)?.meta?.total || 0;
  const totalPages = (bookingsData as any)?.meta?.totalPages || 1;
  const customers = ((customersData as any)?.data || []) as Customer[];
  const availableRooms = ((roomsData as any)?.data || []) as Room[];

  const filteredBookings = search
    ? bookings.filter(
        (b) =>
          b.customer?.name?.toLowerCase().includes(search.toLowerCase()) ||
          b.room?.roomNumber?.includes(search) ||
          b.id.includes(search)
      )
    : bookings;

  // Calculate estimated cost
  const estimatedCost = () => {
    if (!checkInDate || !checkOutDate || !selectedRoomId) return 0;
    const room = availableRooms.find((r) => r.id === selectedRoomId);
    if (!room) return 0;
    const diff = Math.ceil((new Date(checkOutDate).getTime() - new Date(checkInDate).getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(diff, 0) * room.type.basePrice;
  };

  const createBookingMutation = useMutation({
    mutationFn: (data: any) => api.post('/bookings', data),
    onSuccess: (res: any) => {
      if (!res?.success) {
        toast.error(res?.error || res?.message || 'Failed to create booking');
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      toast.success('Booking created successfully');
      closeCreateDialog();
    },
    onError: () => toast.error('Failed to create booking'),
  });

  const checkInMutation = useMutation({
    mutationFn: ({ id, initialPayment, paymentMethod }: { id: string; initialPayment: number; paymentMethod: string }) =>
      api.post(`/bookings/check-in/${id}`, { initialPayment, paymentMethod }),
    onSuccess: (res: any) => {
      if (!res?.success) {
        toast.error(res?.error || res?.message || 'Failed to check in');
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      toast.success('Guest checked in successfully');
      setCheckInDialogOpen(false);
      setCheckInBookingId(null);
      setCheckInPayment('0');
      setCheckInPaymentMethod('CASH');
    },
    onError: () => toast.error('Failed to check in'),
  });

  const checkOutMutation = useMutation({
    mutationFn: ({
      id,
      finalPayment,
      paymentMethod,
      paymentReference,
      paymentNotes,
    }: {
      id: string;
      finalPayment: number;
      paymentMethod: string;
      paymentReference?: string;
      paymentNotes?: string;
    }) =>
      api.post(`/bookings/check-out/${id}`, {
        finalPayment,
        paymentMethod,
        paymentReference,
        paymentNotes,
      }),
    onSuccess: (res: any) => {
      if (!res?.success) {
        toast.error(res?.error || res?.message || 'Failed to check out');
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      setCheckOutDialogOpen(false);
      setCheckOutBookingId(null);
      setCheckOutPayment('0');
      setCheckOutPaymentMethod('CASH');
      setCheckOutPaymentReference('');
      setCheckOutPaymentNotes('');
      toast.success('Guest checked out and invoice generated successfully');
    },
    onError: () => toast.error('Failed to check out'),
  });

  const createCustomerMutation = useMutation({
    mutationFn: (data: any) => api.post('/customers', data),
    onSuccess: (res: any) => {
      if (!res?.success) {
        toast.error(res?.error || res?.message || 'Failed to create customer');
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['customers-list'] });
      if (res.success && res.data) {
        setSelectedCustomerId(res.data.id);
      }
      toast.success('Customer created');
      setShowNewCustomer(false);
    },
    onError: () => toast.error('Failed to create customer'),
  });

  const generateInvoiceMutation = useMutation({
    mutationFn: (bookingId: string) => api.post('/invoices', { bookingId }),
    onSuccess: (res: any) => {
      if (!res?.success) {
        toast.error(res?.error || res?.message || 'Failed to generate invoice');
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      const invoiceId = res?.data?.id;
      if (invoiceId) {
        window.open(`/invoice/${invoiceId}`, '_blank', 'noopener,noreferrer');
      }
      toast.success('Invoice generated successfully');
    },
    onError: () => toast.error('Failed to generate invoice'),
  });

  const closeCreateDialog = () => {
    setCreateDialogOpen(false);
    setStep(1);
    setSelectedCustomerId('');
    setSelectedRoomId('');
    setCheckInDate('');
    setCheckOutDate('');
    setAdults('1');
    setChildren('0');
    setAdvancePayment('0');
    setBookingNotes('');
    setNewCustomerName('');
    setNewCustomerPhone('');
    setNewCustomerEmail('');
    setShowNewCustomer(false);
  };

  const handleCreateBooking = () => {
    if (!selectedCustomerId || !selectedRoomId || !checkInDate || !checkOutDate) {
      toast.error('Please fill all required fields');
      return;
    }
    createBookingMutation.mutate({
      customerId: selectedCustomerId,
      roomId: selectedRoomId,
      checkIn: checkInDate,
      checkOut: checkOutDate,
      adults: parseInt(adults),
      children: parseInt(children),
      advancePayment: parseFloat(advancePayment) || 0,
      notes: bookingNotes,
    });
  };

  const handleCreateCustomer = () => {
    if (!newCustomerName || !newCustomerPhone) {
      toast.error('Name and phone are required');
      return;
    }
    createCustomerMutation.mutate({
      name: newCustomerName,
      phone: newCustomerPhone,
      email: newCustomerEmail,
    });
  };

  const selectedCheckOutBooking = bookings.find((bk) => bk.id === checkOutBookingId) || null;
  const checkoutPreview = (checkoutPreviewData as any)?.data as CheckoutPreview | undefined;
  const checkOutDue = checkoutPreview?.dueBeforeSettlement ?? selectedCheckOutBooking?.dueAmount ?? 0;
  const checkOutPaymentAmount = parseFloat(checkOutPayment) || 0;
  const checkOutRemaining = Math.max(checkOutDue - checkOutPaymentAmount, 0);

  useEffect(() => {
    if (!checkOutDialogOpen) return;
    setCheckOutPayment(String(checkOutDue || 0));
  }, [checkOutDialogOpen, checkOutDue]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Bookings</h2>
          <p className="text-sm text-muted-foreground">{totalBookings} total bookings</p>
        </div>
        <Button className="bg-amber-600 hover:bg-amber-700 text-white" onClick={() => setCreateDialogOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          New Booking
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search guest or room..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="RESERVED">Reserved</SelectItem>
            <SelectItem value="CHECKED_IN">Checked In</SelectItem>
            <SelectItem value="CHECKED_OUT">Checked Out</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Bookings Table */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border max-h-[600px] overflow-y-auto custom-scrollbar">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 sticky top-0">
              <tr>
                <th className="text-left p-3 font-medium">Guest</th>
                <th className="text-left p-3 font-medium">Room</th>
                <th className="text-left p-3 font-medium">Check-in</th>
                <th className="text-left p-3 font-medium">Check-out</th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-right p-3 font-medium">Total</th>
                <th className="text-right p-3 font-medium">Due</th>
                <th className="text-left p-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredBookings.map((booking) => (
                <tr key={booking.id} className="border-t hover:bg-muted/30">
                  <td className="p-3">
                    <div>
                      <p className="font-medium">{booking.customer?.name}</p>
                      <p className="text-xs text-muted-foreground">{booking.customer?.phone}</p>
                    </div>
                  </td>
                  <td className="p-3">
                    <div>
                      <p className="font-medium">{booking.room?.roomNumber}</p>
                      <p className="text-xs text-muted-foreground">{booking.room?.type?.name}</p>
                    </div>
                  </td>
                  <td className="p-3 text-xs">{format(new Date(booking.checkIn), 'MMM dd, yyyy')}</td>
                  <td className="p-3 text-xs">{format(new Date(booking.checkOut), 'MMM dd, yyyy')}</td>
                  <td className="p-3"><StatusBadge status={booking.status} /></td>
                  <td className="p-3 text-right font-medium">৳{booking.totalRoomCharge.toLocaleString()}</td>
                  <td className="p-3 text-right">
                    <span className={booking.dueAmount > 0 ? 'text-red-600 font-medium' : 'text-emerald-600'}>
                      ৳{booking.dueAmount.toLocaleString()}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-1">
                      {booking.status === 'RESERVED' && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs border-emerald-600 text-emerald-700 hover:bg-emerald-50"
                          onClick={() => {
                            setCheckInBookingId(booking.id);
                            setCheckInPayment('0');
                            setCheckInPaymentMethod('CASH');
                            setCheckInDialogOpen(true);
                          }}
                          disabled={checkInMutation.isPending}
                        >
                          <LogIn className="w-3 h-3 mr-1" />
                          Check-in
                        </Button>
                      )}
                      {booking.status === 'CHECKED_IN' && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs border-slate-500 text-slate-600 hover:bg-slate-50"
                          onClick={() => {
                            setCheckOutBookingId(booking.id);
                            setCheckOutPayment(String(booking.dueAmount || 0));
                            setCheckOutPaymentMethod('CASH');
                            setCheckOutPaymentReference('');
                            setCheckOutPaymentNotes('');
                            setCheckOutDialogOpen(true);
                          }}
                          disabled={checkOutMutation.isPending}
                        >
                          <LogOut className="w-3 h-3 mr-1" />
                          Check-out
                        </Button>
                      )}
                      {(booking.status === 'RESERVED' || booking.status === 'CHECKED_IN') && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-red-500 hover:text-red-600"
                          onClick={() => toast.error('Cancel booking - confirmation needed')}
                        >
                          <XCircle className="w-3 h-3" />
                        </Button>
                      )}
                      {(booking.status === 'CHECKED_OUT' || booking.status === 'CHECKED_IN') && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs border-amber-500 text-amber-700 hover:bg-amber-50"
                          onClick={() => generateInvoiceMutation.mutate(booking.id)}
                          disabled={generateInvoiceMutation.isPending}
                        >
                          <Receipt className="w-3 h-3 mr-1" />
                          Invoice
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredBookings.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-muted-foreground">No bookings found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}

      {/* Check-in Payment Dialog */}
      <Dialog open={checkInDialogOpen} onOpenChange={setCheckInDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LogIn className="h-5 w-5 text-emerald-600" />
              Check-in Guest
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Card className="bg-muted/50">
              <CardContent className="p-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Room Charge</span>
                  <span className="font-medium">৳{(() => {
                    const b = bookings.find(bk => bk.id === checkInBookingId);
                    return b ? b.totalRoomCharge.toLocaleString() : '0';
                  })()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Advance Paid</span>
                  <span className="font-medium">৳{(() => {
                    const b = bookings.find(bk => bk.id === checkInBookingId);
                    return b ? b.advancePayment.toLocaleString() : '0';
                  })()}</span>
                </div>
                <div className="flex justify-between text-sm font-bold border-t pt-1">
                  <span>Current Due</span>
                  <span className="text-red-600">৳{(() => {
                    const b = bookings.find(bk => bk.id === checkInBookingId);
                    return b ? b.dueAmount.toLocaleString() : '0';
                  })()}</span>
                </div>
              </CardContent>
            </Card>
            <div className="space-y-2">
              <Label>Initial Payment at Check-in (BDT)</Label>
              <Input
                type="number"
                value={checkInPayment}
                onChange={(e) => setCheckInPayment(e.target.value)}
                placeholder="0"
                min="0"
              />
              <p className="text-xs text-muted-foreground">
                Remaining due after payment: ৳{(() => {
                  const b = bookings.find(bk => bk.id === checkInBookingId);
                  const due = b ? b.dueAmount - (parseFloat(checkInPayment) || 0) : 0;
                  return Math.max(due, 0).toLocaleString();
                })()}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Payment Method</Label>
              <Select value={checkInPaymentMethod} onValueChange={setCheckInPaymentMethod}>
                <SelectTrigger>
                  <SelectValue placeholder="Select method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH">Cash</SelectItem>
                  <SelectItem value="CARD">Card</SelectItem>
                  <SelectItem value="MOBILE_BANKING">Mobile Banking</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCheckInDialogOpen(false)}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={checkInMutation.isPending}
              onClick={() => {
                if (!checkInBookingId) return;
                checkInMutation.mutate({
                  id: checkInBookingId,
                  initialPayment: parseFloat(checkInPayment) || 0,
                  paymentMethod: checkInPaymentMethod,
                });
              }}
            >
              {checkInMutation.isPending ? 'Checking in...' : 'Confirm Check-in'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Check-out Settlement Dialog */}
      <Dialog open={checkOutDialogOpen} onOpenChange={setCheckOutDialogOpen}>
        <DialogContent className="max-w-3xl p-0 overflow-hidden max-h-[78vh] flex flex-col">
          <DialogHeader className="border-b bg-slate-50 px-6 py-4">
            <DialogTitle className="flex items-center gap-2">
              <LogOut className="h-5 w-5 text-slate-700" />
              Final Check-out & Invoice Settlement
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            <Card className="border-amber-200 bg-gradient-to-r from-amber-50 to-emerald-50">
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 overflow-hidden rounded-lg border bg-white">
                      <Image src="/brand-logo.png" alt="RRP Dream Inn logo" width={40} height={40} className="h-full w-full object-cover" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-800">RRP Dream Inn</p>
                      <p className="text-xs text-slate-500">Professional Final Settlement Invoice</p>
                    </div>
                  </div>
                  <StatusBadge status="CHECKED_IN" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Invoice Details</CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-2 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <p className="text-muted-foreground">Guest</p>
                  <p className="font-medium text-right">{selectedCheckOutBooking?.customer?.name || '-'}</p>
                  <p className="text-muted-foreground">Room</p>
                  <p className="font-medium text-right">{selectedCheckOutBooking?.room?.roomNumber || '-'}</p>
                  <p className="text-muted-foreground">Check-in</p>
                  <p className="font-medium text-right">
                    {selectedCheckOutBooking ? format(new Date(selectedCheckOutBooking.checkIn), 'MMM dd, yyyy') : '-'}
                  </p>
                  <p className="text-muted-foreground">Scheduled Check-out</p>
                  <p className="font-medium text-right">
                    {selectedCheckOutBooking ? format(new Date(selectedCheckOutBooking.checkOut), 'MMM dd, yyyy') : '-'}
                  </p>
                  <p className="text-muted-foreground">Room Charges</p>
                  <p className="font-medium text-right">৳{(checkoutPreview?.roomCharges ?? selectedCheckOutBooking?.totalRoomCharge ?? 0).toLocaleString()}</p>
                  <p className="text-muted-foreground">Restaurant Bill</p>
                  <p className="font-medium text-right">৳{(checkoutPreview?.foodCharges ?? 0).toLocaleString()}</p>
                  <p className="text-muted-foreground">Extra Charges</p>
                  <p className="font-medium text-right">৳{(checkoutPreview?.extraCharges ?? 0).toLocaleString()}</p>
                  <p className="text-muted-foreground">Subtotal</p>
                  <p className="font-semibold text-right">৳{(checkoutPreview?.subtotal ?? selectedCheckOutBooking?.totalRoomCharge ?? 0).toLocaleString()}</p>
                  <p className="text-muted-foreground">Discount</p>
                  <p className="font-medium text-right text-emerald-700">৳{(checkoutPreview?.discount ?? 0).toLocaleString()}</p>
                  <p className="text-muted-foreground">VAT ({checkoutPreview?.vatPercent ?? 0}%)</p>
                  <p className="font-medium text-right">৳{(checkoutPreview?.vatAmount ?? 0).toLocaleString()}</p>
                  <p className="text-muted-foreground">Invoice Total</p>
                  <p className="font-semibold text-right">৳{(checkoutPreview?.totalAmount ?? selectedCheckOutBooking?.totalRoomCharge ?? 0).toLocaleString()}</p>
                  <p className="text-muted-foreground">Paid Amount</p>
                  <p className="font-medium text-right text-emerald-700">৳{(checkoutPreview?.totalPaid ?? 0).toLocaleString()}</p>
                </div>
                <div className="border-t pt-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Current Due</span>
                    <span className="font-semibold text-red-600">৳{checkOutDue.toLocaleString()}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Final Payment (BDT) *</Label>
                <Input
                  type="number"
                  min="0"
                  value={checkOutPayment}
                  onChange={(e) => setCheckOutPayment(e.target.value)}
                  placeholder="Enter full due amount"
                />
                <p className="text-xs text-muted-foreground">
                  Remaining after payment: <span className={checkOutRemaining > 0 ? 'text-red-600 font-semibold' : 'text-emerald-600 font-semibold'}>৳{checkOutRemaining.toLocaleString()}</span>
                </p>
              </div>
              <div className="space-y-2">
                <Label>Payment Method *</Label>
                <Select value={checkOutPaymentMethod} onValueChange={setCheckOutPaymentMethod}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select method" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASH">Cash</SelectItem>
                    <SelectItem value="CARD">Card</SelectItem>
                    <SelectItem value="MOBILE_BANKING">Mobile Banking</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Transaction Reference (optional)</Label>
                <Input
                  value={checkOutPaymentReference}
                  onChange={(e) => setCheckOutPaymentReference(e.target.value)}
                  placeholder="e.g. trx-id / card auth no"
                />
              </div>
              <div className="space-y-2">
                <Label>Payment Notes (optional)</Label>
                <Input
                  value={checkOutPaymentNotes}
                  onChange={(e) => setCheckOutPaymentNotes(e.target.value)}
                  placeholder="Any settlement note"
                />
              </div>
            </div>
          </div>
          <DialogFooter className="border-t bg-white px-6 py-4">
            <Button variant="outline" onClick={() => setCheckOutDialogOpen(false)}>Cancel</Button>
            <Button
              className="bg-slate-800 hover:bg-slate-900 text-white"
              disabled={
                checkOutMutation.isPending ||
                !checkOutBookingId ||
                checkOutPaymentAmount <= 0 ||
                checkOutPaymentAmount < checkOutDue
              }
              onClick={() => {
                if (!checkOutBookingId) return;
                if (checkOutPaymentAmount < checkOutDue) {
                  toast.error('Please clear full due amount before checkout.');
                  return;
                }
                checkOutMutation.mutate({
                  id: checkOutBookingId,
                  finalPayment: checkOutPaymentAmount,
                  paymentMethod: checkOutPaymentMethod,
                  paymentReference: checkOutPaymentReference || undefined,
                  paymentNotes: checkOutPaymentNotes || undefined,
                });
              }}
            >
              {checkOutMutation.isPending ? 'Processing Checkout...' : 'Settle Due, Generate Invoice & Check-out'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Booking Dialog (Multi-step) */}
      <Dialog open={createDialogOpen} onOpenChange={(open) => { if (!open) closeCreateDialog(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Booking - Step {step} of 4</DialogTitle>
          </DialogHeader>

          {/* Step indicators */}
          <div className="flex items-center gap-2 mb-4">
            {[1, 2, 3, 4].map((s) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                  step >= s ? 'bg-amber-600 text-white' : 'bg-muted text-muted-foreground'
                }`}>
                  {s}
                </div>
                {s < 4 && <div className={`w-8 h-0.5 ${step > s ? 'bg-amber-600' : 'bg-muted'}`} />}
              </div>
            ))}
          </div>

          {/* Step 1: Select Customer */}
          {step === 1 && (
            <div className="space-y-4">
              <Label>Select Customer</Label>
              <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose existing customer" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} - {c.phone}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {!showNewCustomer ? (
                <Button variant="outline" size="sm" onClick={() => setShowNewCustomer(true)}>
                  + Create New Customer
                </Button>
              ) : (
                <Card>
                  <CardContent className="p-4 space-y-3">
                    <p className="text-sm font-medium">New Customer</p>
                    <Input placeholder="Full Name" value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} />
                    <Input placeholder="Phone Number" value={newCustomerPhone} onChange={(e) => setNewCustomerPhone(e.target.value)} />
                    <Input placeholder="Email (optional)" value={newCustomerEmail} onChange={(e) => setNewCustomerEmail(e.target.value)} />
                    <Button size="sm" onClick={handleCreateCustomer} disabled={createCustomerMutation.isPending}>
                      {createCustomerMutation.isPending ? 'Creating...' : 'Create Customer'}
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Step 2: Select Room & Dates */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Select Room</Label>
                <Select value={selectedRoomId} onValueChange={setSelectedRoomId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose available room" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableRooms.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        Room {r.roomNumber} - {r.type.name} (৳{r.type.basePrice}/night)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Check-in Date</Label>
                  <Input type="date" value={checkInDate} onChange={(e) => setCheckInDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Check-out Date</Label>
                  <Input type="date" value={checkOutDate} onChange={(e) => setCheckOutDate(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Adults</Label>
                  <Input type="number" value={adults} onChange={(e) => setAdults(e.target.value)} min="1" />
                </div>
                <div className="space-y-2">
                  <Label>Children</Label>
                  <Input type="number" value={children} onChange={(e) => setChildren(e.target.value)} min="0" />
                </div>
              </div>
              {estimatedCost() > 0 && (
                <Card className="bg-amber-50 border-amber-200">
                  <CardContent className="p-3">
                    <p className="text-sm font-medium text-amber-800">Estimated Cost: ৳{estimatedCost().toLocaleString()}</p>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Step 3: Payment */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Advance Payment (BDT)</Label>
                <Input
                  type="number"
                  value={advancePayment}
                  onChange={(e) => setAdvancePayment(e.target.value)}
                  placeholder="0"
                />
              </div>
              <Card className="bg-muted/50">
                <CardContent className="p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Total Room Charge</span>
                    <span className="font-medium">৳{estimatedCost().toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Advance Payment</span>
                    <span className="font-medium">৳{(parseFloat(advancePayment) || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold border-t pt-2">
                    <span>Due Amount</span>
                    <span className="text-red-600">৳{(estimatedCost() - (parseFloat(advancePayment) || 0)).toLocaleString()}</span>
                  </div>
                </CardContent>
              </Card>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea value={bookingNotes} onChange={(e) => setBookingNotes(e.target.value)} placeholder="Special requests..." rows={2} />
              </div>
            </div>
          )}

          {/* Step 4: Confirm */}
          {step === 4 && (
            <Card>
              <CardContent className="p-4 space-y-2">
                <h3 className="font-semibold">Booking Summary</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <span className="text-muted-foreground">Customer</span>
                  <span className="font-medium">{customers.find((c) => c.id === selectedCustomerId)?.name || 'N/A'}</span>
                  <span className="text-muted-foreground">Room</span>
                  <span className="font-medium">{availableRooms.find((r) => r.id === selectedRoomId)?.roomNumber || 'N/A'}</span>
                  <span className="text-muted-foreground">Check-in</span>
                  <span className="font-medium">{checkInDate ? format(new Date(checkInDate), 'MMM dd, yyyy') : 'N/A'}</span>
                  <span className="text-muted-foreground">Check-out</span>
                  <span className="font-medium">{checkOutDate ? format(new Date(checkOutDate), 'MMM dd, yyyy') : 'N/A'}</span>
                  <span className="text-muted-foreground">Total</span>
                  <span className="font-medium">৳{estimatedCost().toLocaleString()}</span>
                  <span className="text-muted-foreground">Advance</span>
                  <span className="font-medium">৳{(parseFloat(advancePayment) || 0).toLocaleString()}</span>
                  <span className="text-muted-foreground">Due</span>
                  <span className="font-bold text-red-600">৳{(estimatedCost() - (parseFloat(advancePayment) || 0)).toLocaleString()}</span>
                </div>
              </CardContent>
            </Card>
          )}

          <DialogFooter>
            {step > 1 && (
              <Button variant="outline" onClick={() => setStep(step - 1)}>Back</Button>
            )}
            {step < 4 ? (
              <Button
                className="bg-amber-600 hover:bg-amber-700 text-white"
                onClick={() => setStep(step + 1)}
                disabled={step === 1 && !selectedCustomerId}
              >
                Next
              </Button>
            ) : (
              <Button
                className="bg-amber-600 hover:bg-amber-700 text-white"
                onClick={handleCreateBooking}
                disabled={createBookingMutation.isPending}
              >
                {createBookingMutation.isPending ? 'Creating...' : 'Confirm Booking'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
