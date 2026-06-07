import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { successResponse, errorResponse, notFoundResponse, logActivity } from '@/lib/api-utils';
import { ensureConfirmationNumber } from '@/lib/confirmation-number';
import { bookingVatOptions, computeRoomBookingTotals, sumBookingNetPaid } from '@/lib/booking-totals';
import { formatFormOfPayment, getAdvancePaymentMethod } from '@/lib/payment-method';
import { RoleType } from '@prisma/client';
import { resolveBookingCheckInOut } from '@/lib/app-settings';
import { countBookedNights } from '@/lib/booking-stay';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const booking = await db.booking.findUnique({
      where: { id },
      include: {
        customer: true,
        room: { include: { type: true } },
        creator: { select: { id: true, name: true, email: true, phone: true, role: true } },
        charges: true,
        payments: true,
        restaurantOrders: { include: { items: { include: { menuItem: true } } } },
        invoices: true,
        idDocuments: { orderBy: { sortOrder: 'asc' } },
      },
    });

    if (!booking) {
      return notFoundResponse('Booking');
    }

    const totalPaid = sumBookingNetPaid(booking.payments);
    const totals = computeRoomBookingTotals(
      booking.totalRoomCharge,
      totalPaid,
      bookingVatOptions(booking)
    );
    const advanceMethod = getAdvancePaymentMethod(booking.payments);
    const enriched = {
      ...booking,
      vatPercent: totals.vatPercent,
      vatAmount: totals.vatAmount,
      totalWithVat: totals.totalWithVat,
      dueAmount: totals.dueAmount,
      formOfPayment: formatFormOfPayment(booking.advancePayment, advanceMethod),
    };

    if (!booking.confirmationNumber) {
      const confirmationNumber = await ensureConfirmationNumber(id);
      return successResponse({ ...enriched, confirmationNumber });
    }

    return successResponse(enriched);
  } catch (error) {
    console.error('Booking fetch error:', error);
    return errorResponse('Failed to fetch booking', 500);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType);
    if (authResult instanceof Response) return authResult;

    const { id } = await params;
    const body = await request.json();

    const existing = await db.booking.findUnique({ where: { id } });
    if (!existing) {
      return notFoundResponse('Booking');
    }

    // Don't allow updates to checked-out or cancelled bookings
    if (existing.status === 'CHECKED_OUT' || existing.status === 'CANCELLED') {
      return errorResponse('Cannot update a checked-out or cancelled booking');
    }

    const updateData: Record<string, unknown> = {};
    if (body.adults !== undefined) updateData.adults = parseInt(String(body.adults));
    if (body.children !== undefined) updateData.children = parseInt(String(body.children));
    if (body.notes !== undefined) updateData.notes = body.notes;
    if (body.status !== undefined) updateData.status = body.status;

    // If room is being changed, verify it
    if (body.roomId && body.roomId !== existing.roomId) {
      const room = await db.room.findUnique({ where: { id: body.roomId } });
      if (!room) {
        return errorResponse('Room not found');
      }
      updateData.roomId = body.roomId;
    }

    const roomId = (body.roomId as string) || existing.roomId;

    if (body.checkIn !== undefined || body.checkOut !== undefined) {
      try {
        const resolved = await resolveBookingCheckInOut(
          body.checkIn ?? existing.checkIn,
          body.checkOut ?? existing.checkOut
        );
        updateData.checkIn = resolved.checkIn;
        updateData.checkOut = resolved.checkOut;
      } catch {
        return errorResponse('Check-out date must be after check-in date');
      }
    }

    const newCheckIn = (updateData.checkIn as Date) ?? existing.checkIn;
    const newCheckOut = (updateData.checkOut as Date) ?? existing.checkOut;

    if (body.checkIn || body.checkOut || body.roomId) {
      const room = await db.room.findUnique({
        where: { id: roomId },
        include: { type: true },
      });

      if (room) {
        const days = countBookedNights(newCheckIn, newCheckOut);
        if (days > 0) {
          const totalRoomCharge = days * room.type.basePrice;
          const paymentRows = await db.payment.findMany({
            where: { bookingId: id },
            select: { amount: true, paymentType: true },
          });
          const totalPaid = sumBookingNetPaid(paymentRows);
          const { dueAmount } = computeRoomBookingTotals(
            totalRoomCharge,
            totalPaid,
            bookingVatOptions(existing)
          );
          updateData.totalRoomCharge = totalRoomCharge;
          updateData.dueAmount = dueAmount;
        }
      }
    }

    const booking = await db.booking.update({
      where: { id },
      data: updateData,
      include: {
        customer: true,
        room: { include: { type: true } },
      },
    });

    await logActivity(
      authResult.id,
      'UPDATE_BOOKING',
      'hotel',
      JSON.stringify({ bookingId: id, changes: updateData })
    );

    return successResponse(booking, 'Booking updated successfully');
  } catch (error) {
    console.error('Booking update error:', error);
    return errorResponse('Failed to update booking', 500);
  }
}
