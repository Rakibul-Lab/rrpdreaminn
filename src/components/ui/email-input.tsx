'use client'

import * as React from 'react'
import { AlertCircle, CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  type EmailValidationResult,
  useEmailValidation,
} from '@/hooks/use-email-validation'

export type EmailInputProps = Omit<React.ComponentProps<typeof Input>, 'type' | 'onChange' | 'value'> & {
  value: string
  onChange: (value: string) => void
  optional?: boolean
  mode?: 'full' | 'format-only'
  showMessage?: boolean
  onValidationChange?: (
    result: EmailValidationResult & {
      isBlocking: boolean
      verificationToken?: string | null
    }
  ) => void
}

export function EmailInput({
  value,
  onChange,
  optional = false,
  mode = 'full',
  showMessage = true,
  onValidationChange,
  className,
  id,
  ...props
}: EmailInputProps) {
  const validation = useEmailValidation({ email: value, optional, mode })
  const onValidationChangeRef = React.useRef(onValidationChange)
  onValidationChangeRef.current = onValidationChange

  React.useEffect(() => {
    onValidationChangeRef.current?.({
      ...validation,
      isBlocking: validation.isBlocking,
      verificationToken: validation.verificationToken,
    })
  }, [
    validation.valid,
    validation.status,
    validation.message,
    validation.suggestion,
    validation.isBlocking,
    validation.formatValid,
    validation.domainValid,
    validation.mailboxExists,
    validation.needsOtp,
    validation.verificationToken,
    validation.provider,
  ])

  const statusIcon = (() => {
    if (optional && !value.trim()) return null
    switch (validation.status) {
      case 'validating':
        return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      case 'valid':
        return <CheckCircle2 className="h-4 w-4 text-emerald-600" />
      case 'invalid':
        return <XCircle className="h-4 w-4 text-destructive" />
      case 'warning':
        return <AlertCircle className="h-4 w-4 text-amber-600" />
      default:
        return null
    }
  })()

  const showFeedback =
    showMessage &&
    validation.message &&
    !(optional && !value.trim()) &&
    validation.status !== 'idle'

  const showOtp =
    mode === 'full' &&
    !(optional && !value.trim()) &&
    validation.needsOtp &&
    validation.status !== 'valid' &&
    validation.mailboxExists !== true

  const applySuggestion = () => {
    if (validation.suggestion) onChange(validation.suggestion)
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Input
          id={id}
          type="email"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={validation.isBlocking || undefined}
          className={cn(statusIcon && 'pr-9', className)}
          autoComplete="email"
          {...props}
        />
        {statusIcon && (
          <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
            {statusIcon}
          </div>
        )}
      </div>

      {showFeedback && (
        <p
          className={cn(
            'text-xs',
            validation.status === 'valid' && 'text-emerald-600',
            validation.status === 'invalid' && 'text-destructive',
            validation.status === 'warning' && 'text-amber-700',
            validation.status === 'validating' && 'text-muted-foreground'
          )}
        >
          {validation.message}
          {validation.suggestion && validation.status !== 'valid' && (
            <>
              {' '}
              <button
                type="button"
                className="underline font-medium hover:text-foreground"
                onClick={applySuggestion}
              >
                Use {validation.suggestion}
              </button>
            </>
          )}
        </p>
      )}

      {showOtp && (
        <div className="rounded-md border border-amber-200 bg-amber-50/80 p-3 space-y-2">
          <p className="text-xs text-amber-900">
            Gmail and similar providers block automatic checks. Send a code to prove this inbox exists.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              disabled={validation.sendingOtp}
              onClick={() => void validation.sendOtp()}
            >
              {validation.sendingOtp ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Sending…
                </>
              ) : validation.otpSent ? (
                'Resend code'
              ) : (
                'Send verification code'
              )}
            </Button>
          </div>
          {validation.otpSent && (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                inputMode="numeric"
                maxLength={6}
                placeholder="6-digit code"
                value={validation.otpCode}
                onChange={(e) =>
                  validation.setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                }
                className="h-8 w-32 font-mono"
              />
              <Button
                type="button"
                size="sm"
                className="h-8 bg-amber-600 hover:bg-amber-700 text-white"
                disabled={validation.confirmingOtp || validation.otpCode.length !== 6}
                onClick={() => void validation.confirmOtp()}
              >
                {validation.confirmingOtp ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  'Verify'
                )}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
