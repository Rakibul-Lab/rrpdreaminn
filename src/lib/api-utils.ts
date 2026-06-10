import { NextResponse } from 'next/server';
import { db } from './db';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
    totalPages?: number;
  };
}

export function successResponse<T>(data: T, message?: string, status = 200): NextResponse {
  return NextResponse.json(
    { success: true, data, message } as ApiResponse<T>,
    { status }
  );
}

export function paginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
  extraMeta?: Record<string, unknown>
): NextResponse {
  return NextResponse.json({
    success: true,
    data,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      ...extraMeta,
    },
  } as ApiResponse<T>);
}

export function errorResponse(error: string, status = 400): NextResponse {
  return NextResponse.json(
    { success: false, error } as ApiResponse,
    { status }
  );
}

export function notFoundResponse(resource: string): NextResponse {
  return NextResponse.json(
    { success: false, error: `${resource} not found` } as ApiResponse,
    { status: 404 }
  );
}

export async function logActivity(
  userId: string | null,
  action: string,
  module: string,
  details?: string
) {
  try {
    await db.activityLog.create({
      data: { userId, action, module, details },
    });
  } catch {
    // Silent fail for activity logs
  }
}

/** @deprecated Use generateRestaurantOrderNumber from @/lib/restaurant-order-number */
export function generateOrderNumber(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const random = String(Math.floor(1000 + Math.random() * 9000));
  return `RRP-CVR-${y}${m}${d}-${random}`;
}

// Generate invoice number: RRP-DI-yyyyddMM + random 3 digits (year-date-month)
export function generateInvoiceNumber(now: Date = new Date()): string {
  const year = String(now.getFullYear());
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const random = String(Math.floor(100 + Math.random() * 900));
  return `RRP-DI-${year}${day}${month}-${random}`;
}
