'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import Image from 'next/image'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore, canAccessHotel, canAccessRestaurant, canAccessAdmin } from '@/lib/auth-store'
import { api } from '@/lib/api-client'
import {
  LayoutDashboard, FileText, CreditCard, BarChart3, Users, Settings,
  ScrollText, Package, LogOut, Hotel, UtensilsCrossed, Menu, X,
  Bed, CalendarCheck, UserCircle, SprayCan, ShoppingCart,
  ChefHat, Grid3X3, ClipboardList, DoorOpen, Tag, Bell
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useToast } from '@/hooks/use-toast'

// Page components - Hotel (named exports)
import { Dashboard as HotelDashboard } from '@/components/erp/hotel/Dashboard'
import { RoomsPage } from '@/components/erp/hotel/RoomsPage'
import { RoomTypesPage } from '@/components/erp/hotel/RoomTypesPage'
import { BookingsPage } from '@/components/erp/hotel/BookingsPage'
import { CustomersPage } from '@/components/erp/hotel/CustomersPage'
import { HousekeepingPage } from '@/components/erp/hotel/HousekeepingPage'
import POSPage from '@/components/erp/restaurant/POSPage'
import MenuPage from '@/components/erp/restaurant/MenuPage'
import OrdersPage from '@/components/erp/restaurant/OrdersPage'
import KitchenPage from '@/components/erp/restaurant/KitchenPage'
import TablesPage from '@/components/erp/restaurant/TablesPage'
import InvoicesPage from '@/components/erp/billing/InvoicesPage'
import PaymentsPage from '@/components/erp/billing/PaymentsPage'
import ReportsPage from '@/components/erp/reports/ReportsPage'
import AdminDashboard from '@/components/erp/admin/AdminDashboard'
import SettingsPage from '@/components/erp/admin/SettingsPage'
import UsersPage from '@/components/erp/admin/UsersPage'
import ActivityLogsPage from '@/components/erp/admin/ActivityLogsPage'
import InventoryPage from '@/components/erp/admin/InventoryPage'

type PageKey = 
  | 'hotel-dashboard' | 'rooms' | 'room-types' | 'bookings' | 'customers' | 'housekeeping'
  | 'pos' | 'menu' | 'orders' | 'kitchen' | 'tables'
  | 'invoices' | 'payments' | 'reports'
  | 'admin-dashboard' | 'users' | 'settings' | 'logs' | 'inventory'

interface NavItem {
  key: PageKey
  label: string
  icon: React.ReactNode
  allowedRoles: string[]
  group: string
}

interface AppNotification {
  id: string
  title: string
  message: string
  type: string
  read: boolean
  createdAt: string
}

