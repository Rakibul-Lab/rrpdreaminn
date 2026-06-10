'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { toast } from 'sonner'
import {
  Plus,
  UserRound,
  Phone,
  History,
  Pencil,
  UserX,
  UserCheck,
  ClipboardList,
  BedDouble,
  UtensilsCrossed,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'

interface WaiterListItem {
  id: string
  name: string
  phone: string | null
  active: boolean
  notes: string | null
  createdAt: string
  updatedAt: string
  _count: { orders: number }
}

interface WaiterOrderHistory {
  id: string
  orderNumber: string
  orderType: string
  status: string
  totalAmount: number
  createdAt: string
  room: { roomNumber: string } | null
  table: { tableNumber: string } | null
}

interface WaiterDetail extends WaiterListItem {
  orders: WaiterOrderHistory[]
}

interface WaiterFormData {
  name: string
  phone: string
  notes: string
  active: boolean
}

const defaultWaiterForm: WaiterFormData = {
  name: '',
  phone: '',
  notes: '',
  active: true,
}

const ORDER_TYPE_LABELS: Record<string, string> = {
  DINE_IN: 'Dine-in',
  TAKEAWAY: 'Takeaway',
  ROOM_SERVICE: 'Room service',
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  PREPARING: 'bg-blue-50 text-blue-700 border-blue-200',
  READY: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  DELIVERED: 'bg-green-50 text-green-700 border-green-200',
  CANCELLED: 'bg-red-50 text-red-700 border-red-200',
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function WaitersPage() {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingWaiter, setEditingWaiter] = useState<WaiterListItem | null>(null)
  const [waiterForm, setWaiterForm] = useState<WaiterFormData>(defaultWaiterForm)
  const [historyWaiterId, setHistoryWaiterId] = useState<string | null>(null)

  const { data: waitersData, isLoading } = useQuery({
    queryKey: ['restaurant-waiters', 'manage'],
    queryFn: () =>
      api.get<{ success: boolean; data: WaiterListItem[] }>('/restaurant-waiters'),
  })
  const waiters = waitersData?.data || []

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['restaurant-waiter', historyWaiterId],
    queryFn: () =>
      api.get<{ success: boolean; data: WaiterDetail }>(`/restaurant-waiters/${historyWaiterId}`),
    enabled: !!historyWaiterId,
  })
  const historyWaiter = historyData?.data

  const activeCount = waiters.filter((w) => w.active).length
  const totalOrders = waiters.reduce((sum, w) => sum + (w._count?.orders ?? 0), 0)

  const saveMutation = useMutation({
    mutationFn: (data: WaiterFormData) => {
      const payload = {
        name: data.name,
        phone: data.phone || null,
        notes: data.notes || null,
        active: data.active,
      }
      if (editingWaiter) {
        return api.put(`/restaurant-waiters/${editingWaiter.id}`, payload)
      }
      return api.post('/restaurant-waiters', payload)
    },
    onSuccess: () => {
      toast.success(editingWaiter ? 'Waiter updated' : 'Waiter created')
      queryClient.invalidateQueries({ queryKey: ['restaurant-waiters'] })
      if (historyWaiterId) {
        queryClient.invalidateQueries({ queryKey: ['restaurant-waiter', historyWaiterId] })
      }
      setDialogOpen(false)
      setEditingWaiter(null)
      setWaiterForm(defaultWaiterForm)
    },
    onError: (error: Error) =>
      toast.error(editingWaiter ? 'Failed to update waiter' : 'Failed to create waiter', {
        description: error.message,
      }),
  })

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.put(`/restaurant-waiters/${id}`, { active }),
    onSuccess: (_, { active }) => {
      toast.success(active ? 'Waiter activated' : 'Waiter deactivated')
      queryClient.invalidateQueries({ queryKey: ['restaurant-waiters'] })
      if (historyWaiterId) {
        queryClient.invalidateQueries({ queryKey: ['restaurant-waiter', historyWaiterId] })
      }
    },
    onError: (error: Error) =>
      toast.error('Failed to update waiter status', { description: error.message }),
  })

  const openCreateDialog = () => {
    setEditingWaiter(null)
    setWaiterForm(defaultWaiterForm)
    setDialogOpen(true)
  }

  const openEditDialog = (waiter: WaiterListItem) => {
    setEditingWaiter(waiter)
    setWaiterForm({
      name: waiter.name,
      phone: waiter.phone || '',
      notes: waiter.notes || '',
      active: waiter.active,
    })
    setDialogOpen(true)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Waiter Management</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create waiters for room service on the POS terminal and review their order history.
          </p>
        </div>
        <Button onClick={openCreateDialog} className="bg-amber-600 hover:bg-amber-700 text-white">
          <Plus className="h-4 w-4 mr-2" />
          Add Waiter
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-amber-100 flex items-center justify-center">
                <UserRound className="h-5 w-5 text-amber-700" />
              </div>
              <div>
                <p className="text-2xl font-bold">{waiters.length}</p>
                <p className="text-xs text-muted-foreground">Total waiters</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                <UserCheck className="h-5 w-5 text-emerald-700" />
              </div>
              <div>
                <p className="text-2xl font-bold">{activeCount}</p>
                <p className="text-xs text-muted-foreground">Active on POS</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <ClipboardList className="h-5 w-5 text-blue-700" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalOrders}</p>
                <p className="text-xs text-muted-foreground">Orders served</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      ) : waiters.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <UserRound className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
            <p className="font-medium">No waiters yet</p>
            <p className="text-sm text-muted-foreground mt-1 mb-4">
              Add your first waiter to show them on the POS room service flow.
            </p>
            <Button onClick={openCreateDialog} className="bg-amber-600 hover:bg-amber-700 text-white">
              <Plus className="h-4 w-4 mr-2" />
              Add Waiter
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {waiters.map((waiter) => (
            <Card
              key={waiter.id}
              className={`transition-shadow hover:shadow-md ${!waiter.active ? 'opacity-75' : ''}`}
            >
              <CardContent className="pt-5 space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-11 w-11 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                      <span className="text-sm font-bold text-amber-800">
                        {waiter.name
                          .split(' ')
                          .map((n) => n[0])
                          .join('')
                          .slice(0, 2)
                          .toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{waiter.name}</p>
                      {waiter.phone ? (
                        <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                          <Phone className="h-3 w-3 shrink-0" />
                          {waiter.phone}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">No phone</p>
                      )}
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      waiter.active
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200 shrink-0'
                        : 'bg-muted text-muted-foreground shrink-0'
                    }
                  >
                    {waiter.active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Orders served</span>
                  <span className="font-semibold">{waiter._count?.orders ?? 0}</span>
                </div>

                {waiter.notes && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{waiter.notes}</p>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 min-w-[100px]"
                    onClick={() => setHistoryWaiterId(waiter.id)}
                  >
                    <History className="h-3.5 w-3.5 mr-1.5" />
                    History
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEditDialog(waiter)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      toggleActiveMutation.mutate({ id: waiter.id, active: !waiter.active })
                    }
                    disabled={toggleActiveMutation.isPending}
                  >
                    {waiter.active ? (
                      <UserX className="h-3.5 w-3.5 text-red-600" />
                    ) : (
                      <UserCheck className="h-3.5 w-3.5 text-emerald-600" />
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingWaiter ? 'Edit Waiter' : 'Add Waiter'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="waiter-name">Name *</Label>
              <Input
                id="waiter-name"
                placeholder="e.g. Karim Ahmed"
                value={waiterForm.name}
                onChange={(e) => setWaiterForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="waiter-phone">Phone</Label>
              <Input
                id="waiter-phone"
                placeholder="e.g. 01712345678"
                value={waiterForm.phone}
                onChange={(e) => setWaiterForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="waiter-notes">Notes</Label>
              <Textarea
                id="waiter-notes"
                placeholder="Shift, section, or other notes…"
                value={waiterForm.notes}
                onChange={(e) => setWaiterForm((f) => ({ ...f, notes: e.target.value }))}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={() => saveMutation.mutate(waiterForm)}
              disabled={!waiterForm.name.trim() || saveMutation.isPending}
            >
              {editingWaiter ? 'Save changes' : 'Create waiter'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={!!historyWaiterId} onOpenChange={(open) => !open && setHistoryWaiterId(null)}>
        <SheetContent className="w-full sm:max-w-lg flex flex-col p-0">
          <SheetHeader className="px-6 pt-6 pb-4 border-b">
            <SheetTitle className="flex items-center gap-2">
              <History className="h-5 w-5 text-amber-600" />
              Order history
            </SheetTitle>
            {historyWaiter && (
              <p className="text-sm text-muted-foreground">
                {historyWaiter.name} · {historyWaiter._count?.orders ?? 0} order
                {(historyWaiter._count?.orders ?? 0) === 1 ? '' : 's'}
              </p>
            )}
          </SheetHeader>

          <ScrollArea className="flex-1 px-6 py-4">
            {historyLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : !historyWaiter || (historyWaiter.orders?.length ?? 0) === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <ClipboardList className="h-10 w-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">No orders assigned to this waiter yet.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {(historyWaiter.orders ?? []).map((order) => (
                  <div key={order.id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-sm">{order.orderNumber}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDateTime(order.createdAt)}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={STATUS_COLORS[order.status] || 'bg-muted'}
                      >
                        {order.status}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <UtensilsCrossed className="h-3 w-3" />
                        {ORDER_TYPE_LABELS[order.orderType] || order.orderType}
                      </span>
                      {order.room && (
                        <span className="inline-flex items-center gap-1">
                          <BedDouble className="h-3 w-3" />
                          Room {order.room.roomNumber}
                        </span>
                      )}
                      {order.table && (
                        <span>Table {order.table.tableNumber}</span>
                      )}
                    </div>
                    <Separator />
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Total</span>
                      <span className="font-semibold">৳{order.totalAmount.toFixed(0)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </div>
  )
}
