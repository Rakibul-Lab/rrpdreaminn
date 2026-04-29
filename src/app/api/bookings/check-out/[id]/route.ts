import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { successResponse, errorResponse, notFoundResponse, logActivity, generateInvoiceNumber } from '@/lib/api-utils';
import { RoleType } from '@prisma/client';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType);
    if (authResult instanceof Response) return authResult;

    const { id } = await params;
    const booking = await db.booking.findUnique({
      where: { id },
      include: {
        room: { include: { type: true } },
        customer: true,
        charges: true,
      },
    });

    if (!booking) return notFoundResponse('Booking');
    if (booking.status !== 'CHECKED_IN') {
      return errorResponse('Only checked-in bookings can be checked out');
    }

    const now = new Date();
    let lateCheckoutCharge = 0;
    if (now > booking.checkOut) {
      const diffMs = now.getTime() - booking.checkOut.getTime();
      const hoursLate = Math.ceil(diffMs / (1000 * 60 * 60));
      const hourlyRate = booking.room.type.hourlyRate;
      if (hourlyRate) {
        lateCheckoutCharge = hoursLate * hourlyRate;
      } else {
        const halfDaysLate = Math.ceil(hoursLate / 6);
        const halfDayRate = booking.room.type.basePrice / 2;
        lateCheckoutCharge = Math.min(halfDaysLate * halfDayRate, booking.room.type.basePrice);
      }
    }

    const individualRoomCharges = booking.charges
      .filter((c) => c.chargeType === 'ROOM_RATE')
      .reduce((sum, c) => sum + c.amount * c.quantity, 0);
    const existingExtraCharges = booking.charges
      .filter((c) => c.chargeType !== 'ROOM_RATE')
      .reduce((sum, c) => sum + c.amount * c.quantity, 0);
    const roomCharges = individualRoomCharges > 0 ? individualRoomCharges : booking.totalRoomCharge;
    const extraCharges = existingExtraCharges + lateCheckoutCharge;

    const restaurantOrders = await db.restaurantOrder.findMany({
      where: { bookingId: id, status: { not: 'CANCELLED' } },
    });
    const restaurantNet = restaurantOrders.reduce(
      (sum, order) => sum + Math.max(0, order.subtotal - order.discount),
      0
    );
    const restaurantVat = restaurantOrders.reduce((sum, order) => sum + order.vatAmount, 0);
    const restaurantTotal = restaurantOrders.reduce((sum, order) => sum + order.totalAmount, 0);
    const foodCharges = restaurantNet;

    const hotelBase = roomCharges + extraCharges;
    const subtotal = hotelBase + restaurantNet;
    let vatPercent = 15;
    const vatSetting = await db.setting.findUnique({ where: { key: 'vat_percent' } });
    if (vatSetting) vatPercent = parseFloat(vatSetting.value) || 15;
    let discount = 0;
    const discountSetting = await db.setting.findUnique({ where: { key: 'default_discount_percent' } });
    if (discountSetting) {
      discount = hotelBase * (parseFloat(discountSetting.value) || 0) / 100;
    }
    const hotelVat = (hotelBase - discount) * vatPercent / 100;
    const vatAmount = hotelVat + restaurantVat;
    const totalAmount = (hotelBase - discount + hotelVat) + restaurantTotal;
    const bookingPayments = await db.payment.findMany({ where: { bookingId: id } });
    const totalPaid = bookingPayments.reduce((sum, p) => sum + p.amount, 0);
    const dueBeforeSettlement = Math.max(0, totalAmount - totalPaid);

    return successResponse({
      bookingId: id,
      customerName: booking.customer.name,
      roomNumber: booking.room.roomNumber,
      roomCharges,
      foodCharges,
      extraCharges,
      subtotal,
      discount,
      vatPercent,
      vatAmount,
      restaurantVat,
      totalAmount,
      totalPaid,
      dueBeforeSettlement,
      lateCheckoutCharge,
    });
  } catch (error) {
    console.error('Check-out preview error:', error);
    return errorResponse('Failed to load check-out preview', 500);
  }
}

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
    const finalPayment = Number(body?.finalPayment || 0);
    const paymentMethod = body?.paymentMethod || 'CASH';
    const paymentReference = body?.paymentReference || null;
    const paymentNotes = body?.paymentNotes || null;

    // Fetch the booking with all related data
    const booking = await db.booking.findUnique({
      where: { id },
      include: {
        room: { include: { type: true } },
        customer: true,
        charges: true,
        restaurantOrders: true,
      },
    });

    if (!booking) {
      return notFoundResponse('Booking');
    }

    // Validate booking status
    if (booking.status !== 'CHECKED_IN') {
      return errorResponse('Only checked-in bookings can be checked out');
    }

    const now = new Date();
    let lateCheckoutCharge = 0;

    // Check for late checkout (after scheduled checkout time)
    if (now > booking.checkOut) {
      const diffMs = now.getTime() - booking.checkOut.getTime();
      const hoursLate = Math.ceil(diffMs / (1000 * 60 * 60));

      // If room type has hourly rate, use it; otherwise calculate based on daily rate
      const hourlyRate = booking.room.type.hourlyRate;
      if (hourlyRate) {
        lateCheckoutCharge = hoursLate * hourlyRate;
      } else {
        // Charge half day rate for every 6 hours late, max 1 day rate
        const halfDaysLate = Math.ceil(hoursLate / 6);
        const halfDayRate = booking.room.type.basePrice / 2;
        lateCheckoutCharge = Math.min(halfDaysLate * halfDayRate, booking.room.type.basePrice);
      }

      // Create late checkout charge
      await db.roomCharge.create({
        data: {
          bookingId: id,
          chargeType: 'LATE_CHECKOUT',
          description: `Late checkout - ${hoursLate} hours late`,
          amount: lateCheckoutCharge,
          quantity: 1,
          chargeDate: now,
        },
      });
    }

    // Calculate all charges
    // Room charges total
    const individualRoomCharges = booking.charges
      .filter((c) => c.chargeType === 'ROOM_RATE')
      .reduce((sum, c) => sum + c.amount * c.quantity, 0);
    const existingExtraCharges = booking.charges
      .filter((c) => c.chargeType !== 'ROOM_RATE')
      .reduce((sum, c) => sum + c.amount * c.quantity, 0);
    const roomCharges = individualRoomCharges > 0 ? individualRoomCharges : booking.totalRoomCharge;
    const extraCharges = existingExtraCharges + lateCheckoutCharge;

    // Restaurant orders total for this booking's room
    const restaurantOrders = await db.restaurantOrder.findMany({
      where: { bookingId: id, status: { not: 'CANCELLED' } },
    });
    const restaurantNet = restaurantOrders.reduce(
      (sum, order) => sum + Math.max(0, order.subtotal - order.discount),
      0
    );
    const restaurantVat = restaurantOrders.reduce((sum, order) => sum + order.vatAmount, 0);
    const restaurantTotal = restaurantOrders.reduce((sum, order) => sum + order.totalAmount, 0);
    const foodCharges = restaurantNet;

    const hotelBase = roomCharges + extraCharges;
    const subtotal = hotelBase + restaurantNet;
    let vatPercent = 15;
    const vatSetting = await db.setting.findUnique({ where: { key: 'vat_percent' } });
    if (vatSetting) vatPercent = parseFloat(vatSetting.value) || 15;
    let discount = 0;
    const discountSetting = await db.setting.findUnique({ where: { key: 'default_discount_percent' } });
    if (discountSetting) {
      discount = hotelBase * (parseFloat(discountSetting.value) || 0) / 100;
    }
    const hotelVat = (hotelBase - discount) * vatPercent / 100;
    const vatAmount = hotelVat + restaurantVat;
    const totalAmount = (hotelBase - discount + hotelVat) + restaurantTotal;
    const bookingPayments = await db.payment.findMany({ where: { bookingId: id } });
    const totalPaidBeforeFinal = bookingPayments.reduce((sum, p) => sum + p.amount, 0);
    const finalDueAmount = Math.max(0, totalAmount - totalPaidBeforeFinal);

    // Block checkout if due is not fully paid in this action.
    if (finalDueAmount > 0 && finalPayment < finalDueAmount) {
      return errorResponse(`Due amount must be fully cleared to checkout. Required: ৳${finalDueAmount.toFixed(2)}`);
    }

    // Record final settlement payment before checkout.
    if (finalPayment > 0) {
      await db.payment.create({
        data: {
          amount: finalPayment,
          method: paymentMethod,
          paymentType: 'FINAL',
          bookingId: id,
          receivedBy: authUser.id,
          reference: paymentReference,
          notes: paymentNotes || 'Final payment at check-out',
        },
      });
    }

    // Update booking
    const updatedBooking = await db.booking.update({
      where: { id },
      data: {
        status: 'CHECKED_OUT',
        actualCheckOut: now,
        dueAmount: Math.max(0, finalDueAmount - finalPayment),
      },
      include: {
        customer: true,
        room: { include: { type: true } },
        charges: true,
        payments: true,
        restaurantOrders: true,
        invoices: true,
      },
    });

    // Update room status to CLEANING
    await db.room.update({
      where: { id: booking.roomId },
      data: { status: 'CLEANING' },
    });

    // Create housekeeping task for the room
    await db.housekeepingTask.create({
      data: {
        roomId: booking.roomId,
        taskType: 'cleaning',
        status: 'PENDING',
        assignedTo: authUser.id,
        notes: `Post-checkout cleaning for room ${booking.room.roomNumber}`,
      },
    });

    // Auto-generate invoice if not already present.
    const existingInvoice = await db.invoice.findFirst({
      where: {
        bookingId: id,
        status: { not: 'CANCELLED' },
      },
    });

    let generatedInvoiceId: string | null = null;
    if (!existingInvoice) {
      const subtotal = hotelBase + restaurantNet;
      let vatPercent = 15;
      const vatSetting = await db.setting.findUnique({ where: { key: 'vat_percent' } });
      if (vatSetting) vatPercent = parseFloat(vatSetting.value) || 15;
      let discount = 0;
      const discountSetting = await db.setting.findUnique({ where: { key: 'default_discount_percent' } });
      if (discountSetting) {
        discount = hotelBase * (parseFloat(discountSetting.value) || 0) / 100;
      }
      const hotelVat = (hotelBase - discount) * vatPercent / 100;
      const vatAmount = hotelVat + restaurantVat;
      const totalAmount = (hotelBase - discount + hotelVat) + restaurantTotal;

      const bookingPayments = await db.payment.findMany({
        where: { bookingId: id },
      });
      const paidAmount = bookingPayments.reduce((sum, p) => sum + p.amount, 0);
      const dueAmount = Math.max(0, totalAmount - paidAmount);
      const invoiceStatus = dueAmount <= 0 ? 'PAID' : 'ISSUED';

      const invoice = await db.invoice.create({
        data: {
          invoiceNumber: generateInvoiceNumber(),
          bookingId: id,
          roomCharges,
          foodCharges,
          extraCharges,
          subtotal,
          discount,
          vatAmount,
          totalAmount,
          paidAmount,
          dueAmount,
          status: invoiceStatus,
          issuedAt: now,
          paidAt: invoiceStatus === 'PAID' ? now : null,
        },
      });
      generatedInvoiceId = invoice.id;
    } else {
      generatedInvoiceId = existingInvoice.id;
    }

    await logActivity(
      authUser.id,
      'CHECK_OUT',
      'hotel',
      JSON.stringify({
        bookingId: id,
        roomId: booking.roomId,
        customerName: booking.customer.name,
        lateCheckoutCharge,
        roomCharges,
        extraCharges,
        foodCharges,
        totalPaidBeforeFinal,
        totalAmount,
        finalPayment,
        finalDueAmount,
        invoiceId: generatedInvoiceId,
      })
    );

    return successResponse(
      {
        booking: updatedBooking,
        invoiceId: generatedInvoiceId,
      },
      'Check-out successful and invoice generated'
    );
  } catch (error) {
    console.error('Check-out error:', error);
    return errorResponse('Failed to check out', 500);
  }
}