const navItems: NavItem[] = [
  // Hotel - RRP Dream Inn
  { key: 'hotel-dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" />, allowedRoles: ['ADMIN', 'HOTEL_STAFF'], group: 'RRP Dream Inn' },
  { key: 'rooms', label: 'Rooms', icon: <Bed className="h-4 w-4" />, allowedRoles: ['ADMIN', 'HOTEL_STAFF'], group: 'RRP Dream Inn' },
  { key: 'room-types', label: 'Room Types', icon: <Tag className="h-4 w-4" />, allowedRoles: ['ADMIN', 'HOTEL_STAFF'], group: 'RRP Dream Inn' },
  { key: 'bookings', label: 'Bookings', icon: <CalendarCheck className="h-4 w-4" />, allowedRoles: ['ADMIN', 'HOTEL_STAFF'], group: 'RRP Dream Inn' },
  { key: 'customers', label: 'Guests', icon: <UserCircle className="h-4 w-4" />, allowedRoles: ['ADMIN', 'HOTEL_STAFF'], group: 'RRP Dream Inn' },
  { key: 'housekeeping', label: 'Housekeeping', icon: <SprayCan className="h-4 w-4" />, allowedRoles: ['ADMIN', 'HOTEL_STAFF'], group: 'RRP Dream Inn' },
  // Restaurant - CloudView
  { key: 'hotel-dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" />, allowedRoles: ['RESTAURANT_STAFF'], group: 'CloudView' },
  { key: 'pos', label: 'POS Terminal', icon: <ShoppingCart className="h-4 w-4" />, allowedRoles: ['ADMIN', 'RESTAURANT_STAFF'], group: 'CloudView' },
  { key: 'menu', label: 'Menu Management', icon: <UtensilsCrossed className="h-4 w-4" />, allowedRoles: ['ADMIN', 'RESTAURANT_STAFF'], group: 'CloudView' },
  { key: 'orders', label: 'Orders', icon: <ClipboardList className="h-4 w-4" />, allowedRoles: ['ADMIN', 'RESTAURANT_STAFF'], group: 'CloudView' },
  { key: 'kitchen', label: 'Kitchen Display', icon: <ChefHat className="h-4 w-4" />, allowedRoles: ['ADMIN', 'RESTAURANT_STAFF', 'HOTEL_STAFF'], group: 'CloudView' },
  { key: 'tables', label: 'Tables', icon: <Grid3X3 className="h-4 w-4" />, allowedRoles: ['ADMIN', 'RESTAURANT_STAFF'], group: 'CloudView' },
  // Billing
  { key: 'invoices', label: 'Invoices', icon: <FileText className="h-4 w-4" />, allowedRoles: ['ADMIN', 'HOTEL_STAFF'], group: 'Billing' },
  { key: 'payments', label: 'Payments', icon: <CreditCard className="h-4 w-4" />, allowedRoles: ['ADMIN', 'HOTEL_STAFF', 'RESTAURANT_STAFF'], group: 'Billing' },
  // Analytics
  { key: 'reports', label: 'Reports', icon: <BarChart3 className="h-4 w-4" />, allowedRoles: ['ADMIN', 'HOTEL_STAFF', 'RESTAURANT_STAFF'], group: 'Analytics' },
  // Admin
  { key: 'admin-dashboard', label: 'Admin Overview', icon: <LayoutDashboard className="h-4 w-4" />, allowedRoles: ['ADMIN'], group: 'System' },
  { key: 'users', label: 'Users', icon: <Users className="h-4 w-4" />, allowedRoles: ['ADMIN'], group: 'System' },
  { key: 'inventory', label: 'Inventory', icon: <Package className="h-4 w-4" />, allowedRoles: ['ADMIN'], group: 'System' },
  { key: 'settings', label: 'Settings', icon: <Settings className="h-4 w-4" />, allowedRoles: ['ADMIN'], group: 'System' },
  { key: 'logs', label: 'Activity Logs', icon: <ScrollText className="h-4 w-4" />, allowedRoles: ['ADMIN'], group: 'System' },
]

const CURRENT_PAGE_STORAGE_KEY = 'erp-current-page'

function LoginForm() {
  const { login } = useAuthStore()
  const { toast } = useToast()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [seeding, setSeeding] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await api.post<{ success: boolean; data: { user: { id: string; email: string; name: string; avatar?: string | null; role: string }; token: string } }>('/auth/login', { email, password })
      if (res.success && res.data) {
        login(res.data.user as any, res.data.token)
        toast({ title: 'Welcome!', description: `Logged in as ${res.data.user.name}` })
      } else {
        toast({ title: 'Login Failed', description: (res as any).error || 'Invalid credentials', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Login Failed', description: 'Invalid email or password', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const handleSeed = async () => {
    setSeeding(true)
    try {
      const res = await api.post<{ success: boolean; message: string }>('/auth/seed')
      if (res.success) {
        toast({ title: 'Database Seeded!', description: 'You can now login with the demo accounts below' })
      } else {
        toast({ title: 'Already Seeded', description: 'Database already has data', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Seed Failed', description: 'Database may already be seeded', variant: 'destructive' })
    } finally {
      setSeeding(false)
    }
  }

  const quickLogin = (email: string, password: string) => {
    setEmail(email)
    setPassword(password)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 via-white to-emerald-50 p-4">
      <div className="w-full max-w-lg">
        {/* Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white shadow-lg mb-4 border border-slate-200 overflow-hidden">
            <Image src="/brand-logo.png" alt="RRP Dream Inn logo" width={64} height={64} className="h-full w-full object-cover" />
          </div>
          <h1 className="text-3xl font-bold text-slate-800">ERP System</h1>
          <div className="flex items-center justify-center gap-3 mt-2">
            <Badge className="bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100">
              <Hotel className="h-3 w-3 mr-1" /> RRP Dream Inn
            </Badge>
            <span className="text-slate-300">+</span>
            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">
              <UtensilsCrossed className="h-3 w-3 mr-1" /> CloudView
            </Badge>
          </div>
        </div>

        <Card className="shadow-xl border-0">
          <CardContent className="p-6">
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="mt-1"
                />
              </div>
              <Button
                type="submit"
                className="w-full bg-gradient-to-r from-amber-600 to-emerald-600 hover:from-amber-700 hover:to-emerald-700 text-white shadow-md"
                disabled={loading}
                size="lg"
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </Button>
            </form>

            <Separator className="my-5" />

            <div className="space-y-3">
              <Button
                variant="outline"
                className="w-full border-dashed"
                onClick={handleSeed}
                disabled={seeding}
                size="sm"
              >
                <Package className="h-4 w-4 mr-2" />
                {seeding ? 'Seeding...' : 'Seed Database (First Time)'}
              </Button>

              <p className="text-xs text-slate-400 text-center font-medium">QUICK LOGIN</p>
              <div className="grid grid-cols-1 gap-2">
                <button
                  type="button"
                  onClick={() => quickLogin('admin@erp.com', 'admin123')}
                  className="flex items-center gap-3 p-2.5 rounded-lg bg-red-50 hover:bg-red-100 transition-colors text-left w-full"
                >
                  <div className="h-8 w-8 rounded-full bg-red-200 flex items-center justify-center">
                    <LayoutDashboard className="h-4 w-4 text-red-700" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-red-800">Admin</p>
                    <p className="text-xs text-red-500">Full system access</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => quickLogin('hotel@erp.com', 'hotel123')}
                  className="flex items-center gap-3 p-2.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 transition-colors text-left w-full"
                >
                  <div className="h-8 w-8 rounded-full bg-emerald-200 flex items-center justify-center">
                    <Hotel className="h-4 w-4 text-emerald-700" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-emerald-800">Hotel Staff</p>
                    <p className="text-xs text-emerald-500">Rooms, bookings, billing</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => quickLogin('restaurant@erp.com', 'rest123')}
                  className="flex items-center gap-3 p-2.5 rounded-lg bg-amber-50 hover:bg-amber-100 transition-colors text-left w-full"
                >
                  <div className="h-8 w-8 rounded-full bg-amber-200 flex items-center justify-center">
                    <UtensilsCrossed className="h-4 w-4 text-amber-700" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-amber-800">Restaurant Staff</p>
                    <p className="text-xs text-amber-500">POS, menu, orders</p>
                  </div>
                </button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function getDefaultPage(role: string | undefined): PageKey {
  if (role === 'ADMIN') return 'admin-dashboard'
  if (role === 'HOTEL_STAFF') return 'hotel-dashboard'
  if (role === 'RESTAURANT_STAFF') return 'hotel-dashboard'
  return 'hotel-dashboard'
}

const pageTitles: Record<PageKey, string> = {
  'hotel-dashboard': 'Hotel Dashboard',
  'rooms': 'Room Management',
  'room-types': 'Room Types',
  'bookings': 'Bookings & Reservations',
  'customers': 'Guest Management',
  'housekeeping': 'Housekeeping',
  'pos': 'POS Terminal',
  'menu': 'Menu Management',
  'orders': 'Order Management',
  'kitchen': 'Kitchen Display',
  'tables': 'Table Management',
  'invoices': 'Invoices',
  'payments': 'Payments',
  'reports': 'Reports & Analytics',
  'admin-dashboard': 'Admin Dashboard',
  'users': 'User Management',
  'settings': 'System Settings',
  'logs': 'Activity Logs',
  'inventory': 'Inventory Management',
}

function ERPApp() {
  const { user, logout } = useAuthStore()
  const queryClient = useQueryClient()
  const [currentPage, setCurrentPage] = useState<PageKey>('hotel-dashboard')
  const [pageRefreshNonce, setPageRefreshNonce] = useState(0)
  const [headerLoading, setHeaderLoading] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [now, setNow] = useState<Date>(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const isPageAllowedForRole = useCallback((page: PageKey, role: string | undefined): boolean => {
    if (!role) return false
    return navItems.some((item) => item.key === page && item.allowedRoles.includes(role))
  }, [])

  const getSavedPage = useCallback((): PageKey | null => {
    if (typeof window === 'undefined') return null
    const saved = window.localStorage.getItem(CURRENT_PAGE_STORAGE_KEY)
    if (!saved) return null
    return saved as PageKey
  }, [])

  // Restore page on login/reload and enforce role-safe fallback.
  useEffect(() => {
    if (!user?.role) return

    const savedPage = getSavedPage()
    const targetPage =
      savedPage && isPageAllowedForRole(savedPage, user.role)
        ? savedPage
        : getDefaultPage(user.role)

    setCurrentPage((prev) => (prev === targetPage ? prev : targetPage))
  }, [user?.id, user?.role, getSavedPage, isPageAllowedForRole])

  // Persist current section so refresh lands on same page.
  useEffect(() => {
    if (typeof window === 'undefined' || !user?.role) return
    if (!isPageAllowedForRole(currentPage, user.role)) return
    window.localStorage.setItem(CURRENT_PAGE_STORAGE_KEY, currentPage)
  }, [currentPage, user?.role, isPageAllowedForRole])

  const handleLogout = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(CURRENT_PAGE_STORAGE_KEY)
    }
    logout()
  }, [logout])

  // Get allowed nav items based on role
  const allowedNavItems = navItems.filter(
    (item) => user && item.allowedRoles.includes(user.role)
  )

  const roleBadgeColors: Record<string, string> = {
    ADMIN: 'bg-red-50 text-red-700 border-red-200',
    HOTEL_STAFF: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    RESTAURANT_STAFF: 'bg-amber-50 text-amber-700 border-amber-200',
  }

  const handlePageNavigation = useCallback((page: PageKey) => {
    setHeaderLoading(true)
    setCurrentPage((prev) => {
      if (prev === page) {
        setPageRefreshNonce((nonce) => nonce + 1)
      }
      return page
    })
  }, [])

  useEffect(() => {
    if (!headerLoading) return

    const timer = setTimeout(() => setHeaderLoading(false), 550)
    return () => clearTimeout(timer)
  }, [headerLoading, currentPage, pageRefreshNonce])

  const renderPage = useCallback(() => {
    switch (currentPage) {
      case 'hotel-dashboard': return <HotelDashboard onNavigate={handlePageNavigation} />
      case 'rooms': return <RoomsPage />
      case 'room-types': return <RoomTypesPage />
      case 'bookings': return <BookingsPage />
      case 'customers': return <CustomersPage />
      case 'housekeeping': return <HousekeepingPage />
      case 'pos': return <POSPage />
      case 'menu': return <MenuPage />
      case 'orders': return <OrdersPage />
      case 'kitchen': return <KitchenPage />
      case 'tables': return <TablesPage />
      case 'invoices': return <InvoicesPage />
      case 'payments': return <PaymentsPage />
      case 'reports': return <ReportsPage />
      case 'admin-dashboard': return <AdminDashboard />
      case 'users': return <UsersPage />
      case 'settings': return <SettingsPage />
      case 'logs': return <ActivityLogsPage />
      case 'inventory': return <InventoryPage />
      default: return <HotelDashboard onNavigate={handlePageNavigation} />
    }
  }, [currentPage, handlePageNavigation])

  const { data: notifRes } = useQuery({
    queryKey: ['header-notifications'],
    queryFn: () =>
      api.get<{ success: boolean; data: AppNotification[]; meta?: { total: number } }>(
        '/notifications?limit=10'
      ),
    refetchInterval: 2000,
  })
  const notifications = notifRes?.data || []
  const unreadCount = notifications.filter((n) => !n.read).length

  const markAllReadMutation = useMutation({
    mutationFn: () => api.put('/notifications', { markAll: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['header-notifications'] })
    },
  })

  // Group nav items
  const groupedNav: Record<string, NavItem[]> = {}
  allowedNavItems.forEach((item) => {
    if (!groupedNav[item.group]) groupedNav[item.group] = []
    groupedNav[item.group].push(item)
  })

  const groupColors: Record<string, string> = {
    'RRP Dream Inn': 'text-emerald-600',
    'CloudView': 'text-amber-600',
    'Billing': 'text-slate-600',
    'Analytics': 'text-slate-600',
    'System': 'text-red-600',
  }

  const groupBgColors: Record<string, string> = {
    'RRP Dream Inn': 'bg-emerald-50',
    'CloudView': 'bg-amber-50',
    'Billing': 'bg-slate-50',
    'Analytics': 'bg-slate-50',
    'System': 'bg-red-50',
  }

  const renderNavItems = (items: NavItem[], group: string) => (
    <div key={group} className="mb-3">
      <p className={`text-[10px] font-bold uppercase tracking-widest px-3 mb-1.5 ${groupColors[group] || 'text-slate-400'}`}>
        {group}
      </p>
      {items.map((item) => (
        <button
          key={item.key}
          onClick={() => { handlePageNavigation(item.key); setSidebarOpen(false) }}
          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-150 ${
            currentPage === item.key
              ? `${groupBgColors[group] || 'bg-amber-50'} font-semibold ${groupColors[group] || 'text-amber-700'}`
              : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
          }`}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  )

  return (
    <div className="min-h-screen flex bg-slate-50">
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[70] h-1 overflow-hidden">
        <div
          className={`h-full bg-gradient-to-r from-amber-500 via-emerald-500 to-amber-500 shadow-[0_0_10px_rgba(16,185,129,0.55)] transition-all duration-500 ease-out ${
            headerLoading ? 'w-full opacity-100' : 'w-0 opacity-0'
          }`}
        />
      </div>

      {/* Sidebar - Desktop */}
      <aside className="hidden lg:flex lg:w-60 lg:flex-col bg-white border-r border-slate-200 shadow-sm fixed inset-y-0 left-0 z-30">
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-white border border-slate-200 shadow-sm overflow-hidden">
              <Image src="/brand-logo.png" alt="RRP Dream Inn logo" width={36} height={36} className="h-full w-full object-cover" />
            </div>
            <div>
              <h1 className="font-bold text-slate-800 text-sm leading-tight">RRP Dream Inn</h1>
              <p className="text-[11px] text-amber-600 font-medium">+ CloudView Restaurant</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-2.5 space-y-0.5">
          {Object.entries(groupedNav).map(([group, items]) => renderNavItems(items, group))}
        </nav>

        <div className="p-3 border-t border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center text-sm font-bold text-slate-600 shadow-sm overflow-hidden">
              {user?.avatar ? (
                <img src={user.avatar} alt={user.name || 'User avatar'} className="h-full w-full object-cover" />
              ) : (
                <span>{user?.name?.charAt(0) || 'U'}</span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-700 truncate">{user?.name}</p>
              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${roleBadgeColors[user?.role || ''] || ''}`}>
                {user?.role === 'HOTEL_STAFF' && <Hotel className="h-2.5 w-2.5 mr-0.5" />}
                {user?.role === 'RESTAURANT_STAFF' && <UtensilsCrossed className="h-2.5 w-2.5 mr-0.5" />}
                {user?.role?.replace('_', ' ')}
              </Badge>
            </div>
            <Button variant="ghost" size="icon" onClick={handleLogout} title="Logout" className="h-8 w-8">
              <LogOut className="h-4 w-4 text-slate-400" />
            </Button>
          </div>
        </div>
      </aside>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
          <aside className="fixed inset-y-0 left-0 w-72 bg-white shadow-2xl z-50 animate-in slide-in-from-left duration-200">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-lg bg-white border border-slate-200 overflow-hidden">
                  <Image src="/brand-logo.png" alt="RRP Dream Inn logo" width={28} height={28} className="h-full w-full object-cover" />
                </div>
                <span className="font-bold text-slate-800 text-sm">ERP System</span>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)} className="h-8 w-8">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <nav className="p-2.5 space-y-0.5 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 120px)' }}>
              {Object.entries(groupedNav).map(([group, items]) => renderNavItems(items, group))}
            </nav>
            <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-slate-100 bg-white">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-slate-200 flex items-center justify-center text-sm font-bold text-slate-600 overflow-hidden">
                  {user?.avatar ? (
                    <img src={user.avatar} alt={user.name || 'User avatar'} className="h-full w-full object-cover" />
                  ) : (
                    <span>{user?.name?.charAt(0) || 'U'}</span>
                  )}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-700">{user?.name}</p>
                  <p className="text-xs text-slate-400">{user?.role?.replace('_', ' ')}</p>
                </div>
                <Button variant="ghost" size="icon" onClick={handleLogout} className="h-8 w-8">
                  <LogOut className="h-4 w-4 text-slate-400" />
                </Button>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 lg:ml-60 flex flex-col min-h-screen">
        {/* Top Bar */}
        <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-slate-200 px-4 py-3 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
              <Menu className="h-5 w-5" />
            </Button>
            <div>
              <h2 className="text-lg font-semibold text-slate-800">
                {pageTitles[currentPage] || currentPage}
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden md:flex items-center rounded-md border bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
              {now.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative h-9 w-9">
                  <Bell className="h-4 w-4 text-slate-500" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-red-500 text-[10px] font-semibold text-white flex items-center justify-center">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[340px] p-0">
                <div className="px-3 py-2 border-b bg-slate-50/70">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-800">Notifications</p>
                    <button
                      type="button"
                      onClick={() => markAllReadMutation.mutate()}
                      disabled={markAllReadMutation.isPending || unreadCount === 0}
                      className="text-xs text-amber-700 hover:text-amber-800 disabled:text-slate-300"
                    >
                      Mark all read
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {unreadCount} unread
                  </p>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className="px-3 py-6 text-center text-xs text-slate-400">
                      No notifications yet
                    </div>
                  ) : (
                    notifications.map((n) => (
                      <div
                        key={n.id}
                        className={`px-3 py-2 border-b last:border-b-0 ${n.read ? 'bg-white' : 'bg-amber-50/40'}`}
                      >
                        <p className="text-sm font-medium text-slate-800">{n.title}</p>
                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{n.message}</p>
                        <p className="text-[10px] text-slate-400 mt-1">
                          {new Date(n.createdAt).toLocaleString()}
                        </p>
                      </div>
                    ))
                  )}
                </div>
                <div className="px-3 py-2 border-t bg-slate-50/60">
                  <button
                    type="button"
                    onClick={() => handlePageNavigation('orders')}
                    className="text-xs text-slate-600 hover:text-slate-800"
                  >
                    Go to orders
                  </button>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
            <Badge variant="outline" className={`hidden sm:flex text-xs items-center gap-1 ${roleBadgeColors[user?.role || ''] || ''}`}>
              {user?.role === 'ADMIN' && <LayoutDashboard className="h-3 w-3" />}
              {user?.role === 'HOTEL_STAFF' && <Hotel className="h-3 w-3" />}
              {user?.role === 'RESTAURANT_STAFF' && <UtensilsCrossed className="h-3 w-3" />}
              {user?.role?.replace('_', ' ')}
            </Badge>
          </div>
        </header>

        {/* Page Content */}
        <div key={`${currentPage}-${pageRefreshNonce}`} className="flex-1 p-4 md:p-6 overflow-auto">
          {renderPage()}
        </div>

        {/* Footer */}
        <footer className="border-t border-slate-200 bg-white px-4 py-3 text-center">
          <p className="text-xs text-slate-400">
            RRP Dream Inn + CloudView Restaurant ERP &copy; {new Date().getFullYear()}
          </p>
        </footer>
      </main>
    </div>
  )
}

function AppContent() {
  const { isAuthenticated } = useAuthStore()
  if (!isAuthenticated) {
    return <LoginForm />
  }
  return <ERPApp />
}

export default function Home() {
  return <AppContent />
}
