'use client'

import { Fragment, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { toast } from 'sonner'
import {
  UtensilsCrossed,
  ShoppingBag,
  BedDouble,
  Clock,
  ChefHat,
  CheckCircle2,
  AlertCircle,
  Eye,
  Flame,
  ChevronDown,
  ChevronUp,
  Filter,
  Search,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

// Types
interface OrderItem {
  id: string
  menuItemId: string
  quantity: number
  price: number
  notes: string | null
  kotStatus: string
  menuItem: {
    id: string
    name: string
    price: number
    isVeg: boolean
  }
}

interface RestaurantOrder {
  id: string
  orderNumber: string
  orderType: 'DINE_IN' | 'TAKEAWAY' | 'ROOM_SERVICE'
  status: 'PENDING' | 'COOKING' | 'READY' | 'DELIVERED' | 'CANCELLED'
  roomId: string | null
  tableId: string | null
  customerName: string | null
  customerPhone: string | null
  subtotal: number
  discount: number
  vatAmount: number
  vatPercent: number
  totalAmount: number
  notes: string | null
  createdAt: string
  items: OrderItem[]
  room: { id: string; roomNumber: string; status: string } | null
  table: { id: string; tableNumber: string; capacity: number; status: string } | null
  creator: { id: string; name: string; email: string } | null
}

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: typeof Clock; label: string }> = {
  PENDING: { color: 'text-yellow-700', bg: 'bg-yellow-100 border-yellow-200', icon: Clock, label: 'Pending' },
  COOKING: { color: 'text-orange-700', bg: 'bg-orange-100 border-orange-200', icon: Flame, label: 'Cooking' },
  READY: { color: 'text-green-700', bg: 'bg-green-100 border-green-200', icon: CheckCircle2, label: 'Ready' },
  DELIVERED: { color: 'text-slate-500', bg: 'bg-slate-100 border-slate-200', icon: CheckCircle2, label: 'Delivered' },
  CANCELLED: { color: 'text-red-600', bg: 'bg-red-100 border-red-200', icon: AlertCircle, label: 'Cancelled' },
}

const ORDER_TYPE_CONFIG: Record<string, { icon: typeof UtensilsCrossed; label: string; color: string }> = {
  DINE_IN: { icon: UtensilsCrossed, label: 'Dine-in', color: 'text-blue-600' },
  TAKEAWAY: { icon: ShoppingBag, label: 'Takeaway', color: 'text-purple-600' },
  ROOM_SERVICE: { icon: BedDouble, label: 'Room Svc', color: 'text-amber-600' },
}

export default function OrdersPage() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState('ALL')
  const [selectedOrder, setSelectedOrder] = useState<RestaurantOrder | null>(null)
  const [filterType, setFilterType] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedRow, setExpandedRow] = useState<string | null>(null)

  // Fetch orders
  const { data: ordersData, isLoading } = useQuery({
    queryKey: ['restaurant-orders', activeTab, filterType],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '100' })
      if (activeTab !== 'ALL') params.set('status', activeTab)
      if (filterType !== 'all') params.set('orderType', filterType)
      return api.get<{ success: boolean; data: RestaurantOrder[]; meta?: { total: number } }>(
        `/restaurant-orders?${params.toString()}`
      )
    },
    refetchInterval: 15000,
  })

  const orders = ordersData?.data || []

  // Status update mutation
  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/restaurant-orders/${id}/status`, { status }),
    onSuccess: (_, variables) => {
      const nextStatus: Record<string, string> = {
        PENDING: 'Cooking',
        COOKING: 'Ready',
        READY: 'Delivered',
      }
      toast.success(`Order moved to ${nextStatus[variables.status] || variables.status}`)
      queryClient.invalidateQueries({ queryKey: ['restaurant-orders'] })
    },
    onError: (error: Error) => {
      toast.error('Failed to update order status', { description: error.message })
    },
  })

  // Filter orders by search
  const filteredOrders = orders.filter((order) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (
      order.orderNumber.toLowerCase().includes(q) ||
      order.customerName?.toLowerCase().includes(q) ||
      order.room?.roomNumber.toLowerCase().includes(q) ||
      order.table?.tableNumber.toLowerCase().includes(q)
    )
  })

  // Status counts
  const statusCounts = {
    ALL: orders.length,
    PENDING: orders.filter((o) => o.status === 'PENDING').length,
    COOKING: orders.filter((o) => o.status === 'COOKING').length,
    READY: orders.filter((o) => o.status === 'READY').length,
    DELIVERED: orders.filter((o) => o.status === 'DELIVERED').length,
  }

  const getNextStatus = (current: string): string | null => {
    const flow: Record<string, string> = {
      PENDING: 'COOKING',
      COOKING: 'READY',
      READY: 'DELIVERED',
    }
    return flow[current] || null
  }

  const getNextStatusLabel = (current: string): string => {
    const labels: Record<string, string> = {
      PENDING: 'Start Cooking',
      COOKING: 'Mark Ready',
      READY: 'Mark Delivered',
    }
    return labels[current] || ''
  }

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }

  const timeElapsed = (dateStr: string) => {
    const now = new Date()
    const then = new Date(dateStr)
    const diff = Math.floor((now.getTime() - then.getTime()) / 60000)
    if (diff < 1) return 'Just now'
    if (diff < 60) return `${diff}m ago`
    return `${Math.floor(diff / 60)}h ${diff % 60}m ago`
  }

  return (
    <div className="h-full flex flex-col bg-slate-50">
      {/* Header */}
      <div className="bg-slate-900 text-white px-6 py-4 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500 flex items-center justify-center">
              <ChefHat className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Orders Management</h1>
              <p className="text-xs text-slate-400">CloudView Restaurant</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="px-6 py-3 bg-white border-b shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search orders..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-9"
            />
          </div>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue placeholder="Order Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="DINE_IN">Dine-in</SelectItem>
              <SelectItem value="TAKEAWAY">Takeaway</SelectItem>
              <SelectItem value="ROOM_SERVICE">Room Service</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Status Tabs */}
      <div className="px-6 pt-3 bg-white border-b shrink-0">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-slate-100">
            {Object.entries(statusCounts).map(([key, count]) => (
              <TabsTrigger key={key} value={key} className="text-xs gap-1.5">
                {key === 'ALL' ? 'All' : key.charAt(0) + key.slice(1).toLowerCase()}
                <Badge variant="secondary" className="h-4 min-w-4 text-[10px] px-1">
                  {count}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Orders Table */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400">
            <ChefHat className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">No orders found</p>
          </div>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">Order #</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Table/Room</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrders.map((order) => {
                  const statusCfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.PENDING
                  const typeCfg = ORDER_TYPE_CONFIG[order.orderType]
                  const TypeIcon = typeCfg.icon
                  const nextStatus = getNextStatus(order.status)
                  const isExpanded = expandedRow === order.id

                  return (
                    <Fragment key={order.id}>
                      <TableRow
                        className="cursor-pointer hover:bg-slate-50"
                        onClick={() => setExpandedRow(isExpanded ? null : order.id)}
                      >
                        <TableCell className="font-mono font-semibold text-sm">
                          {order.orderNumber}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <TypeIcon className={`w-4 h-4 ${typeCfg.color}`} />
                            <span className="text-xs">{typeCfg.label}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {order.orderType === 'DINE_IN' && order.table && (
                            <span className="text-xs">T-{order.table.tableNumber}</span>
                          )}
                          {order.orderType === 'ROOM_SERVICE' && order.room && (
                            <span className="text-xs">R-{order.room.roomNumber}</span>
                          )}
                          {order.orderType === 'TAKEAWAY' && order.customerName && (
                            <span className="text-xs">{order.customerName}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">
                            {order.items.length}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-semibold text-sm">
                          ৳{order.totalAmount.toFixed(0)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`${statusCfg.bg} ${statusCfg.color} border text-xs`}
                          >
                            {statusCfg.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-slate-500">
                          {formatTime(order.createdAt)}
                          <br />
                          <span className="text-[10px]">{timeElapsed(order.createdAt)}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => setSelectedOrder(order)}
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                            {nextStatus && (
                              <Button
                                size="sm"
                                className="h-7 text-xs bg-amber-600 hover:bg-amber-700"
                                onClick={() =>
                                  statusMutation.mutate({ id: order.id, status: nextStatus })
                                }
                                disabled={statusMutation.isPending}
                              >
                                {getNextStatusLabel(order.status)}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow key={`${order.id}-detail`}>
                          <TableCell colSpan={8} className="bg-slate-50 px-8 py-4">
                            <div className="space-y-2">
                              <h4 className="font-semibold text-sm text-slate-700">Order Items</h4>
                              {order.items.map((item) => (
                                <div
                                  key={item.id}
                                  className="flex items-center justify-between text-sm"
                                >
                                  <div className="flex items-center gap-2">
                                    <span
                                      className={`w-2 h-2 rounded-full ${
                                        item.menuItem.isVeg ? 'bg-green-500' : 'bg-red-500'
                                      }`}
                                    />
                                    <span>{item.menuItem.name}</span>
                                    <span className="text-slate-400">× {item.quantity}</span>
                                  </div>
                                  <span className="font-medium">
                                    ৳{(item.price * item.quantity).toFixed(0)}
                                  </span>
                                </div>
                              ))}
                              <Separator />
                              <div className="flex justify-between text-xs text-slate-500">
                                <span>Subtotal: ৳{order.subtotal.toFixed(0)}</span>
                                <span>Discount: ৳{order.discount.toFixed(0)}</span>
                                <span>VAT: ৳{order.vatAmount.toFixed(0)}</span>
                                <span className="font-bold text-slate-800">
                                  Total: ৳{order.totalAmount.toFixed(0)}
                                </span>
                              </div>
                              {order.notes && (
                                <div className="text-xs text-slate-500 bg-amber-50 p-2 rounded">
                                  📝 {order.notes}
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>

      {/* Order Detail Dialog */}
      <Dialog open={!!selectedOrder} onOpenChange={() => setSelectedOrder(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Order {selectedOrder?.orderNumber}
              {selectedOrder && (() => {
                const cfg = STATUS_CONFIG[selectedOrder.status]
                return (
                  <Badge variant="outline" className={`${cfg.bg} ${cfg.color} border`}>
                    {cfg.label}
                  </Badge>
                )
              })()}
            </DialogTitle>
          </DialogHeader>
          {selectedOrder && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-slate-500">Type:</span>{' '}
                  {ORDER_TYPE_CONFIG[selectedOrder.orderType].label}
                </div>
                <div>
                  <span className="text-slate-500">Created:</span>{' '}
                  {formatTime(selectedOrder.createdAt)}
                </div>
                {selectedOrder.orderType === 'DINE_IN' && selectedOrder.table && (
                  <div>
                    <span className="text-slate-500">Table:</span>{' '}
                    {selectedOrder.table.tableNumber}
                  </div>
                )}
                {selectedOrder.orderType === 'ROOM_SERVICE' && selectedOrder.room && (
                  <div>
                    <span className="text-slate-500">Room:</span>{' '}
                    {selectedOrder.room.roomNumber}
                  </div>
                )}
                {selectedOrder.orderType === 'TAKEAWAY' && selectedOrder.customerName && (
                  <div>
                    <span className="text-slate-500">Customer:</span>{' '}
                    {selectedOrder.customerName}
                  </div>
                )}
                {selectedOrder.creator && (
                  <div>
                    <span className="text-slate-500">Created by:</span>{' '}
                    {selectedOrder.creator.name}
                  </div>
                )}
              </div>

              <Separator />

              <div>
                <h4 className="font-semibold text-sm mb-2">Items</h4>
                <div className="space-y-2">
                  {selectedOrder.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            item.menuItem.isVeg ? 'bg-green-500' : 'bg-red-500'
                          }`}
                        />
                        <span>{item.menuItem.name}</span>
                        <span className="text-slate-400">× {item.quantity}</span>
                      </div>
                      <span className="font-medium">
                        ৳{(item.price * item.quantity).toFixed(0)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <Separator />

              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Subtotal</span>
                  <span>৳{selectedOrder.subtotal.toFixed(0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Discount</span>
                  <span>৳{selectedOrder.discount.toFixed(0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">VAT ({selectedOrder.vatPercent}%)</span>
                  <span>৳{selectedOrder.vatAmount.toFixed(0)}</span>
                </div>
                <Separator />
                <div className="flex justify-between font-bold">
                  <span>Total</span>
                  <span className="text-amber-700">৳{selectedOrder.totalAmount.toFixed(0)}</span>
                </div>
              </div>

              {selectedOrder.notes && (
                <div className="bg-amber-50 p-3 rounded-lg text-sm">
                  <span className="font-medium">Notes:</span> {selectedOrder.notes}
                </div>
              )}

              {getNextStatus(selectedOrder.status) && (
                <Button
                  onClick={() => {
                    statusMutation.mutate({
                      id: selectedOrder.id,
                      status: getNextStatus(selectedOrder.status)!,
                    })
                    setSelectedOrder(null)
                  }}
                  disabled={statusMutation.isPending}
                  className="w-full bg-amber-600 hover:bg-amber-700"
                >
                  {getNextStatusLabel(selectedOrder.status)}
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
