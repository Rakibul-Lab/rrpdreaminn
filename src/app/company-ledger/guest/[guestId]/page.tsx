'use client';

import { useParams } from 'next/navigation';
import { CompanyLedgerGuestHistoryView } from '@/components/erp/hotel/CompanyLedgerGuestHistoryView';
import { AppDevelopedByFooter } from '@/components/AppDevelopedByFooter';

export default function CompanyLedgerGuestHistoryPage() {
  const params = useParams<{ guestId: string }>();
  const guestId = params?.guestId;

  if (!guestId) {
    return <div className="p-8 text-red-600">Invalid guest link.</div>;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <main className="flex-1 mx-auto w-full max-w-5xl px-4 py-6">
        <CompanyLedgerGuestHistoryView guestId={guestId} />
      </main>
      <AppDevelopedByFooter printHidden />
    </div>
  );
}
