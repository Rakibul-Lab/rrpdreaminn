import dns from 'dns/promises'
import net from 'net'
import {
  GMAIL_DOMAINS,
  getEmailDomain,
  normalizeEmail,
  validateEmailFormat,
  type ServerEmailVerifyResult,
} from './email-validation'
import {
  isExternalEmailVerifierConfigured,
  verifyEmailWithExternalApi,
} from './email-verify-external'
import { isSmtpConfigured } from './mail'

const DOMAIN_TYPOS: Record<string, string> = {
  'gmial.com': 'gmail.com',
  'gmal.com': 'gmail.com',
  'gamil.com': 'gmail.com',
  'gnail.com': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gmail.con': 'gmail.com',
  'gmail.cm': 'gmail.com',
  'googlemail.co': 'googlemail.com',
  'hotmial.com': 'hotmail.com',
  'hotmal.com': 'hotmail.com',
  'outlok.com': 'outlook.com',
  'outllok.com': 'outlook.com',
  'yaho.com': 'yahoo.com',
  'yahooo.com': 'yahoo.com',
  'yahho.com': 'yahoo.com',
}

const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com',
  'guerrillamail.com',
  'tempmail.com',
  '10minutemail.com',
  'throwaway.email',
  'yopmail.com',
])

const SMTP_SKIP_DOMAINS = new Set([
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'proton.me',
  'protonmail.com',
])

const KNOWN_MAIL_DOMAINS = new Set([
  ...GMAIL_DOMAINS,
  ...SMTP_SKIP_DOMAINS,
  'yahoo.co.uk',
  'yahoo.co.in',
  'msn.com',
  'me.com',
  'mac.com',
  'aol.com',
  'zoho.com',
  'yandex.com',
  'gmx.com',
  'mail.com',
])

const GMAIL_MX_HOSTS = [
  'gmail-smtp-in.l.google.com',
  'alt1.gmail-smtp-in.l.google.com',
  'alt2.gmail-smtp-in.l.google.com',
]

const SMTP_TIMEOUT_MS = 8000

function getTypoSuggestion(domain: string): string | undefined {
  const lower = domain.toLowerCase()
  const corrected = DOMAIN_TYPOS[lower]
  if (!corrected) return undefined
  return corrected
}

type DomainCheckResult = {
  valid: boolean
  dnsChecked: boolean
}

async function domainHasMx(domain: string): Promise<DomainCheckResult> {
  const lower = domain.toLowerCase()
  try {
    const records = await dns.resolveMx(lower)
    return { valid: records.length > 0, dnsChecked: true }
  } catch {
    try {
      await dns.resolve(lower, 'A')
      return { valid: true, dnsChecked: true }
    } catch {
      if (KNOWN_MAIL_DOMAINS.has(lower)) {
        return { valid: true, dnsChecked: false }
      }
      return { valid: false, dnsChecked: true }
    }
  }
}

async function resolveMxHost(domain: string): Promise<string> {
  if (GMAIL_DOMAINS.has(domain)) {
    return GMAIL_MX_HOSTS[0]
  }
  try {
    const mx = await dns.resolveMx(domain)
    if (mx.length > 0) {
      return mx.sort((a, b) => a.priority - b.priority)[0].hostname
    }
  } catch {
    // fall through
  }
  return domain
}

function verifyMailboxSmtp(email: string, mxHost: string): Promise<boolean | null> {
  return new Promise((resolve) => {
    const socket = net.createConnection(25, mxHost)
    let step = 0
    let settled = false
    let buffer = ''

    const finish = (value: boolean | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(value)
    }

    const timer = setTimeout(() => finish(null), SMTP_TIMEOUT_MS)

    const commands = [
      'EHLO dreaminn.local\r\n',
      'MAIL FROM:<verify@dreaminn.local>\r\n',
      `RCPT TO:<${email}>\r\n`,
      'QUIT\r\n',
    ]

    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split(/\r?\n/).filter(Boolean)
      const lastLine = lines[lines.length - 1] ?? ''
      if (lastLine.length < 3 || lastLine[3] === '-') return

      const code = Number.parseInt(lastLine.slice(0, 3), 10)
      if (Number.isNaN(code)) {
        finish(null)
        return
      }

      if (step === 2) {
        if (code === 250) finish(true)
        else if (code === 550 || code === 551 || code === 552 || code === 553) finish(false)
        else finish(null)
        return
      }

      if (code >= 200 && code < 400) {
        if (step < commands.length) {
          socket.write(commands[step])
          step += 1
        }
      } else {
        finish(null)
      }
    })

    socket.on('error', () => finish(null))
    socket.on('timeout', () => finish(null))
    socket.setTimeout(SMTP_TIMEOUT_MS)
  })
}

async function verifyGmailSmtp(email: string): Promise<boolean | null> {
  for (const host of GMAIL_MX_HOSTS) {
    const result = await verifyMailboxSmtp(email, host)
    if (result !== null) return result
  }
  return null
}

