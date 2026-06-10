import type { ServerEmailVerifyResult } from './email-validation'
import { GMAIL_DOMAINS, getEmailDomain, normalizeEmail } from './email-validation'

type AbstractValidationResponse = {
  deliverability?: string
  is_smtp_valid?: { value?: boolean }
  is_mx_found?: { value?: boolean }
  error?: { message?: string }
}

type AbstractReputationResponse = {
  email_deliverability?: {
    status?: string
    status_detail?: string
    is_smtp_valid?: boolean
    is_mx_valid?: boolean
    is_format_valid?: boolean
  }
  error?: { message?: string; code?: string }
}

type HunterEmailResponse = {
  data?: {
    result?: string
    status?: string
    disposable?: boolean
  }
}

type CachedVerify = {
  result: ServerEmailVerifyResult
  expiresAt: number
}

const verifyCache = new Map<string, CachedVerify>()
const CACHE_TTL_MS = 5 * 60 * 1000
const ABSTRACT_MIN_INTERVAL_MS = 1100
let lastAbstractCallAt = 0

function gmailResult(
  mailboxExists: boolean,
  message: string
): ServerEmailVerifyResult {
  return {
    valid: mailboxExists,
    formatValid: true,
    domainValid: true,
    mailboxExists,
    provider: 'gmail',
    message,
  }
}

function fromCache(email: string): ServerEmailVerifyResult | null {
  const hit = verifyCache.get(normalizeEmail(email))
  if (!hit) return null
  if (hit.expiresAt < Date.now()) {
    verifyCache.delete(normalizeEmail(email))
    return null
  }
  return hit.result
}

function setCache(email: string, result: ServerEmailVerifyResult) {
  verifyCache.set(normalizeEmail(email), {
    result,
    expiresAt: Date.now() + CACHE_TTL_MS,
  })
}

async function throttleAbstractApi(): Promise<void> {
  const wait = ABSTRACT_MIN_INTERVAL_MS - (Date.now() - lastAbstractCallAt)
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait))
  }
  lastAbstractCallAt = Date.now()
}

export async function verifyEmailWithExternalApi(
  email: string
): Promise<ServerEmailVerifyResult | null> {
  const cached = fromCache(email)
  if (cached) return cached

  const abstractKey = process.env.ABSTRACT_EMAIL_API_KEY?.trim()
  if (abstractKey) {
    const reputation = await verifyWithAbstractReputation(email, abstractKey)
    if (reputation) {
      setCache(email, reputation)
      return reputation
    }
    const validation = await verifyWithAbstractValidation(email, abstractKey)
    if (validation) {
      setCache(email, validation)
      return validation
    }
  }

  const hunterKey = process.env.HUNTER_EMAIL_API_KEY?.trim()
  if (hunterKey) {
    const hunter = await verifyWithHunter(email, hunterKey)
    if (hunter) {
      setCache(email, hunter)
      return hunter
    }
  }

  return null
}

/** User's Abstract key is for Email Reputation API (not emailvalidation.abstractapi.com). */
async function verifyWithAbstractReputation(
  email: string,
  apiKey: string
): Promise<ServerEmailVerifyResult | null> {
  try {
    await throttleAbstractApi()

    const url = new URL('https://emailreputation.abstractapi.com/v1/')
    url.searchParams.set('api_key', apiKey)
    url.searchParams.set('email', normalizeEmail(email))

    const res = await fetch(url.toString(), { cache: 'no-store' })
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        console.warn('Abstract Email Reputation API: unauthorized — check ABSTRACT_EMAIL_API_KEY')
      } else if (res.status === 429) {
        console.warn('Abstract Email Reputation API: rate limit — wait 1 second between checks')
      }
      return null
    }

    const data = (await res.json()) as AbstractReputationResponse
    if (data.error) {
      console.warn('Abstract Email Reputation API error:', data.error.message)
      return null
    }

    const deliverability = data.email_deliverability
    if (!deliverability) return null

    const domain = getEmailDomain(email)
    const isGmail = domain ? GMAIL_DOMAINS.has(domain) : false
    const status = deliverability.status?.toLowerCase()

    if (status === 'undeliverable' || deliverability.is_smtp_valid === false) {
      return {
        valid: false,
        formatValid: deliverability.is_format_valid !== false,
        domainValid: deliverability.is_mx_valid !== false,
        mailboxExists: false,
        provider: isGmail ? 'gmail' : domain,
        message: isGmail
          ? 'This Gmail address does not exist'
          : 'This email address does not exist',
      }
    }

    if (status === 'deliverable' || deliverability.is_smtp_valid === true) {
      return {
        valid: true,
        formatValid: true,
        domainValid: true,
        mailboxExists: true,
        provider: isGmail ? 'gmail' : domain,
        message: isGmail
          ? 'Gmail account verified — mailbox exists'
          : 'Email verified — mailbox exists',
      }
    }

    return null
  } catch {
    return null
  }
}

