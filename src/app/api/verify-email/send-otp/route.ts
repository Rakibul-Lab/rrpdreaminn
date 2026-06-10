import { NextRequest, NextResponse } from 'next/server'
import { validateEmailFormat } from '@/lib/email-validation'
import { sendEmailOtp } from '@/lib/email-otp'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const email = typeof body?.email === 'string' ? body.email.trim() : ''
    const format = validateEmailFormat(email)
    if (!format.valid) {
      return NextResponse.json({ success: false, error: format.message }, { status: 400 })
    }

    const result = await sendEmailOtp(email)
    if (!result.sent) {
      return NextResponse.json({ success: false, error: result.message }, { status: 400 })
    }

    return NextResponse.json({ success: true, message: result.message })
  } catch (error) {
    console.error('Send OTP error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to send verification code' },
      { status: 500 }
    )
  }
}
