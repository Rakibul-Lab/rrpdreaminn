import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { successResponse, errorResponse, notFoundResponse, logActivity } from '@/lib/api-utils';
import { bookingVatOptions, computeRoomBookingTotals, sumBookingNetPaid } from '@/lib/booking-totals';
import { parsePaymentMethod } from '@/lib/payment-method';
import { RoleType } from '@prisma/client';
import { isReservationGuestProfileComplete } from '@/lib/reservation-completion-fields';

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
        idDocuments: true,
      },
    });

    if (!booking) {
      return notFoundResponse('Booking');
    }

    // Validate booking status
    if (booking.status !== 'RESERVED') {
      return errorResponse('Only reserved bookings can be checked in');
    }

    if (
      booking.isInitialReservation ||
      !isReservationGuestProfileComplete(booking.customer, booking.idDocuments.length)
    ) {
      return errorResponse(
        'Complete the reservation first — nationality, NID, email, address, registration number, and ID images are required before check-in'
      );
    }

    const initialPaymentAmount = initialPayment ? parseFloat(String(initialPayment)) : 0;

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
          method: parsePaymentMethod(paymentMethod, 'CASH'),
          paymentType: 'INITIAL',
          bookingId: id,
          receivedBy: authUser.id,
          notes: 'Initial payment at check-in',
        },
      });
    }

    const paymentRows = await db.payment.findMany({
      where: { bookingId: id },
      select: { amount: true, paymentType: true },
    });
    const totalPaid = sumBookingNetPaid(paymentRows);
    const { dueAmount } = computeRoomBookingTotals(
      booking.totalRoomCharge,
      totalPaid,
      bookingVatOptions(booking)
    );

    const updatedBooking = await db.booking.update({
      where: { id },
      data: {
        status: 'CHECKED_IN',
        isInitialReservation: false,
        actualCheckIn: new Date(),
        initialPayment: (booking.initialPayment || 0) + initialPaymentAmount,
        dueAmount,
      },
      include: {
        customer: true,
        room: { include: { type: true } },
      },
    });

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