function inconclusiveResult(
  domain: string,
  isGmail: boolean,
  apiConfigured: boolean
): ServerEmailVerifyResult {
  const canOtp = isSmtpConfigured()

  if (canOtp) {
    return {
      valid: false,
      formatValid: true,
      domainValid: true,
      mailboxExists: null,
      needsOtp: true,
      provider: isGmail ? 'gmail' : domain,
      message: 'Send a verification code to confirm this email exists',
    }
  }

  if (apiConfigured) {
    return {
      valid: false,
      formatValid: true,
      domainValid: true,
      mailboxExists: null,
      needsOtp: false,
      provider: isGmail ? 'gmail' : domain,
      message:
        'Mailbox check failed — wait a moment and try again (free API allows 1 check per second)',
    }
  }

  return {
    valid: false,
    formatValid: true,
    domainValid: true,
    mailboxExists: null,
    needsOtp: false,
    provider: isGmail ? 'gmail' : domain,
    message:
      'Mailbox could not be verified — add ABSTRACT_EMAIL_API_KEY or configure SMTP for code verification',
  }
}

export async function verifyEmailOnServer(email: string): Promise<ServerEmailVerifyResult> {
  const trimmed = email.trim()
  const format = validateEmailFormat(trimmed)
  if (!format.valid) {
    return {
      valid: false,
      formatValid: false,
      domainValid: false,
      mailboxExists: null,
      message: format.message || 'Enter a valid email address',
    }
  }

  const normalized = normalizeEmail(trimmed)
  const domain = getEmailDomain(normalized)
  if (!domain) {
    return {
      valid: false,
      formatValid: false,
      domainValid: false,
      mailboxExists: null,
      message: 'Enter a valid email address',
    }
  }

  const typo = getTypoSuggestion(domain)
  if (typo) {
    const local = normalized.split('@')[0]
    return {
      valid: false,
      formatValid: true,
      domainValid: false,
      mailboxExists: null,
      message: `Did you mean ${local}@${typo}?`,
      suggestion: `${local}@${typo}`,
    }
  }

  if (DISPOSABLE_DOMAINS.has(domain)) {
    return {
      valid: false,
      formatValid: true,
      domainValid: false,
      mailboxExists: false,
      message: 'Disposable email addresses are not allowed',
    }
  }

  const domainCheck = await domainHasMx(domain)
  if (!domainCheck.valid) {
    return {
      valid: false,
      formatValid: true,
      domainValid: false,
      mailboxExists: false,
      message: 'This email domain cannot receive mail',
    }
  }

  const isGmail = GMAIL_DOMAINS.has(domain)
  const provider = isGmail ? 'gmail' : domain

  const external = await verifyEmailWithExternalApi(normalized)
  if (external) {
    return external
  }

  let mailboxExists: boolean | null = null
  if (isGmail) {
    // Gmail returns 250 for almost every address to block enumeration — only 550 is trustworthy.
    mailboxExists = await verifyGmailSmtp(normalized)
    if (mailboxExists === true) {
      mailboxExists = null
    }
  } else if (!SMTP_SKIP_DOMAINS.has(domain) && domainCheck.dnsChecked) {
    const mxHost = await resolveMxHost(domain)
    mailboxExists = await verifyMailboxSmtp(normalized, mxHost)
  }

  if (mailboxExists === false) {
    return {
      valid: false,
      formatValid: true,
      domainValid: true,
      mailboxExists: false,
      provider,
      message: isGmail
        ? 'This Gmail address does not exist'
        : 'This email address does not exist',
    }
  }

  if (mailboxExists === true) {
    return {
      valid: true,
      formatValid: true,
      domainValid: true,
      mailboxExists: true,
      provider,
      message: 'Email verified — mailbox exists',
    }
  }

  return inconclusiveResult(domain, isGmail, isExternalEmailVerifierConfigured())
}

/** Returns an error message when invalid, or null when OK. */
export async function getEmailValidationError(
  email: string | null | undefined,
  optional = false,
  verificationToken?: string | null
): Promise<string | null> {
  const trimmed = email?.trim() ?? ''
  if (!trimmed) {
    return optional ? null : 'Email is required'
  }

  const result = await verifyEmailOnServer(trimmed)
  if (result.mailboxExists === false) {
    return result.message
  }

  if (result.mailboxExists === true) {
    return null
  }

  if (verificationToken) {
    const { isEmailVerificationTokenValid } = await import('./email-otp')
    const ok = await isEmailVerificationTokenValid(trimmed, verificationToken)
    if (ok) return null
    return 'Email must be verified with the code sent to the inbox'
  }

  if (result.needsOtp) {
    return 'Verify this email with the code sent to the inbox'
  }

  return result.message || 'Could not verify that this email exists'
}
