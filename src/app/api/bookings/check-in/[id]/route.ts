import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { successResponse, errorResponse, notFoundResponse, logActivity } from '@/lib/api-utils';
import { RoleType } from '@prisma/client';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType);
    if (authResult instanceof Response) return authResult;

    const authUser = await db.user.findUnique({
      where: { id: authResult.id },
      select: { id: true, active: true },
    });
    if (!authUser || !authUser.active) {
      return errorResponse('Session expired. Please log out and log in again.', 401);
    }

    const { id } = await params;
    const body = await request.json();
    const { initialPayment, paymentMethod } = body;

    // Fetch the booking
    const booking = await db.booking.findUnique({
      where: { id },
      include: {
        room: { include: { type: true } },
        customer: true,
      },
    });

    if (!booking) {
      return notFoundResponse('Booking');
    }

    // Validate booking status
    if (booking.status !== 'RESERVED') {
      return errorResponse('Only reserved bookings can be checked in');
    }

    // Update booking: set status, actualCheckIn, initialPayment, recalculate due
    const initialPaymentAmount = initialPayment ? parseFloat(String(initialPayment)) : 0;
    const dueAmount = booking.totalRoomCharge - booking.advancePayment - initialPaymentAmount;

    const updatedBooking = await db.booking.update({
      where: { id },
      data: {
        status: 'CHECKED_IN',
        actualCheckIn: new Date(),
        initialPayment: initialPaymentAmount,
        dueAmount,
      },
      include: {
        customer: true,
        room: { include: { type: true } },
      },
    });

    // Update room status to OCCUPIED
    await db.room.update({
      where: { id: booking.roomId },
      data: { status: 'OCCUPIED' },
    });

    // Create INITIAL payment record if amount > 0
    if (initialPaymentAmount > 0) {
      await db.payment.create({
        data: {
          amount: initialPaymentAmount,
          method: paymentMethod || 'CASH',
          paymentType: 'INITIAL',
          bookingId: id,
          receivedBy: authUser.id,
          notes: 'Initial payment at check-in',
        },
      });
    }

    await logActivity(
      authUser.id,
      'CHECK_IN',
      'hotel',
      JSON.stringify({
        bookingId: id,
        roomId: booking.roomId,
        customerName: booking.customer.name,
        initialPayment: initialPaymentAmount,
        dueAmount,
      })
    );

    return successResponse(updatedBooking, 'Check-in successful');
  } catch (error) {
    console.error('Check-in error:', error);
    return errorResponse('Failed to check in', 500);
  }
}
