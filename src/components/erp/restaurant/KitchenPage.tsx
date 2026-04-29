'use client'

import { useState, useEffect } from 'react'
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
  Flame,
  AlertCircle,
  Bell,
  RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'

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
  totalAmount: number
  notes: string | null
  createdAt: string
  items: OrderItem[]
  room: { id: string; roomNumber: string; status: string } | null
  table: { id: string; tableNumber: string; capacity: number; status: string } | null
}

function OrderTimer({ createdAt }: { createdAt: string }) {
  const [elapsed, setElapsed] = useState('')

  useEffect(() => {
    const update = () => {
      const now = new Date()
      const then = new Date(createdAt)
      const diffSec = Math.floor((now.getTime() - then.getTime()) / 1000)
      const mins = Math.floor(diffSec / 60)
      const secs = diffSec % 60
      if (mins >= 60) {
        const hrs = Math.floor(mins / 60)
        setElapsed(`${hrs}h ${mins % 60}m`)
      } else {
        setElapsed(`${mins}m ${secs}s`)
      }
    }
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [createdAt])

  const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000)
  const isUrgent = mins >= 20
  const isWarning = mins >= 10 && !isUrgent

  return (
    <div className={`flex items-center gap-1 text-xs font-mono ${
      isUrgent ? 'text-red-600' : isWarning ? 'text-amber-600' : 'text-slate-500'
    }`}>
      <Clock className="w-3 h-3" />
      {elapsed}
    </div>
  )
}

const ORDER_TYPE_ICON: Record<string, { icon: typeof UtensilsCrossed; label: string }> = {
  DINE_IN: { icon: UtensilsCrossed, label: 'Dine-in' },
  TAKEAWAY: { icon: ShoppingBag, label: 'Takeaway' },
  ROOM_SERVICE: { icon: BedDouble, label: 'Room Svc' },
}

