import { db } from '@/lib/db'

/** Attach uploaded ID image paths to a booking (validates path prefix). */
export async function attachIdDocumentsToBooking(
  bookingId: string,
  paths: string[] | undefined | null
): Promise<void> {
  if (!paths?.length) return

  const safe = paths.filter(
    (p) => typeof p === 'string' && p.startsWith('/uploads/id-docs/')
  )
  if (safe.length === 0) return

  await db.bookingIdDocument.createMany({
    data: safe.map((filePath, index) => ({
      bookingId,
      filePath,
      sortOrder: index,
    })),
  })
}

/** Replace all ID document attachments on a booking. */
export async function replaceIdDocumentsForBooking(
  bookingId: string,
  paths: string[] | undefined | null
): Promise<void> {
  await db.bookingIdDocument.deleteMany({ where: { bookingId } })
  await attachIdDocumentsToBooking(bookingId, paths)
}
