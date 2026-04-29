'use client'

import Image from 'next/image'
import { useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { api } from '@/lib/api-client'
import { Button } from '@/components/ui/button'

interface InvoiceData {
  id: string
  invoiceNumber: string
  roomCharges: number
  foodCharges: number
  extraCharges: number
  subtotal: number
  discount: number
  vatAmount: number
  totalAmount: number
  paidAmount: number
  dueAmount: number
  declaredVatPercent?: number
  createdAt: string
  booking: {
    id: string
    checkIn: string
    checkOut: string
    customer: { name: string; phone: string; email?: string | null; address?: string | null }
    room: { roomNumber: string; type: { name: string } }
    restaurantOrders?: Array<{
      id: string
      orderNumber: string
      subtotal: number
      discount: number
      vatPercent: number
      vatAmount: number
      totalAmount: number
      createdAt: string
    }>
  }
  items: Array<{
    id: string
    description: string
    quantity: number
    unitPrice: number
    total: number
  }>
}

export default function InvoicePrintPage() {
  const params = useParams<{ id: string }>()
  const invoiceId = params?.id

  const { data, isLoading } = useQuery({
    queryKey: ['print-invoice', invoiceId],
    queryFn: () => api.get<{ success: boolean; data: InvoiceData }>(`/invoices/${invoiceId}`),
    enabled: !!invoiceId,
  })

  const invoice = data?.data
  const roomBill = invoice?.roomCharges || 0
  const restaurantOrders = invoice?.booking?.restaurantOrders || []
  const restaurantSubtotal = restaurantOrders.reduce((sum, o) => sum + o.subtotal, 0)
  const restaurantDiscount = restaurantOrders.reduce((sum, o) => sum + o.discount, 0)
  const restaurantBill = Math.max(0, restaurantSubtotal - restaurantDiscount)
  const extraBill = invoice?.extraCharges || 0
  const restaurantVat = restaurantOrders.reduce((sum, o) => sum + o.vatAmount, 0)
  const roomVat = Math.max(0, (invoice?.vatAmount || 0) - restaurantVat)
  const hotelVatPercent = invoice?.declaredVatPercent ?? 15
  const vatRates = Array.from(new Set(restaurantOrders.map((o) => Number(o.vatPercent || 0))))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b)
  const restaurantVatLabel = vatRates.length ? vatRates.map((r) => `${r}%`).join(', ') : '-'
  const hotelPartTotal = roomBill + roomVat + extraBill
  const restaurantPartTotal = restaurantBill + restaurantVat

  useEffect(() => {
    if (!invoice) return
    const timer = setTimeout(() => window.print(), 350)
    return () => clearTimeout(timer)
  }, [invoice])

  if (isLoading) {
    return <div className="p-8 text-sm text-slate-500">Loading invoice...</div>
  }

  if (!invoice) {
    return <div className="p-8 text-sm text-red-600">Invoice not found.</div>
  }

  return (
    <main className="mx-auto max-w-4xl bg-white p-6 print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <h1 className="text-lg font-semibold text-slate-800">Invoice Print Preview</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => window.print()}>Print</Button>
          <Button onClick={() => window.close()}>Close</Button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 p-6 print:border-0 print:p-0">
        <div className="mb-6 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 overflow-hidden rounded-lg border bg-white">
              <Image src="/brand-logo.png" alt="RRP Dream Inn logo" width={48} height={48} className="h-full w-full object-cover" />
            </div>
            <div>
              <p className="text-lg font-bold text-slate-800">RRP Dream Inn</p>
              <p className="text-xs text-slate-500">Professional Guest Invoice</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm text-slate-500">Invoice No</p>
            <p className="font-mono text-base font-semibold text-amber-700">{invoice.invoiceNumber}</p>
            <p className="text-xs text-slate-500">{format(new Date(invoice.createdAt), 'MMM dd, yyyy')}</p>
          </div>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-slate-500">Guest</p>
            <p className="font-semibold">{invoice.booking.customer.name}</p>
            <p>{invoice.booking.customer.phone}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">Room</p>
            <p className="font-semibold">Room {invoice.booking.room.roomNumber}</p>
            <p>{invoice.booking.room.type.name}</p>
          </div>
        </div>

        <table className="mb-5 w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2">Description</th>
              <th className="py-2 text-center">Qty</th>
              <th className="py-2 text-right">Rate</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items?.map((item) => (
              <tr key={item.id} className="border-b border-slate-100">
                <td className="py-2">{item.description}</td>
                <td className="py-2 text-center">{item.quantity}</td>
                <td className="py-2 text-right">৳{item.unitPrice.toLocaleString()}</td>
                <td className="py-2 text-right font-medium">৳{item.total.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="ml-auto max-w-xs space-y-1 text-sm">
          <div className="rounded border border-slate-200 p-2.5 space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Hotel Part</p>
            <div className="flex justify-between"><span>Room Bill</span><span>৳{roomBill.toLocaleString()}</span></div>
            <div className="flex justify-between"><span>Room VAT</span><span>৳{roomVat.toLocaleString()}</span></div>
            <div className="flex justify-between text-[11px] text-slate-500"><span>VAT Rate</span><span>{hotelVatPercent}%</span></div>
            {extraBill > 0 && <div className="flex justify-between"><span>Extra Charges</span><span>৳{extraBill.toLocaleString()}</span></div>}
            <div className="flex justify-between border-t pt-1 font-semibold"><span>Hotel Total</span><span>৳{hotelPartTotal.toLocaleString()}</span></div>
          </div>
          <div className="rounded border border-slate-200 p-2.5 space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Restaurant Part</p>
            <div className="flex justify-between"><span>Subtotal</span><span>৳{restaurantSubtotal.toLocaleString()}</span></div>
            <div className="flex justify-between text-emerald-700"><span>Discount</span><span>-৳{restaurantDiscount.toLocaleString()}</span></div>
            <div className="flex justify-between"><span>VAT ({restaurantVatLabel})</span><span>৳{restaurantVat.toLocaleString()}</span></div>
            <div className="flex justify-between border-t pt-1 font-semibold"><span>Total</span><span>৳{restaurantPartTotal.toLocaleString()}</span></div>
          </div>
          <div className="flex justify-between"><span>Combined Total</span><span>৳{(hotelPartTotal + restaurantPartTotal).toLocaleString()}</span></div>
          <div className="flex justify-between"><span>Discount</span><span>৳{invoice.discount.toLocaleString()}</span></div>
          <div className="flex justify-between border-t pt-2 font-semibold"><span>Subtotal</span><span>৳{invoice.totalAmount.toLocaleString()}</span></div>
          <div className="flex justify-between text-emerald-700"><span>Paid</span><span>৳{invoice.paidAmount.toLocaleString()}</span></div>
          <div className={`flex justify-between font-bold ${invoice.dueAmount > 0 ? 'text-red-600' : 'text-emerald-700'}`}>
            <span>Due</span><span>৳{invoice.dueAmount.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </main>
  )
}
