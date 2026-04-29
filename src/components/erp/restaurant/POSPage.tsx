'use client'

import { useState, useMemo, useCallback } from 'react'
import Image from 'next/image'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { useAuthStore } from '@/lib/auth-store'
import { toast } from 'sonner'
import {
  Search,
  Plus,
  Minus,
  Trash2,
  UtensilsCrossed,
  ShoppingBag,
  BedDouble,
  CreditCard,
  Clock,
  Flame,
  Leaf,
  ChefHat,
  Send,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

// Types
interface MenuCategory {
  id: string
  name: string
  description: string | null
  active: boolean
  sortOrder: number
  itemCount: number
}

interface MenuItem {
  id: string
  categoryId: string
  name: string
  description: string | null
  price: number
  image: string | null
  available: boolean
  isVeg: boolean
  preparationTime: number | null
  category: { id: string; name: string }
}

interface OccupiedRoom {
  room_id: string
  room_number: string
  room_type: string
  current_booking_id: string | null
}

interface RestaurantTable {
  id: string
  tableNumber: string
  capacity: number
  status: string
  location: string | null
}

interface CartItem {
  menuItem: MenuItem
  quantity: number
}

type OrderType = 'DINE_IN' | 'TAKEAWAY' | 'ROOM_SERVICE'
type DiscountType = 'PERCENTAGE' | 'AMOUNT'

export default function POSPage() {
  const user = useAuthStore((s) => s.user)
  const queryClient = useQueryClient()

  // State
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])
  const [orderType, setOrderType] = useState<OrderType>('DINE_IN')
  const [tableId, setTableId] = useState<string>('')
  const [roomId, setRoomId] = useState<string>('')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [discount, setDiscount] = useState<number>(0)
  const [discountType, setDiscountType] = useState<DiscountType>('PERCENTAGE')
  const [notes, setNotes] = useState('')
  const [showNotes, setShowNotes] = useState(false)

  // Fetch menu categories
  const { data: categoriesData, isLoading: categoriesLoading } = useQuery({
    queryKey: ['menu-categories'],
    queryFn: () => api.get<{ success: boolean; data: MenuCategory[] }>('/menu-categories'),
  })
  const categories = categoriesData?.data || []

  // Fetch menu items (all, for POS we want all available)
  const { data: menuItemsData, isLoading: menuLoading } = useQuery({
    queryKey: ['menu-items-pos', 'all'],
    queryFn: () =>
      api.get<{ success: boolean; data: MenuItem[]; meta?: { total: number } }>(
        '/menu-items?limit=200&available=true'
      ),
  })
  const menuItems = menuItemsData?.data || []

  // Fetch occupied rooms for room service
  const { data: occupiedRoomsData, isLoading: roomsLoading } = useQuery({
    queryKey: ['occupied-rooms'],
    queryFn: () => api.get<{ success: boolean; data: OccupiedRoom[] }>('/occupied-rooms'),
    enabled: orderType === 'ROOM_SERVICE',
  })
  const occupiedRooms = occupiedRoomsData?.data || []

  // Fetch restaurant tables
  const { data: tablesData, isLoading: tablesLoading } = useQuery({
    queryKey: ['restaurant-tables'],
    queryFn: () =>
      api.get<{ success: boolean; data: RestaurantTable[] }>('/restaurant-tables'),
    enabled: orderType === 'DINE_IN',
  })
  const tables = tablesData?.data || []

  // Place order mutation
  const placeOrderMutation = useMutation({
    mutationFn: (orderData: Record<string, unknown>) =>
      api.post<{ success: boolean; data: unknown; message?: string }>('/restaurant-orders', orderData),
    onSuccess: () => {
      toast.success('Order placed successfully!', {
        description: 'The order has been sent to the kitchen.',
      })
      // Clear cart and form
      setCart([])
      setDiscount(0)
      setDiscountType('PERCENTAGE')
      setNotes('')
      setShowNotes(false)
      setTableId('')
      setRoomId('')
      setCustomerName('')
      setCustomerPhone('')
      queryClient.invalidateQueries({ queryKey: ['restaurant-orders'] })
      queryClient.invalidateQueries({ queryKey: ['restaurant-tables'] })
    },
    onError: (error: Error) => {
      toast.error('Failed to place order', {
        description: error.message || 'Please try again.',
      })
    },
  })

  // Filter menu items
  const filteredItems = useMemo(() => {
    let items = menuItems.filter((item) => item.available)
    if (selectedCategory !== 'all') {
      items = items.filter((item) => item.categoryId === selectedCategory)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      items = items.filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          item.description?.toLowerCase().includes(q)
      )
    }
    return items
  }, [menuItems, selectedCategory, searchQuery])

  // Cart operations
  const addToCart = useCallback((menuItem: MenuItem) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.menuItem.id === menuItem.id)
      if (existing) {
        return prev.map((c) =>
          c.menuItem.id === menuItem.id ? { ...c, quantity: c.quantity + 1 } : c
        )
      }
      return [...prev, { menuItem, quantity: 1 }]
    })
  }, [])

  const updateQuantity = useCallback((menuItemId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) =>
          c.menuItem.id === menuItemId ? { ...c, quantity: c.quantity + delta } : c
        )
        .filter((c) => c.quantity > 0)
    )
  }, [])

  const removeFromCart = useCallback((menuItemId: string) => {
    setCart((prev) => prev.filter((c) => c.menuItem.id !== menuItemId))
  }, [])

  const clearCart = useCallback(() => {
    setCart([])
    setDiscount(0)
    setDiscountType('PERCENTAGE')
    setNotes('')
    setShowNotes(false)
  }, [])

  // Calculations
  const subtotal = cart.reduce((sum, c) => sum + c.menuItem.price * c.quantity, 0)
  const vatPercent = 15
  const discountAmount =
    discountType === 'PERCENTAGE'
      ? (subtotal * Math.max(0, Math.min(100, discount))) / 100
      : Math.max(0, Math.min(subtotal, discount))
  const vatAmount = ((subtotal - discountAmount) * vatPercent) / 100
  const totalAmount = subtotal - discountAmount + vatAmount

  // Place order
  const handlePlaceOrder = () => {
    if (cart.length === 0) {
      toast.error('Cart is empty', { description: 'Please add items to the order.' })
      return
    }

    if (orderType === 'DINE_IN' && !tableId) {
      toast.error('Table required', { description: 'Please select a table for dine-in orders.' })
      return
    }

    if (orderType === 'ROOM_SERVICE' && !roomId) {
      toast.error('Room required', { description: 'Please select an occupied room for room service.' })
      return
    }

    if (orderType === 'TAKEAWAY' && !customerName.trim()) {
      toast.error('Customer name required', { description: 'Please enter customer name for takeaway orders.' })
      return
    }

    if (discountType === 'PERCENTAGE' && discount > 100) {
      toast.error('Invalid discount', { description: 'Discount percentage cannot exceed 100%.' })
      return
    }
    if (discountType === 'AMOUNT' && discount > subtotal) {
      toast.error('Invalid discount', { description: 'Discount amount cannot exceed subtotal.' })
      return
    }

    const orderData: Record<string, unknown> = {
      orderType,
      items: cart.map((c) => ({
        menuItemId: c.menuItem.id,
        quantity: c.quantity,
      })),
      vatPercent,
      discount: discountAmount,
      notes: notes.trim() || undefined,
    }

    if (orderType === 'DINE_IN') {
      orderData.tableId = tableId
    }
    if (orderType === 'ROOM_SERVICE') {
      orderData.roomId = roomId
    }
    if (orderType === 'TAKEAWAY') {
      orderData.customerName = customerName.trim()
      orderData.customerPhone = customerPhone.trim() || undefined
    }

    placeOrderMutation.mutate(orderData)
  }

  // Available tables for dine-in
  const availableTables = tables.filter((t) => t.status === 'available')

  const getItemImageSrc = (item: MenuItem) => {
    if (item.image && item.image.trim()) return item.image
    const params = new URLSearchParams({
      seed: item.id,
      name: item.name,
      w: '360',
      h: '220',
    })
    return `/api/placeholder/food?${params.toString()}`
  }

  return (
    <div className="flex h-[calc(100dvh-8.5rem)] max-h-[calc(100dvh-8.5rem)] bg-slate-50 overflow-hidden">
      {/* Left Panel - Menu */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500 flex items-center justify-center">
              <ChefHat className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-wide">CloudView</h1>
              <p className="text-xs text-slate-400">Restaurant POS</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="border-amber-500/50 text-amber-400 text-xs">
              {user?.name || 'Staff'}
            </Badge>
            <div className="text-xs text-slate-400">
              {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </div>
          </div>
        </div>

        {/* Search Bar */}
        <div className="px-4 py-3 bg-white border-b shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search menu items..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-10 bg-slate-50 border-slate-200"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Category Tabs */}
        <div className="px-4 py-2 bg-white border-b shrink-0">
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
            <Button
              key="all"
              variant={selectedCategory === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedCategory('all')}
              className={
                selectedCategory === 'all'
                  ? 'bg-amber-600 hover:bg-amber-700 text-white shrink-0'
                  : 'shrink-0'
              }
            >
              All
            </Button>
            {categoriesLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-24 shrink-0" />
                ))
              : categories
                  .filter((c) => c.active)
                  .map((cat) => (
                    <Button
                      key={cat.id}
                      variant={selectedCategory === cat.id ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setSelectedCategory(cat.id)}
                      className={
                        selectedCategory === cat.id
                          ? 'bg-amber-600 hover:bg-amber-700 text-white shrink-0'
                          : 'shrink-0'
                      }
                    >
                      {cat.name}
                      <span className="ml-1.5 text-xs opacity-60">({cat.itemCount})</span>
                    </Button>
                  ))}
          </div>
        </div>

        {/* Menu Items Grid */}
        <div className="flex-1 overflow-y-auto p-4 [scrollbar-width:none] hover:[scrollbar-width:thin] [&::-webkit-scrollbar]:w-0 hover:[&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:bg-slate-300 hover:[&::-webkit-scrollbar-thumb]:rounded-full">
          {menuLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {Array.from({ length: 12 }).map((_, i) => (
                <Skeleton key={i} className="h-32 rounded-lg" />
              ))}
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400">
              <UtensilsCrossed className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm">No menu items found</p>
              {searchQuery && (
                <p className="text-xs mt-1">Try a different search term</p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {filteredItems.map((item) => {
                const inCart = cart.find((c) => c.menuItem.id === item.id)
                return (
                  <button
                    key={item.id}
                    onClick={() => addToCart(item)}
                    className={`text-left bg-white rounded-lg border-2 p-3 transition-all hover:shadow-md active:scale-[0.98] ${
                      inCart
                        ? 'border-amber-400 shadow-sm bg-amber-50/50'
                        : 'border-slate-100 hover:border-amber-200'
                    }`}
                  >
                    <div className="mb-2 overflow-hidden rounded-md border border-slate-100 bg-slate-50">
                      <Image
                        src={getItemImageSrc(item)}
                        alt={item.name}
                        width={360}
                        height={220}
                        className="h-24 w-full object-cover"
                        unoptimized
                      />
                    </div>
                    <div className="flex items-start justify-between gap-1">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span
                            className={`w-3 h-3 rounded-full border-2 shrink-0 ${
                              item.isVeg
                                ? 'border-green-600 bg-green-500'
                                : 'border-red-600 bg-red-500'
                            }`}
                            title={item.isVeg ? 'Vegetarian' : 'Non-Vegetarian'}
                          />
                          <h3 className="font-semibold text-sm text-slate-800 truncate">
                            {item.name}
                          </h3>
                        </div>
                        {item.description && (
                          <p className="text-[11px] text-slate-400 line-clamp-1 mb-1">
                            {item.description}
                          </p>
                        )}
                      </div>
                      {inCart && (
                        <Badge className="bg-amber-500 text-white text-[10px] shrink-0 h-5 min-w-5 flex items-center justify-center">
                          {inCart.quantity}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-amber-700 font-bold text-sm">
                        ৳{item.price.toFixed(0)}
                      </span>
                      {item.preparationTime && (
                        <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                          <Clock className="w-2.5 h-2.5" />
                          {item.preparationTime}m
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right Panel - Order */}
      <div className="w-[380px] bg-white border-l flex flex-col shrink-0 shadow-xl h-full max-h-full overflow-hidden">
        {/* Order Header */}
        <div className="px-4 py-3 bg-slate-900 text-white shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-base">Current Order</h2>
            {cart.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearCart}
                className="text-slate-400 hover:text-red-400 hover:bg-transparent h-7 text-xs"
              >
                Clear All
              </Button>
            )}
          </div>

          {/* Order Type Toggle */}
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { type: 'DINE_IN' as OrderType, icon: UtensilsCrossed, label: 'Dine-in' },
              { type: 'TAKEAWAY' as OrderType, icon: ShoppingBag, label: 'Takeaway' },
              { type: 'ROOM_SERVICE' as OrderType, icon: BedDouble, label: 'Room Svc' },
            ].map(({ type, icon: Icon, label }) => (
              <button
                key={type}
                onClick={() => {
                  setOrderType(type)
                  setTableId('')
                  setRoomId('')
                  setCustomerName('')
                  setCustomerPhone('')
                }}
                className={`flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition-all ${
                  orderType === type
                    ? 'bg-amber-500 text-white'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Order Details Section */}
        <div className="px-4 py-3 border-b bg-slate-50 shrink-0">
          {orderType === 'DINE_IN' && (
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1.5 block">
                Select Table
              </label>
              {tablesLoading ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                <Select value={tableId} onValueChange={setTableId}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Choose a table..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableTables.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-slate-400">
                        No available tables
                      </div>
                    ) : (
                      availableTables.map((table) => (
                        <SelectItem key={table.id} value={table.id}>
                          <span className="flex items-center gap-2">
                            Table {table.tableNumber}
                            <span className="text-slate-400 text-xs">
                              ({table.capacity} seats{table.location ? ` · ${table.location}` : ''})
                            </span>
                          </span>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {orderType === 'ROOM_SERVICE' && (
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1.5 block">
                Select Occupied Room
              </label>
              {roomsLoading ? (
                <Skeleton className="h-9 w-full" />
              ) : occupiedRooms.length === 0 ? (
                <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-md">
                  <BedDouble className="w-4 h-4 text-amber-500 shrink-0" />
                  <p className="text-xs text-amber-700">
                    No occupied rooms available for room service
                  </p>
                </div>
              ) : (
                <Select value={roomId} onValueChange={setRoomId}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Choose a room..." />
                  </SelectTrigger>
                  <SelectContent>
                    {occupiedRooms.map((room) => (
                      <SelectItem key={room.room_id} value={room.room_id}>
                        <span className="flex items-center gap-2">
                          Room {room.room_number}
                          <span className="text-slate-400 text-xs">
                            ({room.room_type})
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {orderType === 'TAKEAWAY' && (
            <div className="space-y-2">
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">
                  Customer Name *
                </label>
                <Input
                  placeholder="Enter customer name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="h-9"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">
                  Phone Number
                </label>
                <Input
                  placeholder="Enter phone number"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  className="h-9"
                />
              </div>
            </div>
          )}
        </div>

        {/* Cart Items */}
        <ScrollArea className="flex-1 min-h-0 overflow-hidden">
          <div className="p-4">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-300">
                <ShoppingBag className="w-10 h-10 mb-2" />
                <p className="text-sm">No items in cart</p>
                <p className="text-xs mt-1">Tap menu items to add</p>
              </div>
            ) : (
              <div className="space-y-2">
                {cart.map((item) => (
                  <div
                    key={item.menuItem.id}
                    className="flex items-start gap-2 p-2.5 bg-slate-50 rounded-lg border border-slate-100"
                  >
                    <span
                      className={`w-2.5 h-2.5 rounded-full border mt-1.5 shrink-0 ${
                        item.menuItem.isVeg
                          ? 'border-green-600 bg-green-500'
                          : 'border-red-600 bg-red-500'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">
                        {item.menuItem.name}
                      </p>
                      <p className="text-xs text-amber-700 font-semibold">
                        ৳{(item.menuItem.price * item.quantity).toFixed(0)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => updateQuantity(item.menuItem.id, -1)}
                      >
                        <Minus className="w-3 h-3" />
                      </Button>
                      <span className="w-7 text-center text-sm font-semibold">
                        {item.quantity}
                      </span>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => updateQuantity(item.menuItem.id, 1)}
                      >
                        <Plus className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-red-400 hover:text-red-600 hover:bg-red-50"
                        onClick={() => removeFromCart(item.menuItem.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Order Summary & Actions */}
        <div className="border-t bg-white shrink-0 sticky bottom-0 z-10">
          {/* Notes */}
          {cart.length > 0 && (
            <div className="px-4 pt-3">
              <div className="flex justify-end items-center gap-2">
                <span className="text-xs font-medium text-slate-600">Notes</span>
                <Switch
                  checked={showNotes}
                  onCheckedChange={setShowNotes}
                  className="data-[state=checked]:bg-black data-[state=unchecked]:bg-slate-300"
                />
              </div>
            </div>
          )}
          {cart.length > 0 && showNotes && (
            <div className="px-4 pt-3">
              <Textarea
                placeholder="Special instructions..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="h-16 text-xs resize-none"
              />
            </div>
          )}

          {/* Totals */}
          <div className="px-4 py-3 space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Subtotal</span>
              <span className="font-medium">৳{subtotal.toFixed(0)}</span>
            </div>
            <div className="flex justify-between text-sm items-center">
              <span className="text-slate-500">Discount</span>
              <div className="flex items-center gap-1.5">
                <Select
                  value={discountType}
                  onValueChange={(v) => setDiscountType(v as DiscountType)}
                >
                  <SelectTrigger className="h-7 w-[98px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PERCENTAGE">Percentage</SelectItem>
                    <SelectItem value="AMOUNT">Amount</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min={0}
                  max={discountType === 'PERCENTAGE' ? 100 : subtotal}
                  value={discount || ''}
                  onChange={(e) => setDiscount(Math.max(0, Number(e.target.value) || 0))}
                  className="h-7 w-20 text-right text-xs"
                  placeholder={discountType === 'PERCENTAGE' ? '%' : '৳'}
                />
              </div>
            </div>
            <div className="flex justify-between text-xs text-slate-500">
              <span>Discount Applied</span>
              <span>৳{discountAmount.toFixed(0)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">VAT ({vatPercent}%)</span>
              <span className="font-medium">৳{vatAmount.toFixed(0)}</span>
            </div>
            <Separator />
            <div className="flex justify-between text-base font-bold">
              <span>Total</span>
              <span className="text-amber-700">৳{totalAmount.toFixed(0)}</span>
            </div>
          </div>

          {/* Place Order Button */}
          <div className="px-4 pb-4">
            <Button
              onClick={handlePlaceOrder}
              disabled={cart.length === 0 || placeOrderMutation.isPending}
              className="w-full h-12 bg-amber-600 hover:bg-amber-700 text-white font-bold text-base gap-2 disabled:opacity-50"
            >
              {placeOrderMutation.isPending ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Placing Order...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Place Order ({cart.length} {cart.length === 1 ? 'item' : 'items'})
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
