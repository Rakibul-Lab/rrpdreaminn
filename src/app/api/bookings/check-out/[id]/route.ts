import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { successResponse, errorResponse, notFoundResponse, logActivity, generateInvoiceNumber } from '@/lib/api-utils';
import { RoleType } from '@prisma/client';
import {
  parsePaymentMethod,
  paymentRequiresLastFour,
  paymentRequiresReference,
  isValidPaymentAccountLastFour,
} from '@/lib/payment-method';
import { computeLateCheckoutFee } from '@/lib/app-settings';
import { sumBookingNetPaid } from '@/lib/booking-totals';
import {
  bookingDueAfterPayments,
  computeCheckoutSettlement,
} from '@/lib/checkout-settlement';
import { buildInvoiceLineItems, replaceInvoiceLineItems } from '@/lib/invoice-line-items';
import {
  buildCheckoutInvoiceLineItems,
  completeOutboundBillTransfer,
  loadBillTransferTargets,
  loadInboundBillTransfers,
  mergeCreditTransferSettlements,
  parseCreditTransferBookingIds,
  prepareCreditTransfers,
} from '@/lib/room-credit-transfer';
import { postCompanyLedgerBill } from '@/lib/company-ledger-billing';

async function loadCheckoutBooking(id: string) {
  return db.booking.findUnique({
    where: { id },
    include: {
      room: { include: { type: true } },
      customer: true,
      charges: true,
      companyLedger: { select: { id: true, name: true } },
    },
  });
}

