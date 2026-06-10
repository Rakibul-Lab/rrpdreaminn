export interface ReservationPdfData {
  reservationId: string
  confirmationNumber?: string | null
  guestName: string
  guestPhone: string
  guestEmail?: string | null
  guestAddress?: string | null
  guestNationality?: string | null
  guestRegistrationNumber?: string | null
  idType?: string | null
  idNumber?: string | null
  roomNumber: string
  roomType: string
  checkIn: string
  checkOut: string
  adults: number
  children: number
  totalRoomCharge: number
  advancePayment: number
  dueAmount: number
  vatApplied?: boolean
  vatPercent?: number
  vatAmount?: number
  totalWithVat?: number
  notes?: string | null
  createdAt: string
  status?: string
  formOfPayment?: string
  withMeal?: boolean
  mealPlan?: string
}