export default function KitchenPage() {
  const queryClient = useQueryClient()
  const [newOrderFlash, setNewOrderFlash] = useState<Set<string>>(new Set())

  // Fetch pending and cooking orders
  const { data: pendingData, isLoading: pendingLoading } = useQuery({
    queryKey: ['kitchen-orders', 'PENDING'],
    queryFn: () =>
      api.get<{ success: boolean; data: RestaurantOrder[] }>(
        '/restaurant-orders?status=PENDING&limit=50'
      ),
    refetchInterval: 2000,
  })

  const { data: cookingData, isLoading: cookingLoading } = useQuery({
    queryKey: ['kitchen-orders', 'COOKING'],
    queryFn: () =>
      api.get<{ success: boolean; data: RestaurantOrder[] }>(
        '/restaurant-orders?status=COOKING&limit=50'
      ),
    refetchInterval: 2000,
  })

  const { data: readyData, isLoading: readyLoading } = useQuery({
    queryKey: ['kitchen-orders', 'READY'],
    queryFn: () =>
      api.get<{ success: boolean; data: RestaurantOrder[] }>(
        '/restaurant-orders?status=READY&limit=50'
      ),
    refetchInterval: 2000,
  })

  const pendingOrders = pendingData?.data || []
  const cookingOrders = cookingData?.data || []
  const readyOrders = readyData?.data || []

  // Status update mutation
  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/restaurant-orders/${id}/status`, { status }),
    onSuccess: (_, variables) => {
      const labels: Record<string, string> = {
        COOKING: 'moved to Cooking',
        READY: 'marked as Ready',
      }
      toast.success(`Order ${labels[variables.status] || 'updated'}`)
      queryClient.invalidateQueries({ queryKey: ['kitchen-orders'] })
    },
    onError: (error: Error) => {
      toast.error('Failed to update order', { description: error.message })
    },
  })

  const renderOrderCard = (order: RestaurantOrder, nextStatus: string | null, nextLabel: string) => {
    const typeCfg = ORDER_TYPE_ICON[order.orderType]
    const TypeIcon = typeCfg.icon
    const mins = Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60000)
    const isUrgent = mins >= 20
    const isWarning = mins >= 10 && !isUrgent

    return (
      <Card
        key={order.id}
        className={`mb-3 border-2 transition-all ${
          isUrgent
            ? 'border-red-300 bg-red-50/50 shadow-red-100'
            : isWarning
            ? 'border-amber-200 bg-amber-50/30'
            : 'border-slate-200'
        }`}
      >
        <CardHeader className="pb-2 pt-3 px-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-bold font-mono">
              {order.orderNumber}
            </CardTitle>
            <OrderTimer createdAt={order.createdAt} />
          </div>
          <div className="flex items-center gap-2 mt-1">
            <div className="flex items-center gap-1 text-xs text-slate-600">
              <TypeIcon className="w-3 h-3" />
              {typeCfg.label}
            </div>
            {order.orderType === 'DINE_IN' && order.table && (
              <Badge variant="outline" className="text-[10px] h-5">
                T-{order.table.tableNumber}
              </Badge>
            )}
            {order.orderType === 'ROOM_SERVICE' && order.room && (
              <Badge variant="outline" className="text-[10px] h-5">
                R-{order.room.roomNumber}
              </Badge>
            )}
            {order.orderType === 'TAKEAWAY' && order.customerName && (
              <Badge variant="outline" className="text-[10px] h-5">
                {order.customerName}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="px-3 pb-3">
          <div className="space-y-1.5 mb-3">
            {order.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      item.menuItem.isVeg ? 'bg-green-500' : 'bg-red-500'
                    }`}
                  />
                  <span className="truncate">{item.menuItem.name}</span>
                </div>
                <Badge variant="secondary" className="text-xs h-5 min-w-5 justify-center shrink-0">
                  ×{item.quantity}
                </Badge>
              </div>
            ))}
          </div>

          {order.notes && (
            <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 px-2 py-1 rounded mb-2">
              📝 {order.notes}
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">
              ৳{order.totalAmount.toFixed(0)}
            </span>
            {nextStatus && (
              <Button
                size="sm"
                className={`h-7 text-xs ${
                  nextStatus === 'READY'
                    ? 'bg-green-600 hover:bg-green-700'
                    : 'bg-amber-600 hover:bg-amber-700'
                }`}
                onClick={() => statusMutation.mutate({ id: order.id, status: nextStatus })}
                disabled={statusMutation.isPending}
              >
                {nextStatus === 'COOKING' && <Flame className="w-3 h-3 mr-1" />}
                {nextStatus === 'READY' && <CheckCircle2 className="w-3 h-3 mr-1" />}
                {nextLabel}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    )
  }

  const isLoading = pendingLoading || cookingLoading || readyLoading

  return (
    <div className="h-full flex flex-col bg-slate-100">
      {/* Header */}
      <div className="bg-slate-900 text-white px-6 py-3 shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-orange-500 flex items-center justify-center">
            <Flame className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold">Kitchen Display</h1>
            <p className="text-xs text-slate-400">CloudView KDS</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="text-slate-400 hover:text-white"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ['kitchen-orders'] })
              toast.success('Refreshed orders')
            }}
          >
            <RefreshCw className="w-4 h-4 mr-1" />
            Refresh
          </Button>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>Auto-refresh: 2s</span>
          </div>
        </div>
      </div>

      {/* Kanban Columns */}
      <div className="flex-1 flex gap-0 overflow-hidden p-4">
        {/* Pending Column */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between mb-3 px-1">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-yellow-400" />
              <h2 className="font-bold text-sm text-slate-700">Pending</h2>
              <Badge variant="secondary" className="text-xs h-5">
                {pendingOrders.length}
              </Badge>
            </div>
          </div>
          <ScrollArea className="flex-1">
            {pendingLoading ? (
              <div className="space-y-3 pr-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-40 rounded-lg" />
                ))}
              </div>
            ) : pendingOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-slate-400">
                <CheckCircle2 className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-xs">No pending orders</p>
              </div>
            ) : (
              <div className="pr-2">
                {pendingOrders.map((order) =>
                  renderOrderCard(order, 'COOKING', 'Start Cooking')
                )}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Cooking Column */}
        <div className="flex-1 flex flex-col min-w-0 mx-4">
          <div className="flex items-center justify-between mb-3 px-1">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-orange-500" />
              <h2 className="font-bold text-sm text-slate-700">Cooking</h2>
              <Badge variant="secondary" className="text-xs h-5">
                {cookingOrders.length}
              </Badge>
            </div>
          </div>
          <ScrollArea className="flex-1">
            {cookingLoading ? (
              <div className="space-y-3 pr-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-40 rounded-lg" />
                ))}
              </div>
            ) : cookingOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-slate-400">
                <ChefHat className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-xs">No orders cooking</p>
              </div>
            ) : (
              <div className="pr-2">
                {cookingOrders.map((order) =>
                  renderOrderCard(order, 'READY', 'Mark Ready')
                )}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Ready Column */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between mb-3 px-1">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <h2 className="font-bold text-sm text-slate-700">Ready</h2>
              <Badge variant="secondary" className="text-xs h-5">
                {readyOrders.length}
              </Badge>
            </div>
          </div>
          <ScrollArea className="flex-1">
            {readyLoading ? (
              <div className="space-y-3 pr-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-40 rounded-lg" />
                ))}
              </div>
            ) : readyOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-slate-400">
                <CheckCircle2 className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-xs">No orders ready</p>
              </div>
            ) : (
              <div className="pr-2">
                {readyOrders.map((order) =>
                  renderOrderCard(order, 'DELIVERED', 'Mark Delivered')
                )}
              </div>
            )}
          </ScrollArea>
        </div>
      </div>
    </div>
  )
}
