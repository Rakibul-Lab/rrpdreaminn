import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyPassword } from '@/lib/password';
import { logActivity } from '@/lib/api-utils';

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const user = await db.user.findUnique({ where: { email } });
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Invalid credentials' },
        { status: 401 }
      );
    }

    if (!user.active) {
      return NextResponse.json(
        { success: false, error: 'Account is deactivated' },
        { status: 403 }
      );
    }

    const isValid = await verifyPassword(password, user.password);
    if (!isValid) {
      return NextResponse.json(
        { success: false, error: 'Invalid credentials' },
        { status: 401 }
      );
    }

    // Generate a simple token
    const token = `${user.id}-${Date.now()}-${Math.random().toString(36).substring(2)}`;

    await logActivity(user.id, 'LOGIN', 'auth', JSON.stringify({ email }));

    return NextResponse.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatar: user.avatar,
          role: user.role,
          phone: user.phone,
        },
        token,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { success: false, error: 'Login failed' },
      { status: 500 }
    );
  }
}
