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
import { replaceIdDocumentsForBooking } from '@/lib/booking-id-documents';
import { formatGuestCompany } from '@/lib/reservation-terms';
import { getCompleteReservationMissingFields } from '@/lib/reservation-completion-fields';
import { getEmailValidationError } from '@/lib/email-verify-server';

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

    const existing = await db.booking.findUnique({
      where: { id },
      include: {
        customer: true,
        idDocuments: true,
      },
    });
    if (!existing) {
      return notFoundResponse('Booking');
    }

    if (existing.status !== 'RESERVED') {
      return errorResponse('Only reserved bookings can be edited');
    }

    if (!existing.isInitialReservation) {
      return errorResponse('Only initial reservations can be edited. Create a new reservation to change a confirmed booking.');
    }

    const updateData: Record<string, unknown> = {};
    if (body.adults !== undefined) updateData.adults = parseInt(String(body.adults));
    if (body.children !== undefined) updateData.children = parseInt(String(body.children));
    if (body.notes !== undefined) updateData.notes = body.notes;
    if (body.company !== undefined) updateData.company = formatGuestCompany(body.company);
    if (body.withMeal !== undefined) updateData.withMeal = body.withMeal === true;
    if (body.discountEnabled !== undefined) {
      updateData.discountEnabled = body.discountEnabled === true;
    }
    if (body.discountType !== undefined) {
      updateData.discountType = body.discountType === 'FIXED' ? 'FIXED' : 'PERCENTAGE';
    }
    if (body.discountValue !== undefined) {
      updateData.discountValue = Math.max(0, parseFloat(String(body.discountValue)) || 0);
    }

    if (body.vatPercent !== undefined) {
      const parsed = parseFloat(String(body.vatPercent));
      if (!Number.isNaN(parsed) && parsed >= 0) updateData.vatPercent = parsed;
    }

    if (body.isInitialReservation === false) {
      updateData.isInitialReservation = false;
    }

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
      const overlappingBooking = await db.booking.findFirst({
        where: {
          id: { not: id },
          roomId,
          status: { in: ['RESERVED', 'CHECKED_IN'] },
          checkIn: { lt: newCheckOut },
          checkOut: { gt: newCheckIn },
        },
      });
      if (overlappingBooking) {
        return errorResponse('Room already has an active booking in this date range');
      }

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
            bookingVatOptions({
              ...existing,
              vatPercent:
                (updateData.vatPercent as number | undefined) ?? existing.vatPercent,
            })
          );
          updateData.totalRoomCharge = totalRoomCharge;
          updateData.dueAmount = dueAmount;
        }
      }
    }

    const customerPatch = body.customer as Record<string, unknown> | undefined;
    if (customerPatch) {
      const customerUpdate: Record<string, unknown> = {};
      if (customerPatch.name !== undefined) customerUpdate.name = String(customerPatch.name).trim();
      if (customerPatch.phone !== undefined) customerUpdate.phone = String(customerPatch.phone).trim();
      if (customerPatch.email !== undefined) {
        const emailValue = customerPatch.email ? String(customerPatch.email).trim() : null;
        const emailError = await getEmailValidationError(
          emailValue,
          true,
          customerPatch.emailVerificationToken as string | undefined
        );
        if (emailError) return errorResponse(emailError);
        customerUpdate.email = emailValue;
      }
      if (customerPatch.address !== undefined) {
        customerUpdate.address = customerPatch.address ? String(customerPatch.address).trim() : null;
      }
      if (customerPatch.idType !== undefined) customerUpdate.idType = customerPatch.idType;
      if (customerPatch.idNumber !== undefined) {
        customerUpdate.idNumber = customerPatch.idNumber
          ? String(customerPatch.idNumber).trim()
          : null;
      }
      if (customerPatch.idDocPath !== undefined) {
        customerUpdate.idDocPath = customerPatch.idDocPath ?? null;
      }
      if (customerPatch.registrationNumber !== undefined) {
        customerUpdate.registrationNumber = customerPatch.registrationNumber
          ? String(customerPatch.registrationNumber).trim()
          : null;
      }
      if (customerPatch.nationality !== undefined) {
        customerUpdate.nationality = customerPatch.nationality
          ? String(customerPatch.nationality).trim()
          : null;
      }

      if (Object.keys(customerUpdate).length > 0) {
        await db.customer.update({
          where: { id: existing.customerId },
          data: customerUpdate,
        });
      }
    }

    if (Array.isArray(body.idDocumentPaths)) {
      await replaceIdDocumentsForBooking(id, body.idDocumentPaths);
      const firstPath = body.idDocumentPaths.find(
        (p: unknown) => typeof p === 'string' && p.startsWith('/uploads/id-docs/')
      );
      if (firstPath) {
        await db.customer.update({
          where: { id: existing.customerId },
          data: { idDocPath: firstPath },
        });
      }
    }

    const idDocCount = Array.isArray(body.idDocumentPaths)
      ? body.idDocumentPaths.length
      : existing.idDocuments.length;

    if (body.isInitialReservation === false) {
      const email =
        customerPatch?.email !== undefined
          ? String(customerPatch.email || '').trim()
          : existing.customer.email?.trim() || '';
      const address =
        customerPatch?.address !== undefined
          ? String(customerPatch.address || '').trim()
          : existing.customer.address?.trim() || '';
      const idNumber =
        customerPatch?.idNumber !== undefined
          ? String(customerPatch.idNumber || '').trim()
          : existing.customer.idNumber?.trim() || '';
      const registrationNumber =
        customerPatch?.registrationNumber !== undefined
          ? String(customerPatch.registrationNumber || '').trim()
          : existing.customer.registrationNumber?.trim() || '';
      const nationality =
        customerPatch?.nationality !== undefined
          ? String(customerPatch.nationality || '').trim()
          : existing.customer.nationality?.trim() || '';

      const missing = getCompleteReservationMissingFields({
        nationality,
        idNumber,
        email,
        address,
        registrationNumber,
        idDocumentCount: idDocCount,
      });
      if (missing.length > 0) {
        return errorResponse(
          `Complete the reservation — required: ${missing.join(', ')}`
        );
      }
    }

    const booking = await db.booking.update({
      where: { id },
      data: updateData,
      include: {
        customer: true,
        room: { include: { type: true } },
        idDocuments: { orderBy: { sortOrder: 'asc' } },
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
