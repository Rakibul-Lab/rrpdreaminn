const API_BASE = '/api';

import { useAuthStore } from '@/lib/auth-store';
import { isSessionExpired } from '@/lib/session';
import { performLogout } from '@/lib/session-logout';

interface FetchOptions extends RequestInit {
  params?: Record<string, string>;
}

let sessionRedirectPending = false;

function redirectToLoginAfterExpiry(reason: 'idle' | 'unauthorized') {
  if (sessionRedirectPending || typeof window === 'undefined') return;
  sessionRedirectPending = true;
  performLogout(reason);
  window.location.replace('/');
}

export function getAuthHeaders(includeJson = true): HeadersInit {
  if (typeof window === 'undefined') {
    return includeJson ? { 'Content-Type': 'application/json' } : {};
  }

  const stored = localStorage.getItem('erp-auth-storage');
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      const { user, token, lastActivityAt } = parsed.state || {};
      return {
        ...(includeJson ? { 'Content-Type': 'application/json' } : {}),
        'x-user-id': user?.id || '',
        'x-user-email': user?.email || '',
        'x-user-name': user?.name || '',
        'x-user-role': user?.role || '',
        'x-token': token || '',
        'x-last-activity': lastActivityAt ? String(lastActivityAt) : '',
      };
    } catch {
      // ignore parse errors
    }
  }
  return includeJson ? { 'Content-Type': 'application/json' } : {};
}

type ApiErrorBody = { success?: boolean; error?: string; message?: string; code?: string }

async function parseJsonResponse<T>(res: Response, path: string): Promise<T> {
  let body: ApiErrorBody = {}
  try {
    body = (await res.json()) as ApiErrorBody
  } catch {
    if (!res.ok) {
      throw new Error(res.statusText || `Request failed (${res.status})`)
    }
    throw new Error('Invalid server response')
  }

  if (res.status === 401 && !path.includes('/auth/login')) {
    if (body.code === 'SESSION_EXPIRED' || res.status === 401) {
      redirectToLoginAfterExpiry('unauthorized')
    }
  }

  if (!res.ok) {
    throw new Error(body.error || body.message || res.statusText || `Request failed (${res.status})`)
  }

  return body as T
}

export class ApiClient {
  private getHeaders(): HeadersInit {
    return getAuthHeaders(true);
  }

  private ensureSession(path: string): void {
    if (typeof window === 'undefined') return;
    if (path.includes('/auth/login') || path.includes('/auth/seed')) return;

    const state = useAuthStore.getState();
    if (!state.isAuthenticated) return;

    if (isSessionExpired(state.lastActivityAt)) {
      redirectToLoginAfterExpiry('idle');
      throw new Error('Session expired');
    }
  }

  async get<T>(path: string, options?: FetchOptions): Promise<T> {
    this.ensureSession(path);
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'GET',
      headers: this.getHeaders(),
      ...options,
    });
    return parseJsonResponse<T>(res, path);
  }

  async post<T>(path: string, body?: unknown, options?: FetchOptions): Promise<T> {
    this.ensureSession(path);
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: body ? JSON.stringify(body) : undefined,
      ...options,
    });
    return parseJsonResponse<T>(res, path);
  }

  async put<T>(path: string, body?: unknown, options?: FetchOptions): Promise<T> {
    this.ensureSession(path);
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: body ? JSON.stringify(body) : undefined,
      ...options,
    });
    return parseJsonResponse<T>(res, path);
  }

  async patch<T>(path: string, body?: unknown, options?: FetchOptions): Promise<T> {
    this.ensureSession(path);
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: body ? JSON.stringify(body) : undefined,
      ...options,
    });
    return parseJsonResponse<T>(res, path);
  }

  async delete<T>(path: string, options?: FetchOptions): Promise<T> {
    this.ensureSession(path);
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
      ...options,
    });
    return parseJsonResponse<T>(res, path);
  }
}

export const api = new ApiClient();
