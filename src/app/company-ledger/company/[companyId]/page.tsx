'use client';

import { useParams } from 'next/navigation';
import { CompanyLedgerCompanyView } from '@/components/erp/hotel/CompanyLedgerCompanyView';
import { AppDevelopedByFooter } from '@/components/AppDevelopedByFooter';

export default function CompanyLedgerCompanyPage() {
  const params = useParams<{ companyId: string }>();
  const companyId = params?.companyId;

  if (!companyId) {
    return <div className="p-8 text-red-600">Invalid company link.</div>;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <main className="flex-1 mx-auto w-full max-w-5xl px-4 py-6">
        <CompanyLedgerCompanyView companyId={companyId} />
      </main>
      <AppDevelopedByFooter printHidden />
    </div>
  );
}
