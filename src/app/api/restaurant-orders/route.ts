import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, requireRole, canAccessRestaurant } from '@/lib/auth';
import {
  successResponse,
  errorResponse,
  paginatedResponse,
  notFoundResponse,
  logActivity,
  generateOrderNumber,
} from '@/lib/api-utils';
import { Prisma, RoleType } from '@prisma/client';

// Helper to filter order data based on user role
function filterOrderByRole(order: Record<string, unknown>, role: RoleType) {
  if (role === 'ADMIN' || role === 'HOTEL_STAFF') {
    // Full access - return everything
    return order;
  }

  // RESTAURANT_STAFF: Only room number + order data, no guest details via booking
  const filtered = { ...order };
  if (filtered.booking && typeof filtered.booking === 'object' && filtered.booking !== null) {
    const bookingObj = filtered.booking as Record<string, unknown>;
    filtered.booking = {
      id: bookingObj.id,
      // No customer details exposed to restaurant staff
    };
  }
  return filtered;
}

// GET /api/restaurant-orders - List orders with filters, paginated
export async function GET(request: NextRequest) {
  try {
    const authResult = requireAuth(request);
    if (authResult instanceof Response) return authResult;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const orderType = searchParams.get('orderType');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const roomId = searchParams.get('roomId');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.max(1, Math.min(100, parseInt(searchParams.get('limit') || '20')));

    const where: Prisma.RestaurantOrderWhereInput = {};

    if (status) {
      where.status = status as Prisma.EnumOrderStatusFilter;
    }

    if (orderType) {
      where.orderType = orderType as Prisma.EnumOrderTypeFilter;
    }

    if (roomId) {
      where.roomId = roomId;
    }

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) {
        (where.createdAt as Prisma.DateTimeFilter).gte = new Date(dateFrom);
      }
      if (dateTo) {
        (where.createdAt as Prisma.DateTimeFilter).lte = new Date(dateTo);
      }
    }

    const include: Prisma.RestaurantOrderInclude = {
      items: {
        include: {
          menuItem: {
            select: {
              id: true,
              name: true,
              price: true,
              isVeg: true,
            },
          },
        },
      },
      room: {
        select: {
          id: true,
          roomNumber: true,
          status: true,
        },
      },
      table: {
        select: {
          id: true,
          tableNumber: true,
          capacity: true,
          status: true,
        },
      },
      creator: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    };

    // HOTEL_STAFF and ADMIN can see booking with customer details
    if (authResult.role === 'ADMIN' || authResult.role === 'HOTEL_STAFF') {
      include.booking = {
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
        },
      };
    } else {
      // RESTAURANT_STAFF: only see booking id, no customer details
      include.booking = {
        select: {
          id: true,
        },
      };
    }

    const [orders, total] = await Promise.all([
      db.restaurantOrder.findMany({
        where,
        include,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.restaurantOrder.count({ where }),
    ]);

    // Filter data based on role
    const filteredOrders = orders.map((order) =>
      filterOrderByRole(order as unknown as Record<string, unknown>, authResult.role)
    );

    return paginatedResponse(filteredOrders, total, page, limit);
  } catch (error) {
    console.error('Error fetching restaurant orders:', error);
    return errorResponse('Failed to fetch restaurant orders', 500);
  }
}