async function verifyWithAbstractValidation(
  email: string,
  apiKey: string
): Promise<ServerEmailVerifyResult | null> {
  try {
    await throttleAbstractApi()

    const url = new URL('https://emailvalidation.abstractapi.com/v1/')
    url.searchParams.set('api_key', apiKey)
    url.searchParams.set('email', normalizeEmail(email))

    const res = await fetch(url.toString(), { cache: 'no-store' })
    if (!res.ok) return null

    const data = (await res.json()) as AbstractValidationResponse
    if (data.error) return null

    const domain = getEmailDomain(email)
    const isGmail = domain ? GMAIL_DOMAINS.has(domain) : false
    const smtpValid = data.is_smtp_valid?.value
    const deliverability = data.deliverability?.toUpperCase()

    if (deliverability === 'UNDELIVERABLE' || smtpValid === false) {
      return {
        valid: false,
        formatValid: true,
        domainValid: data.is_mx_found?.value !== false,
        mailboxExists: false,
        provider: isGmail ? 'gmail' : domain,
        message: isGmail
          ? 'This Gmail address does not exist'
          : 'This email address does not exist',
      }
    }

    if (deliverability === 'DELIVERABLE' || smtpValid === true) {
      return {
        valid: true,
        formatValid: true,
        domainValid: true,
        mailboxExists: true,
        provider: isGmail ? 'gmail' : domain,
        message: isGmail
          ? 'Gmail account verified — mailbox exists'
          : 'Email verified — mailbox exists',
      }
    }

    return null
  } catch {
    return null
  }
}

async function verifyWithHunter(
  email: string,
  apiKey: string
): Promise<ServerEmailVerifyResult | null> {
  try {
    const url = new URL('https://api.hunter.io/v2/email-verifier')
    url.searchParams.set('api_key', apiKey)
    url.searchParams.set('email', normalizeEmail(email))

    const res = await fetch(url.toString(), { cache: 'no-store' })
    if (!res.ok) return null

    const body = (await res.json()) as HunterEmailResponse
    const data = body.data
    if (!data) return null

    const domain = getEmailDomain(email)
    const isGmail = domain ? GMAIL_DOMAINS.has(domain) : false

    if (data.disposable) {
      return {
        valid: false,
        formatValid: true,
        domainValid: true,
        mailboxExists: false,
        provider: isGmail ? 'gmail' : domain,
        message: 'Disposable email addresses are not allowed',
      }
    }

    if (data.result === 'undeliverable' || data.status === 'invalid') {
      return gmailResult(
        false,
        isGmail ? 'This Gmail address does not exist' : 'This email address does not exist'
      )
    }

    if (data.result === 'deliverable' && data.status === 'valid') {
      return gmailResult(
        true,
        isGmail ? 'Gmail account verified — mailbox exists' : 'Email verified — mailbox exists'
      )
    }

    return null
  } catch {
    return null
  }
}

export function isExternalEmailVerifierConfigured(): boolean {
  return Boolean(
    process.env.ABSTRACT_EMAIL_API_KEY?.trim() || process.env.HUNTER_EMAIL_API_KEY?.trim()
  )
}
