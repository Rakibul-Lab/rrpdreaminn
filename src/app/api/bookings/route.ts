import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { successResponse, paginatedResponse, errorResponse, logActivity } from '@/lib/api-utils';
import { RoleType } from '@prisma/client';

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

    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (roomId) where.roomId = roomId;
    if (customerId) where.customerId = customerId;

    // Date range filter: bookings that overlap with the given range
    if (dateFrom || dateTo) {
      const dateFilter: Record<string, unknown> = {};
      if (dateFrom) dateFilter.gte = new Date(dateFrom);
      if (dateTo) dateFilter.lte = new Date(dateTo);
      where.checkIn = dateFilter;
    }

    const [bookings, total] = await Promise.all([
      db.booking.findMany({
        where,
        include: {
          customer: true,
          room: { include: { type: true } },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      db.booking.count({ where }),
    ]);

    return paginatedResponse(bookings, total, page, limit);
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
    } = body;

    if (!customerId || !roomId || !checkIn || !checkOut) {
      return errorResponse('Customer ID, room ID, check-in and check-out dates are required');
    }

    // Verify customer exists
    const customer = await db.customer.findUnique({ where: { id: customerId } });
    if (!customer) {
      return errorResponse('Customer not found');
    }

    // Verify room exists and is available
    const room = await db.room.findUnique({
      where: { id: roomId },
      include: { type: true },
    });
    if (!room) {
      return errorResponse('Room not found');
    }

    if (room.status === 'OCCUPIED' || room.status === 'MAINTENANCE') {
      return errorResponse(`Room is currently ${room.status.toLowerCase()} and cannot be booked`);
    }

    // Calculate number of days
    const checkInDate = new Date(checkIn);
    const checkOutDate = new Date(checkOut);
    const diffMs = checkOutDate.getTime() - checkInDate.getTime();
    const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (days <= 0) {
      return errorResponse('Check-out date must be after check-in date');
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

    // Calculate total room charge
    const totalRoomCharge = days * room.type.basePrice;
    const advance = advancePayment ? parseFloat(String(advancePayment)) : 0;
    const dueAmount = totalRoomCharge - advance;

    const booking = await db.booking.create({
      data: {
        customerId,
        roomId,
        checkIn: checkInDate,
        checkOut: checkOutDate,
        adults: adults || 1,
        children: children || 0,
        totalRoomCharge,
        advancePayment: advance,
        dueAmount,
        notes,
        createdBy: authUser.id,
      },
      include: {
        customer: true,
        room: { include: { type: true } },
      },
    });

    // If advance payment, create payment record
    if (advance > 0) {
      await db.payment.create({
        data: {
          amount: advance,
          method: body.paymentMethod || 'CASH',
          paymentType: 'ADVANCE',
          bookingId: booking.id,
          receivedBy: authResult.id,
          notes: 'Advance payment at booking creation',
        },
      });
    }

    // Update room status to occupied only for same-day check-in scenarios is not done here
    // Room status remains as is until check-in

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
      })
    );

    return successResponse(booking, 'Booking created successfully', 201);
  } catch (error) {
    console.error('Booking creation error:', error);
    return errorResponse('Failed to create booking', 500);
  }
}
