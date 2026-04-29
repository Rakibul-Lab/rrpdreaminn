import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole, canAccessHotel } from '@/lib/auth';
import { successResponse, errorResponse, paginatedResponse, notFoundResponse, logActivity, generateInvoiceNumber } from '@/lib/api-utils';
import { InvoiceStatus } from '@prisma/client';

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

    // Get VAT rate from settings (default 15%)
    let vatPercent = 15;
    const vatSetting = await db.setting.findUnique({ where: { key: 'vat_percent' } });
    if (vatSetting) {
      vatPercent = parseFloat(vatSetting.value) || 15;
    }

    // Hotel discount from settings (applied only to hotel part)
    let discount = 0;
    const discountSetting = await db.setting.findUnique({ where: { key: 'default_discount_percent' } });
    if (discountSetting) {
      discount = hotelBase * (parseFloat(discountSetting.value) || 0) / 100;
    }

    const hotelVat = (hotelBase - discount) * vatPercent / 100;
    const vatAmount = hotelVat + restaurantVat;
    const foodCharges = restaurantNet;
    const subtotal = hotelBase + restaurantNet;
    const totalAmount = (hotelBase - discount + hotelVat) + restaurantTotal;

    // Calculate paid amount from all payments linked to this booking
    const paidAmount = booking.payments.reduce((sum, p) => sum + p.amount, 0);
    const dueAmount = totalAmount - paidAmount;

    // Determine status based on dueAmount
    const status: InvoiceStatus = dueAmount <= 0 ? 'PAID' : 'ISSUED';

    // Generate invoice number
    const invoiceNumber = generateInvoiceNumber();

    // Create invoice with items in a transaction
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

      // Rebuild line items so repeated generation always syncs with latest room-service orders/charges.
      await tx.invoiceItem.deleteMany({
        where: { invoiceId: inv.id },
      });

      // Create invoice items for room charges
      const roomRateCharges = booking.charges.filter((c) => c.chargeType === 'ROOM_RATE');
      if (roomRateCharges.length > 0) {
        for (const charge of roomRateCharges) {
          await tx.invoiceItem.create({
            data: {
              invoiceId: inv.id,
              itemType: 'room_charge',
              referenceId: charge.id,
              description: charge.description || `Room Rate - ${booking.room.roomNumber}`,
              quantity: charge.quantity,
              unitPrice: charge.amount,
              total: charge.amount * charge.quantity,
            },
          });
        }
      } else if (booking.totalRoomCharge > 0) {
        // If no individual room charge entries, create one from booking totalRoomCharge
        const nights = Math.max(1, Math.ceil(
          (new Date(booking.checkOut).getTime() - new Date(booking.checkIn).getTime()) / (1000 * 60 * 60 * 24)
        ));
        const ratePerNight = booking.totalRoomCharge / nights;
        await tx.invoiceItem.create({
          data: {
            invoiceId: inv.id,
            itemType: 'room_charge',
            description: `Room ${booking.room.roomNumber} (${booking.room.type?.name || ''}) - ${nights} night${nights > 1 ? 's' : ''}`,
            quantity: nights,
            unitPrice: ratePerNight,
            total: booking.totalRoomCharge,
          },
        });
      }

      // Create invoice items for extra charges
      for (const charge of booking.charges.filter((c) => c.chargeType !== 'ROOM_RATE')) {
        await tx.invoiceItem.create({
          data: {
            invoiceId: inv.id,
            itemType: 'extra_service',
            referenceId: charge.id,
            description: charge.description,
            quantity: charge.quantity,
            unitPrice: charge.amount,
            total: charge.amount * charge.quantity,
          },
        });
      }

      // Create invoice items for restaurant orders
      for (const order of restaurantOrders) {
        for (const item of order.items) {
          await tx.invoiceItem.create({
            data: {
              invoiceId: inv.id,
              itemType: 'food_order',
              referenceId: item.id,
              description: item.menuItem.name,
              quantity: item.quantity,
              unitPrice: item.price,
              total: item.price * item.quantity,
            },
          });
        }
      }

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
