import { z } from 'zod'

export type EmailValidationStatus = 'idle' | 'validating' | 'valid' | 'invalid' | 'warning'

export type EmailValidationResult = {
  valid: boolean
  status: EmailValidationStatus
  message?: string
  suggestion?: string
  formatValid?: boolean
  domainValid?: boolean
  mailboxExists?: boolean | null
  needsOtp?: boolean
  verificationToken?: string | null
  provider?: string | null
}

export type ServerEmailVerifyResult = {
  valid: boolean
  formatValid: boolean
  domainValid: boolean
  mailboxExists: boolean | null
  needsOtp?: boolean
  message: string
  suggestion?: string
  provider?: string | null
}

const emailSchema = z.string().email()

/** Client-safe format check */
export function validateEmailFormat(email: string): { valid: boolean; message?: string } {
  const trimmed = email.trim()
  if (!trimmed) {
    return { valid: false, message: 'Email is required' }
  }
  const parsed = emailSchema.safeParse(trimmed)
  if (!parsed.success) {
    return { valid: false, message: 'Enter a valid email address' }
  }
  return { valid: true }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function getEmailDomain(email: string): string | null {
  const trimmed = normalizeEmail(email)
  const at = trimmed.lastIndexOf('@')
  if (at <= 0 || at === trimmed.length - 1) return null
  return trimmed.slice(at + 1)
}

export const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com'])

export function isGmailAddress(email: string): boolean {
  const domain = getEmailDomain(email)
  return domain ? GMAIL_DOMAINS.has(domain) : false
}

export function resolveOptionalEmailValidation(
  email: string,
  result: EmailValidationResult,
  optional: boolean
): EmailValidationResult {
  if (optional && !email.trim()) {
    return { valid: true, status: 'idle' }
  }
  return result
}
