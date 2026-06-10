import { NextRequest, NextResponse } from 'next/server'
import { validateEmailFormat } from '@/lib/email-validation'
import { confirmEmailOtp } from '@/lib/email-otp'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const email = typeof body?.email === 'string' ? body.email.trim() : ''
    const code = typeof body?.code === 'string' ? body.code : ''

    const format = validateEmailFormat(email)
    if (!format.valid) {
      return NextResponse.json({ success: false, error: format.message }, { status: 400 })
    }

    const result = await confirmEmailOtp(email, code)
    if (!result.verified) {
      return NextResponse.json({ success: false, error: result.message }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      data: { verificationToken: result.token },
    })
  } catch (error) {
    console.error('Confirm OTP error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to verify code' },
      { status: 500 }
    )
  }
}
