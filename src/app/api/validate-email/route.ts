import { NextRequest, NextResponse } from 'next/server'
import { verifyEmailOnServer } from '@/lib/email-verify-server'
import { isExternalEmailVerifierConfigured } from '@/lib/email-verify-external'
import { isSmtpConfigured } from '@/lib/mail'
import { getActiveEmailVerificationToken } from '@/lib/email-otp'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const email = typeof body?.email === 'string' ? body.email : ''

    if (!email.trim()) {
      return NextResponse.json({
        success: true,
        data: {
          valid: false,
          formatValid: false,
          domainValid: false,
          mailboxExists: null,
          message: 'Email is required',
        },
        meta: {
          externalVerifierConfigured: isExternalEmailVerifierConfigured(),
          smtpConfigured: isSmtpConfigured(),
        },
      })
    }

    const result = await verifyEmailOnServer(email)
    const existingToken = await getActiveEmailVerificationToken(email)

    if (existingToken && result.mailboxExists !== true) {
      return NextResponse.json({
        success: true,
        data: {
          valid: true,
          formatValid: true,
          domainValid: true,
          mailboxExists: true,
          needsOtp: false,
          verificationToken: existingToken,
          message: 'Email verified — mailbox confirmed',
          provider: result.provider,
        },
        meta: {
          externalVerifierConfigured: isExternalEmailVerifierConfigured(),
          smtpConfigured: isSmtpConfigured(),
        },
      })
    }

    return NextResponse.json({
      success: true,
      data: result,
      meta: {
        externalVerifierConfigured: isExternalEmailVerifierConfigured(),
        smtpConfigured: isSmtpConfigured(),
      },
    })
  } catch (error) {
    console.error('Email validation error:', error)
    return NextResponse.json(
      { success: false, error: 'Could not validate email' },
      { status: 500 }
    )
  }
}
