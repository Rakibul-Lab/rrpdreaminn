import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { successResponse, paginatedResponse, errorResponse, logActivity } from '@/lib/api-utils';
import { generateConfirmationNumber } from '@/lib/confirmation-number';
import { attachIdDocumentsToBooking } from '@/lib/booking-id-documents';
import { isNonePaymentMethod, parseReservationPaymentMethod } from '@/lib/payment-method';
import {
  bookingVatOptions,
  computeRoomBookingTotals,
  getHotelVatPercent,
  sumBookingNetPaid,
} from '@/lib/booking-totals';
import { formatGuestCompany } from '@/lib/reservation-terms';
import {
  ensureCompanyLedgerGuestFromCustomer,
  resolveCompanyLedgerBooking,
} from '@/lib/company-ledger-billing';
import { resolveBookingCheckInOut } from '@/lib/app-settings';
import { Prisma, RoleType } from '@prisma/client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const status = searchParams.get('status');
    const roomId = searchParams.get('roomId');
    const customerId = searchParams.get('customerId');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const search = searchParams.get('search')?.trim();

    const skip = (page - 1) * limit;

    const where: Prisma.BookingWhereInput = {};
    if (status) where.status = status as Prisma.EnumBookingStatusFilter['equals'];
    if (roomId) where.roomId = roomId;
    if (customerId) where.customerId = customerId;

    if (search) {
      where.OR = [
        { customer: { name: { contains: search } } },
        { customer: { phone: { contains: search } } },
        { room: { roomNumber: { contains: search } } },
        { confirmationNumber: { contains: search } },
      ];
    }

    // Date range filter: reservations created within the range (inclusive days)
    if (dateFrom || dateTo) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (dateFrom) {
        const start = new Date(dateFrom);
        if (!Number.isNaN(start.getTime())) {
          start.setHours(0, 0, 0, 0);
          dateFilter.gte = start;
        }
      }
      if (dateTo) {
        const end = new Date(dateTo);
        if (!Number.isNaN(end.getTime())) {
          end.setHours(23, 59, 59, 999);
          dateFilter.lte = end;
        }
      }
      if (dateFilter.gte || dateFilter.lte) {
        where.createdAt = dateFilter;
      }
    }

    const [bookings, total] = await Promise.all([
      db.booking.findMany({
        where,
        include: {
          customer: true,
          room: { include: { type: true } },
          creator: { select: { id: true, name: true, email: true } },
          payments: { select: { amount: true, paymentType: true } },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      db.booking.count({ where }),
    ]);

    const enriched = bookings.map((booking) => {
      const totalPaid = sumBookingNetPaid(booking.payments);
      const totals = computeRoomBookingTotals(
        booking.totalRoomCharge,
        totalPaid,
        bookingVatOptions(booking)
      );
      const { payments: _payments, ...rest } = booking;
      return {
        ...rest,
        vatPercent: totals.vatPercent,
        vatAmount: totals.vatAmount,
        totalWithVat: totals.totalWithVat,
        dueAmount: totals.dueAmount,
      };
    });

    return paginatedResponse(enriched, total, page, limit);
  } catch (error) {
    console.error('Bookings list error:', error);
    return errorResponse('Failed to fetch bookings', 500);
  }
}

export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const {
      customerId,
      roomId,
      checkIn,
      checkOut,
      adults,
      children,
      advancePayment,
      notes,
      idDocumentPaths,
      vatApplied,
      vatPercent: vatPercentBody,
      checkInNow,
      paymentMethod,
      company,
      isInitialReservation,
      withMeal,
      discountEnabled,
      discountType,
      discountValue,
      companyLedgerId,
      nationality: nationalityBody,
    } = body;

    const initialReservation = isInitialReservation === true;

    if (initialReservation && checkInNow === true) {
      return errorResponse(
        'Initial reservations cannot be checked in immediately. Complete guest ID details first, then check in from bookings.'
      );
    }

    if (!customerId || !roomId || !checkIn || !checkOut) {
      return errorResponse('Customer ID, room ID, check-in and check-out dates are required');
    }

    // Verify customer exists
    const customer = await db.customer.findUnique({ where: { id: customerId } });
    if (!customer) {
      return errorResponse('Customer not found');
    }

    if (!customer.nationality?.trim()) {
      return errorResponse('Guest nationality is required');
    }

    // Verify room exists and is available
    const room = await db.room.findUnique({
      where: { id: roomId },
      include: { type: true },
    });
    if (!room) {
      return errorResponse('Room not found');
    }

    if (room.status !== 'AVAILABLE') {
      return errorResponse(
        `Room is not available for booking (current status: ${room.status.toLowerCase().replace('_', ' ')})`
      );
    }

    let checkInDate: Date;
    let checkOutDate: Date;
    let days: number;
    try {
      const resolved = await resolveBookingCheckInOut(checkIn, checkOut, {
        walkInNow: checkInNow === true,
      });
      checkInDate = resolved.checkIn;
      checkOutDate = resolved.checkOut;
      days = resolved.nights;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Check-out date must be after check-in date';
      return errorResponse(message);
    }

    // Prevent overlapping active bookings for the same room.
    const overlappingBooking = await db.booking.findFirst({
      where: {
        roomId,
        status: { in: ['RESERVED', 'CHECKED_IN'] },
        checkIn: { lt: checkOutDate },
        checkOut: { gt: checkInDate },
      },
      include: {
        customer: { select: { name: true } },
      },
    });
    if (overlappingBooking) {
      return errorResponse(
        `Room already has an active booking in this date range${overlappingBooking.customer?.name ? ` (${overlappingBooking.customer.name})` : ''}`
      );
    }

    // Calculate total room charge (ex-VAT) and due per reservation VAT options
    const totalRoomCharge = days * room.type.basePrice;
    const advance = advancePayment ? parseFloat(String(advancePayment)) : 0;
    const defaultVat = await getHotelVatPercent();
    const applyVat = vatApplied !== false;
    let bookingVatPercent = defaultVat;
    if (vatPercentBody !== undefined && vatPercentBody !== null && vatPercentBody !== '') {
      const parsed = parseFloat(String(vatPercentBody));
      if (!Number.isNaN(parsed) && parsed >= 0) bookingVatPercent = parsed;
    }
    const applyDiscount = discountEnabled === true;
    const resolvedDiscountType = discountType === 'FIXED' ? 'FIXED' : 'PERCENTAGE';
    const resolvedDiscountValue = applyDiscount
      ? Math.max(0, parseFloat(String(discountValue ?? 0)) || 0)
      : 0;

    const { dueAmount } = computeRoomBookingTotals(
      totalRoomCharge,
      advance,
      {
        vatApplied: applyVat,
        vatPercent: bookingVatPercent,
      },
      {
        discountEnabled: applyDiscount,
        discountType: resolvedDiscountType,
        discountValue: resolvedDiscountValue,
      }
    );

    const confirmationNumber = await generateConfirmationNumber();
    let resolvedCompany = formatGuestCompany(company ?? customer.company);
    let resolvedCompanyLedgerId: string | null = null;
    let resolvedCompanyLedgerGuestId: string | null = null;

    if (companyLedgerId) {
      const ledgerResult = await resolveCompanyLedgerBooking(db, companyLedgerId, null);
      if ('error' in ledgerResult) {
        return errorResponse(ledgerResult.error);
      }
      resolvedCompanyLedgerId = ledgerResult.companyLedgerId;
      resolvedCompany = ledgerResult.companyName;
      resolvedCompanyLedgerGuestId = await ensureCompanyLedgerGuestFromCustomer(
        db,
        resolvedCompanyLedgerId,
        {
          name: customer.name,
          phone: customer.phone,
          email: customer.email,
          nationality: customer.nationality,
          registrationNumber: customer.registrationNumber,
          address: customer.address,
          idType: customer.idType,
          idNumber: customer.idNumber,
        }
      );
    }

    const booking = await db.booking.create({
      data: {
        confirmationNumber,
        customerId,
        roomId,
        company: resolvedCompany,
        companyLedgerId: resolvedCompanyLedgerId,
        companyLedgerGuestId: resolvedCompanyLedgerGuestId,
        checkIn: checkInDate,
        checkOut: checkOutDate,
        adults: adults || 1,
        children: children || 0,
        totalRoomCharge,
        advancePayment: advance,
        dueAmount,
        vatApplied: applyVat,
        vatPercent: bookingVatPercent,
        notes,
        isInitialReservation: initialReservation,
        withMeal: withMeal === true,
        discountEnabled: applyDiscount,
        discountType: applyDiscount ? resolvedDiscountType : null,
        discountValue: applyDiscount ? resolvedDiscountValue : 0,
        createdBy: authUser.id,
      },
      include: {
        customer: true,
        room: { include: { type: true } },
      },
    });

    await attachIdDocumentsToBooking(
      booking.id,
      Array.isArray(idDocumentPaths) ? idDocumentPaths : undefined
    );

    const resolvedPaymentMethod = parseReservationPaymentMethod(paymentMethod);

    // If advance payment with a real method, create payment record
    if (advance > 0 && !isNonePaymentMethod(resolvedPaymentMethod)) {
      await db.payment.create({
        data: {
          amount: advance,
          method: resolvedPaymentMethod,
          paymentType: 'ADVANCE',
          bookingId: booking.id,
          receivedBy: authResult.id,
          notes: 'Advance payment at booking creation',
        },
      });
    }

    if (checkInNow === true) {
      await db.room.update({
        where: { id: roomId },
        data: { status: 'OCCUPIED' },
      });

      const paymentRows = await db.payment.findMany({
        where: { bookingId: booking.id },
        select: { amount: true, paymentType: true },
      });
      const totalPaid = sumBookingNetPaid(paymentRows);
      const { dueAmount: dueAfterCheckIn } = computeRoomBookingTotals(
        totalRoomCharge,
        totalPaid,
        { vatApplied: applyVat, vatPercent: bookingVatPercent }
      );

      await db.booking.update({
        where: { id: booking.id },
        data: {
          status: 'CHECKED_IN',
          actualCheckIn: new Date(),
          dueAmount: dueAfterCheckIn,
        },
      });
    } else {
      await db.room.update({
        where: { id: roomId },
        data: { status: 'RESERVED' },
      });
    }

    await logActivity(
      authResult.id,
      'CREATE_BOOKING',
      'hotel',
      JSON.stringify({
        bookingId: booking.id,
        customerId,
        roomId,
        totalRoomCharge,
        advancePayment: advance,
        dueAmount,
        checkedIn: checkInNow === true,
      })
    );

    const bookingWithDocs = await db.booking.findUnique({
      where: { id: booking.id },
      include: {
        customer: true,
        room: { include: { type: true } },
        idDocuments: { orderBy: { sortOrder: 'asc' } },
      },
    });

    return successResponse(bookingWithDocs ?? booking, 'Booking created successfully', 201);
  } catch (error) {
    console.error('Booking creation error:', error);
    const message =
      error instanceof Error ? error.message : 'Failed to create booking';
    return errorResponse(
      process.env.NODE_ENV === 'development' ? message : 'Failed to create booking',
      500
    );
  }
}
