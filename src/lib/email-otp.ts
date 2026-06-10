import { createHash, randomInt } from 'crypto'
import { db } from '@/lib/db'
import { sendEmail, isSmtpConfigured } from '@/lib/mail'
import { normalizeEmail } from '@/lib/email-validation'

const OTP_TTL_MS = 10 * 60 * 1000
const SESSION_TTL_MS = 24 * 60 * 60 * 1000
const RESEND_COOLDOWN_MS = 60 * 1000

function hashCode(email: string, code: string): string {
  return createHash('sha256').update(`${email}:${code}`).digest('hex')
}

function generateOtp(): string {
  return String(randomInt(100000, 1000000))
}

function generateToken(): string {
  return createHash('sha256')
    .update(`${Date.now()}:${randomInt(1_000_000, 9_999_999)}`)
    .digest('hex')
}

export async function sendEmailOtp(email: string): Promise<{ sent: boolean; message: string }> {
  const normalized = normalizeEmail(email)
  if (!isSmtpConfigured()) {
    return {
      sent: false,
      message: 'SMTP is not configured. Add SMTP_HOST, SMTP_USER, and SMTP_PASS to .env',
    }
  }

  const recent = await db.emailVerificationOtp.findFirst({
    where: { email: normalized },
    orderBy: { createdAt: 'desc' },
  })
  if (recent && Date.now() - recent.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    return {
      sent: false,
      message: 'Please wait a minute before requesting another code',
    }
  }

  const code = generateOtp()
  const expiresAt = new Date(Date.now() + OTP_TTL_MS)

  await db.emailVerificationOtp.deleteMany({ where: { email: normalized } })
  await db.emailVerificationOtp.create({
    data: {
      email: normalized,
      codeHash: hashCode(normalized, code),
      expiresAt,
    },
  })

  await sendEmail({
    to: normalized,
    subject: 'Your verification code — RRP Dream Inn',
    text: `Your email verification code is: ${code}\n\nThis code expires in 10 minutes.`,
    html: `<p>Your email verification code is:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px">${code}</p><p>This code expires in 10 minutes.</p>`,
  })

  return { sent: true, message: 'Verification code sent' }
}

export async function confirmEmailOtp(
  email: string,
  code: string
): Promise<{ verified: boolean; token?: string; message: string }> {
  const normalized = normalizeEmail(email)
  const trimmedCode = code.trim()
  if (!/^\d{6}$/.test(trimmedCode)) {
    return { verified: false, message: 'Enter the 6-digit code' }
  }

  const record = await db.emailVerificationOtp.findFirst({
    where: { email: normalized },
    orderBy: { createdAt: 'desc' },
  })

  if (!record || record.expiresAt < new Date()) {
    return { verified: false, message: 'Code expired — request a new one' }
  }

  if (record.codeHash !== hashCode(normalized, trimmedCode)) {
    return { verified: false, message: 'Incorrect verification code' }
  }

  const token = generateToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)

  await db.$transaction([
    db.emailVerificationOtp.deleteMany({ where: { email: normalized } }),
    db.emailVerificationSession.deleteMany({ where: { email: normalized } }),
    db.emailVerificationSession.create({
      data: { email: normalized, token, expiresAt },
    }),
  ])

  return {
    verified: true,
    token,
    message: 'Email verified — mailbox confirmed',
  }
}

export async function isEmailVerificationTokenValid(
  email: string,
  token: string | null | undefined
): Promise<boolean> {
  if (!token?.trim()) return false
  const normalized = normalizeEmail(email)
  const session = await db.emailVerificationSession.findUnique({
    where: { token: token.trim() },
  })
  return Boolean(
    session &&
      session.email === normalized &&
      session.expiresAt > new Date()
  )
}

export async function getActiveEmailVerificationToken(
  email: string
): Promise<string | null> {
  const normalized = normalizeEmail(email)
  try {
    const session = await db.emailVerificationSession.findFirst({
      where: { email: normalized, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    })
    return session?.token ?? null
  } catch {
    return null
  }
}
