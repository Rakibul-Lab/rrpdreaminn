'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api-client'
import {
  type EmailValidationResult,
  type EmailValidationStatus,
  resolveOptionalEmailValidation,
  validateEmailFormat,
} from '@/lib/email-validation'

type UseEmailValidationOptions = {
  email: string
  optional?: boolean
  mode?: 'full' | 'format-only'
  debounceMs?: number
}

type ApiVerifyData = {
  valid: boolean
  formatValid: boolean
  domainValid: boolean
  mailboxExists: boolean | null
  needsOtp?: boolean
  verificationToken?: string
  message: string
  suggestion?: string
  provider?: string | null
}

const IDLE: EmailValidationResult = { valid: true, status: 'idle' }

function mapApiToResult(data: ApiVerifyData): EmailValidationResult {
  let status: EmailValidationStatus = 'invalid'
  if (data.mailboxExists === true || data.verificationToken) status = 'valid'
  else if (data.mailboxExists === false) status = 'invalid'
  else if (data.needsOtp) status = 'warning'
  else if (data.suggestion) status = 'warning'
  else status = 'invalid'

  return {
    valid: data.mailboxExists === true,
    status,
    message: data.message,
    suggestion: data.suggestion,
    formatValid: data.formatValid,
    domainValid: data.domainValid,
    mailboxExists: data.mailboxExists,
    needsOtp: data.needsOtp,
    verificationToken: data.verificationToken ?? null,
    provider: data.provider,
  }
}

export function useEmailValidation({
  email,
  optional = false,
  mode = 'full',
  debounceMs = 1200,
}: UseEmailValidationOptions) {
  const [result, setResult] = useState<EmailValidationResult>(IDLE)
  const [verificationToken, setVerificationToken] = useState<string | null>(null)
  const [otpCode, setOtpCode] = useState('')
  const [sendingOtp, setSendingOtp] = useState(false)
  const [confirmingOtp, setConfirmingOtp] = useState(false)
  const [otpSent, setOtpSent] = useState(false)
  const requestId = useRef(0)

  useEffect(() => {
    setVerificationToken(null)
    setOtpCode('')
    setOtpSent(false)
  }, [email])

  const runValidation = useCallback(async () => {
    const trimmed = email.trim()
    if (optional && !trimmed) {
      setResult(IDLE)
      return
    }

    const format = validateEmailFormat(trimmed)
    if (!format.valid) {
      setResult({
        valid: false,
        status: 'invalid',
        message: format.message,
        formatValid: false,
        domainValid: false,
        mailboxExists: null,
      })
      return
    }

    if (mode === 'format-only') {
      setResult({
        valid: true,
        status: 'valid',
        message: 'Valid email format',
        formatValid: true,
        domainValid: true,
        mailboxExists: null,
      })
      return
    }

    const currentRequest = ++requestId.current
    setResult((prev) => ({
      ...prev,
      status: 'validating',
      valid: false,
      message: 'Checking if mailbox exists…',
    }))

    try {
      const res = await api.post<{
        success: boolean
        data?: ApiVerifyData
        error?: string
      }>('/validate-email', { email: trimmed })

      if (currentRequest !== requestId.current) return

      const data = res.data
      if (!res.success || !data) {
        setResult({
          valid: false,
          status: 'warning',
          message: 'Could not verify mailbox',
          formatValid: true,
          domainValid: true,
          mailboxExists: null,
          needsOtp: true,
        })
        return
      }

      if (data.verificationToken) {
        setVerificationToken(data.verificationToken)
      }

      const next = mapApiToResult(data)
      setResult(resolveOptionalEmailValidation(email, next, optional))
    } catch {
      if (currentRequest !== requestId.current) return
      setResult({
        valid: false,
        status: 'warning',
        message: 'Could not verify mailbox',
        formatValid: true,
        domainValid: true,
        mailboxExists: null,
        needsOtp: true,
      })
    }
  }, [email, mode, optional])

  useEffect(() => {
    const trimmed = email.trim()
    if (optional && !trimmed) {
      setResult(IDLE)
      return
    }

    if (trimmed.length < 5 || !trimmed.includes('@')) {
      setResult({
        valid: false,
        status: 'idle',
        message: trimmed ? 'Keep typing…' : undefined,
      })
      return
    }

    const timer = window.setTimeout(() => {
      void runValidation()
    }, debounceMs)

    return () => window.clearTimeout(timer)
  }, [email, optional, debounceMs, runValidation])

  const sendOtp = useCallback(async () => {
    const trimmed = email.trim()
    if (!trimmed) return
    setSendingOtp(true)
    try {
      const res = await api.post<{ success: boolean; error?: string; message?: string }>(
        '/verify-email/send-otp',
        { email: trimmed }
      )
      if (res.success) {
        setOtpSent(true)
        setResult((prev) => ({
          ...prev,
          status: 'warning',
          message: 'Code sent — check your inbox',
          needsOtp: true,
        }))
      } else {
        setResult((prev) => ({
          ...prev,
          status: 'warning',
          message: res.error || 'Failed to send code',
          needsOtp: true,
        }))
      }
    } catch {
      setResult((prev) => ({
        ...prev,
        status: 'warning',
        message: 'Failed to send verification code',
        needsOtp: true,
      }))
    } finally {
      setSendingOtp(false)
    }
  }, [email])

  const confirmOtp = useCallback(async () => {
    const trimmed = email.trim()
    if (!trimmed || otpCode.trim().length !== 6) return
    setConfirmingOtp(true)
    try {
      const res = await api.post<{
        success: boolean
        error?: string
        data?: { verificationToken?: string }
        message?: string
      }>('/verify-email/confirm-otp', { email: trimmed, code: otpCode.trim() })

      if (res.success && res.data?.verificationToken) {
        setVerificationToken(res.data.verificationToken)
        setResult({
          valid: true,
          status: 'valid',
          message: res.message || 'Email verified — mailbox confirmed',
          formatValid: true,
          domainValid: true,
          mailboxExists: true,
          needsOtp: false,
          verificationToken: res.data.verificationToken,
        })
      } else {
        setResult((prev) => ({
          ...prev,
          status: 'warning',
          message: res.error || 'Incorrect code',
          needsOtp: true,
        }))
      }
    } catch {
      setResult((prev) => ({
        ...prev,
        status: 'warning',
        message: 'Failed to verify code',
        needsOtp: true,
      }))
    } finally {
      setConfirmingOtp(false)
    }
  }, [email, otpCode])

  const resolved = resolveOptionalEmailValidation(email, result, optional)
  const mailboxConfirmed =
    resolved.mailboxExists === true || Boolean(verificationToken || resolved.verificationToken)
  const isBlocking =
    mode === 'format-only'
      ? !resolved.valid && !(optional && !email.trim())
      : !(optional && !email.trim()) && !mailboxConfirmed && resolved.status !== 'idle'

  return {
    ...resolved,
    isBlocking,
    verificationToken: verificationToken || resolved.verificationToken || null,
    otpCode,
    setOtpCode,
    otpSent,
    sendingOtp,
    confirmingOtp,
    sendOtp,
    confirmOtp,
    revalidate: runValidation,
  }
}

export type { EmailValidationResult, EmailValidationStatus }
