import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole, canAccessHotel } from '@/lib/auth';
import { successResponse, errorResponse, paginatedResponse, notFoundResponse, logActivity, generateInvoiceNumber } from '@/lib/api-utils';
import { InvoiceStatus } from '@prisma/client';
import { bookingVatOptions, sumBookingNetPaid } from '@/lib/booking-totals';
import { buildInvoiceLineItems, replaceInvoiceLineItems } from '@/lib/invoice-line-items';

// GET /api/invoices - List invoices with filters
export async function GET(request: NextRequest) {
  try {
    const authResult = requireRole(request, 'ADMIN', 'HOTEL_STAFF');
    if (authResult instanceof Response) return authResult;

    const { searchParams } = new URL(request.url);

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const bookingId = searchParams.get('bookingId');
    const status = searchParams.get('status') as InvoiceStatus | null;

    const skip = (page - 1) * limit;

    // Build where clause
    const where: Record<string, unknown> = {};

    if (bookingId) {
      where.bookingId = bookingId;
    }

    if (status) {
      where.status = status;
    }

    const [invoices, total] = await Promise.all([
      db.invoice.findMany({
        where,
        include: {
          booking: {
            select: {
              id: true,
              checkIn: true,
              checkOut: true,
              status: true,
              customer: {
                select: { id: true, name: true, phone: true, email: true },
              },
              room: {
                select: { id: true, roomNumber: true, type: { select: { name: true } } },
              },
            },
          },
          items: {
            select: {
              id: true,
              itemType: true,
              description: true,
              quantity: true,
              unitPrice: true,
              total: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      db.invoice.count({ where }),
    ]);

    return paginatedResponse(invoices, total, page, limit);
  } catch (error) {
    console.error('Error listing invoices:', error);
    return errorResponse('Failed to fetch invoices', 500);
  }
}

// POST /api/invoices - Generate unified invoice for a booking
export async function POST(request: NextRequest) {
  try {
    const authResult = requireRole(request, 'ADMIN', 'HOTEL_STAFF');
    if (authResult instanceof Response) return authResult;

    const user = authResult;
    const body = await request.json();
    const { bookingId } = body;

    if (!bookingId) {
      return errorResponse('Booking ID is required');
    }

    // Fetch booking with customer and room
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      include: {
        customer: true,
        room: {
          include: { type: true },
        },
        charges: true,
        payments: true,
      },
    });

    if (!booking) {
      return notFoundResponse('Booking');
    }

    // Check if an invoice already exists for this booking (non-cancelled)
    const existingInvoice = await db.invoice.findFirst({
      where: {
        bookingId,
        status: { not: 'CANCELLED' },
      },
    });

    // Auto-fetch all room charges for the booking
    // Include both individual RoomCharge entries and the booking's totalRoomCharge
    const individualRoomCharges = booking.charges
      .filter((c) => c.chargeType === 'ROOM_RATE')
      .reduce((sum, c) => sum + c.amount * c.quantity, 0);

    const extraCharges = booking.charges
      .filter((c) => c.chargeType !== 'ROOM_RATE')
      .reduce((sum, c) => sum + c.amount * c.quantity, 0);

    // Use booking's totalRoomCharge if no individual room charge entries exist
    const roomCharges = individualRoomCharges > 0 ? individualRoomCharges : booking.totalRoomCharge;

    // Auto-fetch all restaurant orders linked to the booking
    const restaurantOrders = await db.restaurantOrder.findMany({
      where: {
        bookingId,
        status: { not: 'CANCELLED' },
      },
      include: {
        items: {
          include: {
            menuItem: { select: { name: true } },
          },
        },
      },
    });

    // Restaurant financials (from order source of truth)
    const restaurantNet = restaurantOrders.reduce(
      (sum, order) => sum + Math.max(0, order.subtotal - order.discount),
      0
    );
    const restaurantVat = restaurantOrders.reduce((sum, order) => sum + order.vatAmount, 0);
    const restaurantTotal = restaurantOrders.reduce((sum, order) => sum + order.totalAmount, 0);

    // Hotel taxable base
    const hotelBase = roomCharges + extraCharges;

    const vatOpts = bookingVatOptions(booking);
    const vatApplied = vatOpts.vatApplied !== false;
    const vatPercent = vatApplied ? Math.max(0, vatOpts.vatPercent ?? 0) : 0;

    const { computeHotelDiscountAmount, parseBookingDiscountType } = await import(
      '@/lib/booking-discount'
    );
    const discount = computeHotelDiscountAmount(
      hotelBase,
      booking.discountEnabled === true,
      parseBookingDiscountType(booking.discountType),
      Number(booking.discountValue) || 0
    );

    const hotelVat =
      vatPercent > 0 ? ((hotelBase - discount) * vatPercent) / 100 : 0;
    const vatAmount = hotelVat + restaurantVat;
    const foodCharges = restaurantNet;
    const subtotal = hotelBase + restaurantNet;
    const totalAmount = (hotelBase - discount + hotelVat) + restaurantTotal;

    // Calculate paid amount from all payments linked to this booking
    const paidAmount = sumBookingNetPaid(booking.payments);
    const dueAmount = totalAmount - paidAmount;

    // Determine status based on dueAmount
    const status: InvoiceStatus = dueAmount <= 0 ? 'PAID' : 'ISSUED';

    // Generate invoice number
    const invoiceNumber = generateInvoiceNumber();

    const lineItems = buildInvoiceLineItems({
      roomNumber: booking.room.roomNumber,
      roomTypeName: booking.room.type?.name || '',
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      charges: booking.charges,
      restaurantOrders,
      roomCharges,
      includeExtraCharges: true,
      discount,
      hotelVat,
      hotelVatPercent: vatPercent,
      vatApplied,
      restaurantVat,
    });

    const invoice = await db.$transaction(async (tx) => {
      const inv = existingInvoice
        ? await tx.invoice.update({
            where: { id: existingInvoice.id },
            data: {
              roomCharges,
              foodCharges,
              extraCharges,
              subtotal,
              discount,
              vatAmount,
              totalAmount,
              paidAmount,
              dueAmount: Math.max(0, dueAmount),
              status,
              issuedAt: existingInvoice.issuedAt || new Date(),
              paidAt: status === 'PAID' ? new Date() : null,
            },
          })
        : await tx.invoice.create({
            data: {
              invoiceNumber,
              bookingId,
              roomCharges,
              foodCharges,
              extraCharges,
              subtotal,
              discount,
              vatAmount,
              totalAmount,
              paidAmount,
              dueAmount: Math.max(0, dueAmount),
              status,
              issuedAt: new Date(),
              paidAt: status === 'PAID' ? new Date() : null,
            },
          });

      await replaceInvoiceLineItems(tx, inv.id, lineItems);
      return inv;
    });

    // Fetch the complete invoice with items
    const completeInvoice = await db.invoice.findUnique({
      where: { id: invoice.id },
      include: {
        booking: {
          include: {
            customer: true,
            room: { include: { type: true } },
          },
        },
        items: true,
        payments: true,
      },
    });

    // Log activity
    await logActivity(
      user.id,
      'INVOICE_GENERATED',
      'billing',
      JSON.stringify({
        invoiceId: invoice.id,
        invoiceNumber,
        bookingId,
        totalAmount,
        dueAmount: Math.max(0, dueAmount),
        status,
      })
    );

    return successResponse(
      completeInvoice,
      existingInvoice ? 'Invoice updated successfully' : 'Invoice generated successfully',
      existingInvoice ? 200 : 201
    );
  } catch (error) {
    console.error('Error generating invoice:', error);
    return errorResponse('Failed to generate invoice', 500);
  }
}
