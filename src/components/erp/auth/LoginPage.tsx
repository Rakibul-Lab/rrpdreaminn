'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmailInput } from '@/components/ui/email-input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Building2, Cloud, Eye, EyeOff, Loader2, Database, KeyRound, Hotel, UtensilsCrossed } from 'lucide-react';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { toast } from 'sonner';
import { AppDevelopedByFooter } from '@/components/AppDevelopedByFooter';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [emailBlocking, setEmailBlocking] = useState(false);
  const login = useAuthStore((s) => s.login);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error('Please enter email and password');
      return;
    }
    if (emailBlocking) {
      toast.error('Enter a valid email address');
      return;
    }

    setLoading(true);
    try {
      const res = await api.post<{ success: boolean; data?: { user: { id: string; email: string; name: string; avatar?: string | null; role: 'ADMIN' | 'HOTEL_STAFF' | 'RESTAURANT_STAFF' }; token: string }; error?: string }>('/auth/login', { email, password });
      if (res.success && res.data) {
        login(res.data.user, res.data.token);
        toast.success(`Welcome back, ${res.data.user.name}!`);
      } else {
        toast.error(res.error || 'Invalid credentials');
      }
    } catch {
      toast.error('Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const res = await api.post<{ success: boolean; message?: string; error?: string }>('/auth/seed');
      if (res.success) {
        toast.success('Database seeded successfully! You can now login with demo credentials.');
      } else {
        toast.error(res.error || 'Failed to seed database');
      }
    } catch {
      toast.error('Failed to seed database. Please try again.');
    } finally {
      setSeeding(false);
    }
  };

  const quickLogin = (demoEmail: string, demoPassword: string) => {
    setEmail(demoEmail);
    setPassword(demoPassword);
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-amber-50 via-orange-50 to-emerald-50">
      <div className="relative flex-1 flex items-center justify-center p-4">
      {/* Background decorations */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-amber-200/30 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-emerald-200/30 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-orange-100/20 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <Card className="shadow-xl border-0 bg-card/80 backdrop-blur-sm">
          <CardContent className="p-6 pt-6">
            <div className="text-center mb-6 pb-6 border-b border-border">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white shadow-lg mb-4 border border-border overflow-hidden">
                <Image
                  src="/brand-logo.png"
                  alt="RRP Dream Inn logo"
                  width={64}
                  height={64}
                  className="h-full w-full object-cover"
                />
              </div>
              <h1 className="text-2xl font-bold text-foreground">ERP System</h1>
              <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
                <Badge className="bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100">
                  <Hotel className="h-3 w-3 mr-1" />
                  RRP Dream Inn
                </Badge>
                <span className="text-muted-foreground">+</span>
                <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">
                  <UtensilsCrossed className="h-3 w-3 mr-1" />
                  CloudView
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-2">Hotel & Restaurant ERP System</p>
            </div>

            <CardHeader className="p-0 pb-4">
              <CardTitle className="text-xl flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-amber-600" />
                Sign In
              </CardTitle>
              <CardDescription>Enter your credentials to access the system</CardDescription>
            </CardHeader>

            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <EmailInput
                  id="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={setEmail}
                  mode="format-only"
                  onValidationChange={(result) => setEmailBlocking(result.isBlocking)}
                  disabled={loading}
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                    className="h-11 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <Button
                type="submit"
                className="w-full h-11 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-700 hover:to-amber-800 text-white shadow-md"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  'Sign In'
                )}
              </Button>
            </form>

            <Separator className="my-6" />

            {/* Demo Credentials */}
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Demo Credentials</p>
              <div className="grid gap-2">
                <button
                  type="button"
                  onClick={() => quickLogin('admin@erp.com', 'admin123')}
                  className="flex items-center gap-3 p-2.5 rounded-lg border border-amber-200 bg-amber-50/50 hover:bg-amber-100/70 transition-colors text-left"
                >
                  <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 text-xs font-bold">A</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-amber-900">Admin</p>
                    <p className="text-xs text-amber-600 truncate">admin@erp.com / admin123</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => quickLogin('hotel@erp.com', 'hotel123')}
                  className="flex items-center gap-3 p-2.5 rounded-lg border border-emerald-200 bg-emerald-50/50 hover:bg-emerald-100/70 transition-colors text-left"
                >
                  <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 text-xs font-bold">H</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-emerald-900">Hotel Staff</p>
                    <p className="text-xs text-emerald-600 truncate">hotel@erp.com / hotel123</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => quickLogin('restaurant@erp.com', 'rest123')}
                  className="flex items-center gap-3 p-2.5 rounded-lg border border-orange-200 bg-orange-50/50 hover:bg-orange-100/70 transition-colors text-left"
                >
                  <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center text-orange-700 text-xs font-bold">R</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-orange-900">Restaurant Staff</p>
                    <p className="text-xs text-orange-600 truncate">restaurant@erp.com / rest123</p>
                  </div>
                </button>
              </div>
            </div>

            <Separator className="my-6" />

            {/* Seed Button */}
            <Button
              variant="outline"
              className="w-full border-dashed"
              onClick={handleSeed}
              disabled={seeding}
            >
              {seeding ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Seeding Database...
                </>
              ) : (
                <>
                  <Database className="w-4 h-4 mr-2" />
                  Seed Database (First Time Setup)
                </>
              )}
            </Button>
          </CardContent>
        </Card>

      </div>
      </div>
      <AppDevelopedByFooter showProductLine />
    </div>
  );
}