// POST /api/restaurant-orders - Create order (ADMIN and RESTAURANT_STAFF only)
export async function POST(request: NextRequest) {
  try {
    const authResult = requireRole(request, 'ADMIN', 'RESTAURANT_STAFF');
    if (authResult instanceof Response) return authResult;

    const body = await request.json();
    const {
      orderType,
      roomId,
      tableId,
      customerName,
      customerPhone,
      notes,
      items,
      vatPercent,
      discount,
    } = body;

    // Validate order type
    const validOrderTypes = ['DINE_IN', 'TAKEAWAY', 'ROOM_SERVICE'];
    if (!orderType || !validOrderTypes.includes(orderType)) {
      return errorResponse(`Order type is required and must be one of: ${validOrderTypes.join(', ')}`);
    }

    // Validate items
    if (!items || !Array.isArray(items) || items.length === 0) {
      return errorResponse('At least one order item is required');
    }

    // Validate each item
    for (const item of items) {
      if (!item.menuItemId) {
        return errorResponse('Each item must have a menuItemId');
      }
      if (!item.quantity || item.quantity < 1) {
        return errorResponse('Each item must have a quantity of at least 1');
      }
    }

    let bookingId: string | null = null;

    // CRITICAL: Room service validation
    if (orderType === 'ROOM_SERVICE') {
      if (!roomId) {
        return errorResponse('Room ID is required for room service orders');
      }

      // Validate that the room is currently OCCUPIED
      const room = await db.room.findUnique({ where: { id: roomId } });
      if (!room) {
        return notFoundResponse('Room');
      }

      if (room.status !== 'OCCUPIED') {
        return errorResponse('Room is not currently occupied');
      }

      // Auto-link to the current active booking (CHECKED_IN) for that room
      const activeBooking = await db.booking.findFirst({
        where: {
          roomId,
          status: 'CHECKED_IN',
        },
      });

      if (activeBooking) {
        bookingId = activeBooking.id;
      }
    }

    // DINE_IN: validate table
    if (orderType === 'DINE_IN') {
      if (!tableId) {
        return errorResponse('Table ID is required for dine-in orders');
      }

      const table = await db.restaurantTable.findUnique({ where: { id: tableId } });
      if (!table) {
        return notFoundResponse('Restaurant table');
      }
    }

    // Verify all menu items exist and get prices
    const menuItemIds = items.map((item: { menuItemId: string }) => item.menuItemId);
    const menuItems = await db.menuItem.findMany({
      where: { id: { in: menuItemIds } },
    });

    if (menuItems.length !== menuItemIds.length) {
      const foundIds = new Set(menuItems.map((mi) => mi.id));
      const missingIds = menuItemIds.filter((id: string) => !foundIds.has(id));
      return errorResponse(`Menu items not found: ${missingIds.join(', ')}`);
    }

    // Check if all items are available
    const unavailableItems = menuItems.filter((mi) => !mi.available);
    if (unavailableItems.length > 0) {
      return errorResponse(
        `The following items are not available: ${unavailableItems.map((mi) => mi.name).join(', ')}`
      );
    }

    const menuItemMap = new Map(menuItems.map((mi) => [mi.id, mi]));

    // Calculate subtotal from items
    let subtotal = 0;
    const orderItemsData = items.map((item: { menuItemId: string; quantity: number; notes?: string }) => {
      const menuItem = menuItemMap.get(item.menuItemId)!;
      const itemTotal = menuItem.price * item.quantity;
      subtotal += itemTotal;

      return {
        menuItemId: item.menuItemId,
        quantity: item.quantity,
        price: menuItem.price,
        notes: item.notes || null,
        kotStatus: 'pending',
      };
    });

    // Calculate VAT and total
    const vatRate = vatPercent !== undefined ? Number(vatPercent) : 15;
    const discountAmount = discount !== undefined ? Number(discount) : 0;
    const vatAmount = ((subtotal - discountAmount) * vatRate) / 100;
    const totalAmount = subtotal - discountAmount + vatAmount;

    // Generate order number
    const orderNumber = generateOrderNumber();

    // Create order with items in a transaction
    const order = await db.$transaction(async (tx) => {
      const newOrder = await tx.restaurantOrder.create({
        data: {
          orderNumber,
          orderType,
          status: 'PENDING',
          roomId: orderType === 'ROOM_SERVICE' ? roomId : null,
          tableId: orderType === 'DINE_IN' ? tableId : null,
          bookingId,
          customerName: orderType === 'TAKEAWAY' ? customerName : null,
          customerPhone: orderType === 'TAKEAWAY' ? customerPhone : null,
          subtotal,
          discount: discountAmount,
          vatAmount,
          vatPercent: vatRate,
          totalAmount,
          notes: notes || null,
          createdBy: authResult.id,
          items: {
            create: orderItemsData,
          },
        },
        include: {
          items: {
            include: {
              menuItem: {
                select: {
                  id: true,
                  name: true,
                  price: true,
                  isVeg: true,
                },
              },
            },
          },
          room: {
            select: {
              id: true,
              roomNumber: true,
              status: true,
            },
          },
          table: {
            select: {
              id: true,
              tableNumber: true,
              status: true,
            },
          },
        },
      });

      // For DINE_IN, update table status to 'occupied'
      if (orderType === 'DINE_IN' && tableId) {
        await tx.restaurantTable.update({
          where: { id: tableId },
          data: { status: 'occupied' },
        });
      }

      // For room service linked with an active booking, add order total to booking due immediately.
      if (orderType === 'ROOM_SERVICE' && bookingId) {
        const booking = await tx.booking.findUnique({ where: { id: bookingId } });
        if (booking) {
          await tx.booking.update({
            where: { id: bookingId },
            data: { dueAmount: booking.dueAmount + totalAmount },
          });
        }
      }

      return newOrder;
    });

    await logActivity(
      authResult.id,
      'CREATE_RESTAURANT_ORDER',
      'restaurant',
      `Created order ${orderNumber} (${orderType}), total: ${totalAmount}`
    );

    return successResponse(order, 'Order created successfully', 201);
  } catch (error) {
    console.error('Error creating restaurant order:', error);
    return errorResponse('Failed to create restaurant order', 500);
  }
}
