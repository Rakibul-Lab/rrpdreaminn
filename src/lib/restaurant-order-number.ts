import { format } from 'date-fns'

type OrderNumberClient = {
  restaurantOrder: {
    findFirst: (args: {
      where: { orderNumber: { startsWith: string } }
      orderBy: { orderNumber: 'desc' }
      select: { orderNumber: true }
    }) => Promise<{ orderNumber: string } | null>
  }
}

/** RRP-CVR-YYYYMMDD-0001 (daily sequence, 4 digits). */
export async function generateRestaurantOrderNumber(
  client: OrderNumberClient,
  now: Date = new Date()
): Promise<string> {
  const datePart = format(now, 'yyyyMMdd')
  const prefix = `RRP-CVR-${datePart}-`

  const latest = await client.restaurantOrder.findFirst({
    where: { orderNumber: { startsWith: prefix } },
    orderBy: { orderNumber: 'desc' },
    select: { orderNumber: true },
  })

  let seq = 1
  if (latest?.orderNumber) {
    const tail = latest.orderNumber.slice(prefix.length)
    const parsed = parseInt(tail, 10)
    if (Number.isFinite(parsed)) seq = parsed + 1
  }

  if (seq > 9999) {
    throw new Error('Daily order number limit reached (9999)')
  }

  return `${prefix}${String(seq).padStart(4, '0')}`
}
