'use client'

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useAuthStore } from '@/lib/auth-store'
import { useAuthHydration } from '@/hooks/use-auth-hydration'
import { isSessionExpired } from '@/lib/session'
import { performLogout } from '@/lib/session-logout'

const ACTIVITY_EVENTS = [
  'mousedown',
  'mousemove',
  'keydown',
  'scroll',
  'touchstart',
  'click',
  'focusin',
] as const

function redirectToLogin() {
  if (typeof window === 'undefined') return
  window.location.replace('/')
}

export function useSessionTimeout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const hasHydrated = useAuthHydration()
  const lastActivityAt = useAuthStore((s) => s.lastActivityAt)
  const touchActivity = useAuthStore((s) => s.touchActivity)
  const expiredHandledRef = useRef(false)

  const expireSession = () => {
    if (expiredHandledRef.current) return
    expiredHandledRef.current = true
    const message = performLogout('idle')
    toast.warning(message)
    redirectToLogin()
  }

  useEffect(() => {
    if (!hasHydrated || !isAuthenticated) {
      expiredHandledRef.current = false
      return
    }

    expiredHandledRef.current = false
    touchActivity()

    const throttleMs = 5000
    let lastTouch = 0
    const throttledActivity = () => {
      const now = Date.now()
      if (now - lastTouch < throttleMs) return
      lastTouch = now
      touchActivity()
    }

    ACTIVITY_EVENTS.forEach((event) => {
      window.addEventListener(event, throttledActivity, { passive: true })
    })

    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      const state = useAuthStore.getState()
      if (isSessionExpired(state.lastActivityAt)) expireSession()
    }
    document.addEventListener('visibilitychange', onVisibility)

    const interval = window.setInterval(() => {
      const state = useAuthStore.getState()
      if (!state.isAuthenticated) return
      if (isSessionExpired(state.lastActivityAt)) expireSession()
    }, 15_000)

    return () => {
      ACTIVITY_EVENTS.forEach((event) => {
        window.removeEventListener(event, throttledActivity)
      })
      document.removeEventListener('visibilitychange', onVisibility)
      window.clearInterval(interval)
    }
  }, [hasHydrated, isAuthenticated, touchActivity])

  useEffect(() => {
    if (!hasHydrated || !isAuthenticated) return
    if (isSessionExpired(lastActivityAt)) expireSession()
  }, [hasHydrated, isAuthenticated, lastActivityAt])
}