function companyLedgerCheckoutFields(booking: {
  companyLedgerId?: string | null;
  companyLedger?: { id: string; name: string } | null;
}) {
  const billToCompanyLedger = !!booking.companyLedgerId;
  return {
    companyLedgerId: booking.companyLedgerId ?? null,
    companyLedgerName: booking.companyLedger?.name ?? null,
    billToCompanyLedger,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType);
    if (authResult instanceof Response) return authResult;

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const adjustStayEnabled = searchParams.get('adjustStay') === 'true';
    const chargeableNightsParam = searchParams.get('chargeableNights');
    const chargeableNights =
      chargeableNightsParam != null ? parseInt(chargeableNightsParam, 10) : null;
    const stayAdjustmentMode =
      searchParams.get('stayMode') === 'extend' ? ('extend' as const) : ('shrink' as const);
    const includeExtraCharges = searchParams.get('includeExtraCharges') !== 'false';
    const includeDamageCharge = searchParams.get('includeDamageCharge') === 'true';
    const damageChargeAmount = includeDamageCharge
      ? Math.max(0, Number(searchParams.get('damageChargeAmount') || 0))
      : 0;
    const includeDiscount = searchParams.get('includeDiscount') === 'true';
    const discountType = searchParams.get('discountType') === 'FIXED' ? 'FIXED' : 'PERCENTAGE';
    const discountValue = includeDiscount
      ? Math.max(0, Number(searchParams.get('discountValue') || 0))
      : 0;
    const roomCreditTransferEnabled = searchParams.get('roomCreditTransferEnabled') === 'true';
    const creditTransferBookingIds = roomCreditTransferEnabled
      ? parseCreditTransferBookingIds(searchParams.get('creditTransferBookingIds'))
      : [];

    const booking = await loadCheckoutBooking(id);
    if (!booking) return notFoundResponse('Booking');
    if (booking.status !== 'CHECKED_IN') {
      return errorResponse('Only checked-in bookings can be checked out');
    }

    const now = new Date();
    const { amount: lateCheckoutCharge } = await computeLateCheckoutFee(booking.checkOut, now);
    const restaurantOrders = await db.restaurantOrder.findMany({
      where: { bookingId: id, status: { not: 'CANCELLED' } },
    });
    const bookingPayments = await db.payment.findMany({
      where: { bookingId: id },
      select: { amount: true, paymentType: true },
    });

    const primarySettlement = computeCheckoutSettlement({
      booking,
      nightlyRate: booking.room.type.basePrice,
      restaurantOrders,
      lateCheckoutCharge,
      payments: bookingPayments,
      discountEnabled: includeDiscount,
      discountType,
      discountValue,
      includeExtraCharges,
      damageChargeAmount,
      asOf: now,
    });

    if (roomCreditTransferEnabled && creditTransferBookingIds.length > 0) {
      const { targets, error } = await loadBillTransferTargets(
        db,
        id,
        creditTransferBookingIds,
        !!booking.billTransferredToBookingId
      );
      if (error) return errorResponse(error);
      const target = targets[0];
      return successResponse({
        bookingId: id,
        customerName: booking.customer.name,
        roomNumber: booking.room.roomNumber,
        roomTypeName: booking.room.type.name,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        actualCheckIn: booking.actualCheckIn,
        checkoutAt: now,
        ...primarySettlement,
        billTransferOut: true,
        billTransferTarget: {
          bookingId: target.id,
          roomNumber: target.room.roomNumber,
          roomTypeName: target.room.type.name,
          customerName: target.customer.name,
        },
        transferAmount: primarySettlement.dueBeforeSettlement,
        dueBeforeSettlement: 0,
        creditAmount: 0,
      });
    }

    const inboundSources = await loadInboundBillTransfers(db, id);
    const inboundTransfers = await prepareCreditTransfers(db, inboundSources, now);
    const hasInboundTransfers = inboundTransfers.length > 0;

    const settlement = hasInboundTransfers
      ? mergeCreditTransferSettlements(primarySettlement, inboundTransfers, {
          payingBooking: booking,
          discountEnabled: includeDiscount,
          discountType,
          discountValue,
          primaryPayments: bookingPayments,
        })
      : primarySettlement;

    return successResponse({
      bookingId: id,
      customerName: booking.customer.name,
      roomNumber: booking.room.roomNumber,
      roomTypeName: booking.room.type.name,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      actualCheckIn: booking.actualCheckIn,
      checkoutAt: now,
      ...settlement,
      ...companyLedgerCheckoutFields(booking),
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
    const paymentMethod = parsePaymentMethod(body?.paymentMethod, 'CASH');
    const paymentReference = body?.paymentReference
      ? String(body.paymentReference).trim()
      : null;
    const paymentAccountLastFour = body?.paymentAccountLastFour
      ? String(body.paymentAccountLastFour).trim()
      : null;
    const paymentNotes = body?.paymentNotes || null;
    const includeExtraCharges = body?.includeExtraCharges !== false;
    const includeDamageCharge = body?.includeDamageCharge === true;
    const damageChargeAmount = includeDamageCharge
      ? Math.max(0, Number(body?.damageChargeAmount || 0))
      : 0;
    const includeDiscount = body?.includeDiscount === true;
    const discountType = body?.discountType === 'FIXED' ? 'FIXED' : 'PERCENTAGE';
    const discountValue = includeDiscount
      ? Math.max(0, Number(body?.discountValue || 0))
      : 0;
    const roomCreditTransferEnabled = body?.roomCreditTransferEnabled === true;
    const creditTransferBookingIds = roomCreditTransferEnabled
      ? parseCreditTransferBookingIds(body?.creditTransferBookingIds)
      : [];

    const booking = await loadCheckoutBooking(id);
    if (!booking) return notFoundResponse('Booking');
    if (booking.status !== 'CHECKED_IN') {
      return errorResponse('Only checked-in bookings can be checked out');
    }

    await db.booking.update({
      where: { id },
      data: {
        discountEnabled: includeDiscount,
        discountType: includeDiscount ? discountType : null,
        discountValue: includeDiscount ? discountValue : 0,
      },
    });

    const now = new Date();
    const { amount: lateCheckoutCharge, hoursLate } = await computeLateCheckoutFee(
      booking.checkOut,
      now
    );

    if (includeExtraCharges && lateCheckoutCharge > 0) {
      const hasLateCharge = booking.charges.some((c) => c.chargeType === 'LATE_CHECKOUT');
      if (!hasLateCharge) {
        await db.roomCharge.create({
          data: {
            bookingId: id,
            chargeType: 'LATE_CHECKOUT',
            description: `Late checkout - ${hoursLate} hour(s) after scheduled time`,
            amount: lateCheckoutCharge,
            quantity: 1,
            chargeDate: now,
          },
        });
      }
      booking.charges = await db.roomCharge.findMany({ where: { bookingId: id } });
    }

    if (!includeDamageCharge) {
      await db.roomCharge.deleteMany({
        where: { bookingId: id, chargeType: 'DAMAGE' },
      });
      booking.charges = await db.roomCharge.findMany({ where: { bookingId: id } });
    } else if (damageChargeAmount > 0) {
      const existingDamage = booking.charges.find((c) => c.chargeType === 'DAMAGE');
      if (existingDamage) {
        await db.roomCharge.update({
          where: { id: existingDamage.id },
          data: { amount: damageChargeAmount, description: 'Damage charges' },
        });
      } else {
        await db.roomCharge.create({
          data: {
            bookingId: id,
            chargeType: 'DAMAGE',
            description: 'Damage charges',
            amount: damageChargeAmount,
            quantity: 1,
            chargeDate: now,
          },
        });
      }
      booking.charges = await db.roomCharge.findMany({ where: { bookingId: id } });
    }

    const restaurantOrders = await db.restaurantOrder.findMany({
      where: { bookingId: id, status: { not: 'CANCELLED' } },
    });
    let bookingPayments = await db.payment.findMany({
      where: { bookingId: id },
      select: { amount: true, paymentType: true },
    });

    const primarySettlement = computeCheckoutSettlement({
      booking,
      nightlyRate: booking.room.type.basePrice,
      restaurantOrders,
      lateCheckoutCharge,
      payments: bookingPayments,
      discountEnabled: includeDiscount,
      discountType,
      discountValue,
      includeExtraCharges,
      damageChargeAmount: includeDamageCharge ? damageChargeAmount : 0,
      asOf: now,
    });

    if (roomCreditTransferEnabled && creditTransferBookingIds.length > 0) {
      const { targets, error } = await loadBillTransferTargets(
        db,
        id,
        creditTransferBookingIds,
        !!booking.billTransferredToBookingId
      );
      if (error) return errorResponse(error);
      const target = targets[0];

      await completeOutboundBillTransfer(
        db,
        booking as Parameters<typeof completeOutboundBillTransfer>[1],
        target.id,
        target.room.roomNumber,
        now
      );

      await logActivity(
        authUser.id,
        'CHECK_OUT',
        'hotel',
        JSON.stringify({
          bookingId: id,
          roomId: booking.roomId,
          customerName: booking.customer.name,
          billTransferOut: true,
          billTransferTargetBookingId: target.id,
          billTransferTargetRoomNumber: target.room.roomNumber,
          transferAmount: primarySettlement.dueBeforeSettlement,
        })
      );

      return successResponse(
        {
          billTransferOut: true,
          targetRoomNumber: target.room.roomNumber,
          transferAmount: primarySettlement.dueBeforeSettlement,
        },
        `Room ${booking.room.roomNumber} checked out. Bill transferred to Room ${target.room.roomNumber}.`
      );
    }

    const inboundSources = await loadInboundBillTransfers(db, id);
    const inboundTransfers = await prepareCreditTransfers(db, inboundSources, now);
    const hasInboundTransfers = inboundTransfers.length > 0;

    const settlement = hasInboundTransfers
      ? mergeCreditTransferSettlements(primarySettlement, inboundTransfers, {
          payingBooking: booking,
          discountEnabled: includeDiscount,
          discountType,
          discountValue,
          primaryPayments: bookingPayments,
        })
      : primarySettlement;

    const {
      roomCharges,
      foodCharges,
      extraCharges,
      subtotal,
      discount,
      vatAmount,
      totalAmount,
      totalPaid: totalPaidBeforeFinal,
      dueBeforeSettlement: finalDueAmount,
      creditAmount,
      chargeableNights: settledNights,
      nightlyRate,
      hotelVat,
      restaurantVat,
      vatApplied,
      vatPercent,
    } = settlement;

    const isCompanyLedgerCheckout = !!booking.companyLedgerId;

    if (finalPayment > finalDueAmount + 0.01) {
      return errorResponse(
        `Payment cannot exceed due amount. Maximum: ৳${finalDueAmount.toFixed(2)}`
      );
    }

    if (
      !isCompanyLedgerCheckout &&
      finalDueAmount > 0.01 &&
      finalPayment + 0.01 < finalDueAmount
    ) {
      return errorResponse(
        `Due amount must be fully cleared to checkout. Required: ৳${finalDueAmount.toFixed(2)}`
      );
    }

    if (finalPayment > 0) {
      if (paymentRequiresReference(paymentMethod) && !paymentReference) {
        return errorResponse('Payment reference is required for this payment method');
      }
      if (
        paymentRequiresLastFour(paymentMethod) &&
        (!paymentAccountLastFour || !isValidPaymentAccountLastFour(paymentAccountLastFour))
      ) {
        return errorResponse('Last 4 digits are required for card / bKash / Nagad / Upay');
      }

      await db.payment.create({
        data: {
          amount: finalPayment,
          method: paymentMethod,
          paymentType: 'FINAL',
          bookingId: id,
          receivedBy: authUser.id,
          reference: paymentRequiresReference(paymentMethod) ? paymentReference : null,
          accountLastFour: paymentRequiresLastFour(paymentMethod)
            ? paymentAccountLastFour
            : null,
          notes: paymentNotes || 'Final payment at check-out',
        },
      });
      bookingPayments = await db.payment.findMany({
        where: { bookingId: id },
        select: { amount: true, paymentType: true },
      });
    }

    const totalPaidAfter = sumBookingNetPaid(bookingPayments);
    const guestDueAmount = isCompanyLedgerCheckout
      ? 0
      : bookingDueAfterPayments(booking.totalRoomCharge, totalPaidAfter, booking);

    const updatedBooking = await db.booking.update({
      where: { id },
      data: {
        status: 'CHECKED_OUT',
        actualCheckOut: now,
        dueAmount: guestDueAmount,
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

    await db.room.update({
      where: { id: booking.roomId },
      data: { status: 'CLEANING' },
    });

    await db.housekeepingTask.create({
      data: {
        roomId: booking.roomId,
        taskType: 'cleaning',
        status: 'PENDING',
        notes: `Post-checkout cleaning for room ${booking.room.roomNumber}`,
      },
    });

    const existingInvoice = await db.invoice.findFirst({
      where: { bookingId: id, status: { not: 'CANCELLED' } },
    });

    const restaurantOrdersWithItems = await db.restaurantOrder.findMany({
      where: { bookingId: id, status: { not: 'CANCELLED' } },
      include: {
        items: {
          include: { menuItem: { select: { name: true } } },
        },
      },
    });

    const lineItems = hasInboundTransfers
      ? buildCheckoutInvoiceLineItems(
          {
            roomNumber: updatedBooking.room.roomNumber,
            roomTypeName: updatedBooking.room.type.name,
            checkIn: updatedBooking.checkIn,
            checkOut: updatedBooking.checkOut,
            charges: updatedBooking.charges,
            restaurantOrders: restaurantOrdersWithItems,
            roomCharges: primarySettlement.roomCharges,
            chargeableNights: primarySettlement.chargeableNights,
            nightlyRate: primarySettlement.nightlyRate,
            stayAdjusted: primarySettlement.stayAdjusted,
            includeExtraCharges,
          },
          inboundTransfers,
          discount,
          hotelVat,
          vatPercent,
          vatApplied
        )
      : buildInvoiceLineItems({
          roomNumber: updatedBooking.room.roomNumber,
          roomTypeName: updatedBooking.room.type.name,
          checkIn: updatedBooking.checkIn,
          checkOut: updatedBooking.checkOut,
          charges: updatedBooking.charges,
          restaurantOrders: restaurantOrdersWithItems,
          roomCharges,
          chargeableNights: settledNights,
          nightlyRate,
          stayAdjusted: settlement.stayAdjusted,
          includeExtraCharges,
          discount,
          hotelVat,
          hotelVatPercent: vatPercent,
          vatApplied,
          restaurantVat,
        });

    const paidAmount = totalPaidAfter;
    const invoiceDue = Math.max(0, totalAmount - paidAmount);
    const invoiceStatus = invoiceDue <= 0 ? 'PAID' : 'ISSUED';
    const companyLedgerDue = isCompanyLedgerCheckout ? invoiceDue : 0;

    const invoicePayload = {
      roomCharges,
      foodCharges,
      extraCharges,
      subtotal,
      discount,
      vatAmount,
      totalAmount,
      paidAmount,
      dueAmount: invoiceDue,
      status: invoiceStatus,
      issuedAt: now,
      paidAt: invoiceStatus === 'PAID' ? now : null,
    };

    let generatedInvoiceId: string | null = null;
    await db.$transaction(async (tx) => {
      if (existingInvoice) {
        await tx.invoice.update({
          where: { id: existingInvoice.id },
          data: invoicePayload,
        });
        await replaceInvoiceLineItems(tx, existingInvoice.id, lineItems);
        generatedInvoiceId = existingInvoice.id;
      } else {
        const invoice = await tx.invoice.create({
          data: {
            invoiceNumber: generateInvoiceNumber(),
            bookingId: id,
            ...invoicePayload,
          },
        });
        await replaceInvoiceLineItems(tx, invoice.id, lineItems);
        generatedInvoiceId = invoice.id;
      }
    });

    if (isCompanyLedgerCheckout && booking.companyLedgerId) {
      await postCompanyLedgerBill(db, {
        companyLedgerId: booking.companyLedgerId,
        bookingId: id,
        invoiceId: generatedInvoiceId,
        guestName: booking.customer.name,
        roomNumber: booking.room.roomNumber,
        totalAmount,
        paidAmount,
        dueAmount: companyLedgerDue,
        notes:
          companyLedgerDue > 0
            ? `Checkout bill — ৳${companyLedgerDue.toFixed(2)} due on company ledger`
            : 'Checkout bill — fully paid',
      });
    }

    await logActivity(
      authUser.id,
      'CHECK_OUT',
      'hotel',
      JSON.stringify({
        bookingId: id,
        roomId: booking.roomId,
        customerName: booking.customer.name,
        chargeableNights: settledNights,
        bookedNights: settlement.bookedNights,
        actualStayNights: settlement.actualStayNights,
        lateCheckoutCharge,
        damageCharge: settlement.damageCharge,
        roomCharges,
        totalAmount,
        finalPayment,
        finalDueAmount,
        creditAmount,
        invoiceId: generatedInvoiceId,
        companyLedgerId: booking.companyLedgerId,
        companyLedgerDue,
        inboundBillTransferBookingIds: inboundTransfers.map((t) => t.booking.id),
        inboundBillTransferRoomNumbers: inboundTransfers.map((t) => t.booking.room.roomNumber),
      })
    );

    const successMessage = isCompanyLedgerCheckout
      ? companyLedgerDue > 0
        ? `Check-out complete. ৳${companyLedgerDue.toFixed(2)} billed to ${booking.companyLedger?.name ?? 'company ledger'}.`
        : `Check-out complete. Bill recorded on ${booking.companyLedger?.name ?? 'company ledger'}.`
      : creditAmount > 0
        ? `Check-out complete. Guest overpaid by ৳${creditAmount.toFixed(2)} — issue refund if needed.`
        : 'Check-out successful and invoice generated';

    return successResponse(
      {
        booking: updatedBooking,
        invoiceId: generatedInvoiceId,
        creditAmount,
        stayAdjusted: settlement.stayAdjusted,
        companyLedgerDue,
        companyLedgerName: booking.companyLedger?.name ?? null,
      },
      successMessage
    );
  } catch (error) {
    console.error('Check-out error:', error);
    const message = error instanceof Error ? error.message : ''
    if (message.includes('Unique constraint') || message.includes('company_ledger_bills')) {
      return errorResponse(
        'Checkout could not complete — this stay may already be billed. Refresh and check booking status.',
        409
      );
    }
    return errorResponse('Failed to check out', 500);
  }
}
