import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthState {
  user: {
    id: string;
    email: string;
    name: string;
    avatar?: string | null;
    role: 'ADMIN' | 'HOTEL_STAFF' | 'RESTAURANT_STAFF';
  } | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (user: AuthState['user'], token: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      login: (user, token) => set({ user, token, isAuthenticated: true }),
      logout: () => set({ user: null, token: null, isAuthenticated: false }),
    }),
    {
      name: 'erp-auth-storage',
    }
  )
);

export function canAccessHotel(role: string | undefined): boolean {
  return role === 'ADMIN' || role === 'HOTEL_STAFF';
}

export function canAccessRestaurant(role: string | undefined): boolean {
  return role === 'ADMIN' || role === 'RESTAURANT_STAFF';
}

export function canAccessAdmin(role: string | undefined): boolean {
  return role === 'ADMIN';
}
