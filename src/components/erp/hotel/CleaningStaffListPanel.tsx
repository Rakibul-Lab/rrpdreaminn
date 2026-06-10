'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '../shared/StatusBadge';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { FileDown, FileSpreadsheet, History, Loader2, Search } from 'lucide-react';
import { getPaginationPages } from '@/lib/pagination-pages';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/auth-store';
import {
  downloadCleaningStaffHistoryExcel,
  downloadCleaningStaffHistoryPdf,
  downloadCleaningStaffListExcel,
  downloadCleaningStaffListPdf,
  type CleaningStaffListRecord,
  type CleaningStaffWorkHistoryRecord,
} from '@/lib/cleaning-staff-export';

interface StaffListItem extends CleaningStaffListRecord {
  active: boolean;
  createdAt: string;
}

interface WorkHistoryItem extends CleaningStaffWorkHistoryRecord {
  id: string;
  staffId: string;
}

export function CleaningStaffListPanel() {
  const user = useAuthStore((s) => s.user);
  const [search, setSearch] = useState('');
  const [staffPage, setStaffPage] = useState(1);
  const [staffPageSize, setStaffPageSize] = useState(10);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize] = useState(10);
  const [exporting, setExporting] = useState<'staff-excel' | 'staff-pdf' | 'history-excel' | 'history-pdf' | null>(
    null
  );

  const { data: staffData, isLoading: staffLoading } = useQuery({
    queryKey: ['cleaning-staff-list', search, staffPage, staffPageSize],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(staffPage),
        limit: String(staffPageSize),
      });
      if (search.trim()) params.set('search', search.trim());
      return api.get<{
        success: boolean;
        data: StaffListItem[];
        meta: { total: number; page: number; totalPages: number };
      }>(`/housekeeping/cleaning-staff/list?${params.toString()}`);
    },
  });

  const staff = ((staffData as any)?.data || []) as StaffListItem[];
  const staffTotal = (staffData as any)?.meta?.total || 0;
  const staffTotalPages = Math.max((staffData as any)?.meta?.totalPages || 1, 1);
  const staffRangeStart = staffTotal === 0 ? 0 : (staffPage - 1) * staffPageSize + 1;
  const staffRangeEnd = Math.min(staffPage * staffPageSize, staffTotal);
  const staffPageNumbers = getPaginationPages(staffPage, staffTotalPages);
  const selectedStaff = staff.find((s) => s.id === selectedStaffId) ?? null;

  const historyQuery = selectedStaffId
    ? `/housekeeping/cleaning-staff/work-history?staffId=${selectedStaffId}&page=${historyPage}&limit=${historyPageSize}`
    : null;

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['cleaning-staff-history', selectedStaffId, historyPage, historyPageSize],
    queryFn: () =>
      api.get<{
        success: boolean;
        data: WorkHistoryItem[];
        meta: { total: number; page: number; totalPages: number };
      }>(historyQuery!),
    enabled: !!historyQuery,
  });

  const history = ((historyData as any)?.data || []) as WorkHistoryItem[];
  const historyTotal = (historyData as any)?.meta?.total || 0;
  const historyTotalPages = Math.max((historyData as any)?.meta?.totalPages || 1, 1);
  const historyPageNumbers = getPaginationPages(historyPage, historyTotalPages);

  const buildExportMeta = (staffFilter?: string) => ({
    exportedAt: new Date(),
    generatedBy: user ? { name: user.name, email: user.email } : undefined,
    staffFilter,
  });

  const fetchAllStaff = async (): Promise<StaffListItem[]> => {
    const params = new URLSearchParams({ paginate: 'false', limit: '500' });
    if (search.trim()) params.set('search', search.trim());
    const res = await api.get<{ success: boolean; data: StaffListItem[] }>(
      `/housekeeping/cleaning-staff/list?${params.toString()}`
    );
    return ((res as any)?.data || []) as StaffListItem[];
  };

  const fetchAllHistory = async (staffId?: string): Promise<WorkHistoryItem[]> => {
    const params = new URLSearchParams({
      paginate: 'false',
      limit: '500',
    });
    if (staffId) params.set('staffId', staffId);
    const res = await api.get<{ success: boolean; data: WorkHistoryItem[] }>(
      `/housekeeping/cleaning-staff/work-history?${params.toString()}`
    );
    return ((res as any)?.data || []) as WorkHistoryItem[];
  };

  const handleExportStaffList = async (type: 'excel' | 'pdf') => {
    setExporting(type === 'excel' ? 'staff-excel' : 'staff-pdf');
    try {
      const rows = await fetchAllStaff();
      if (!rows.length) {
        toast.error('No cleaning staff to export');
        return;
      }
      const meta = buildExportMeta();
      if (type === 'excel') {
        await downloadCleaningStaffListExcel(rows, meta);
      } else {
        await downloadCleaningStaffListPdf(rows, meta);
      }
      toast.success('Staff list exported');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(null);
    }
  };

  const handleExportHistory = async (type: 'excel' | 'pdf') => {
    setExporting(type === 'excel' ? 'history-excel' : 'history-pdf');
    try {
      const rows = await fetchAllHistory(selectedStaffId ?? undefined);
      if (!rows.length) {
        toast.error('No work history to export');
        return;
      }
      const filterLabel = selectedStaff
        ? `${selectedStaff.staffCode} — ${selectedStaff.name}`
        : 'All staff';
      const meta = buildExportMeta(filterLabel);
      if (type === 'excel') {
        await downloadCleaningStaffHistoryExcel(rows, meta);
      } else {
        await downloadCleaningStaffHistoryPdf(rows, meta);
      }
      toast.success('Work history exported');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(null);
    }
  };

  const selectStaff = (id: string) => {
    setSelectedStaffId((prev) => (prev === id ? null : id));
    setHistoryPage(1);
  };

  const formatTaskType = (type: string) => type.replace(/_/g, ' ');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">Cleaning Staff</h3>
          <p className="text-sm text-muted-foreground">
            Staff roster and room cleaning work history
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleExportStaffList('excel')}
            disabled={!!exporting || staffLoading}
          >
            {exporting === 'staff-excel' ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <FileSpreadsheet className="w-4 h-4 mr-2" />
            )}
            Staff List Excel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleExportStaffList('pdf')}
            disabled={!!exporting || staffLoading}
          >
            {exporting === 'staff-pdf' ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <FileDown className="w-4 h-4 mr-2" />
            )}
            Staff List PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleExportHistory('excel')}
            disabled={!!exporting}
          >
            {exporting === 'history-excel' ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <FileSpreadsheet className="w-4 h-4 mr-2" />
            )}
            History Excel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleExportHistory('pdf')}
            disabled={!!exporting}
          >
            {exporting === 'history-pdf' ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <FileDown className="w-4 h-4 mr-2" />
            )}
            History PDF
          </Button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search staff ID, name, or phone..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setStaffPage(1);
          }}
          className="pl-9"
        />
      </div>

      <div className="rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3 font-medium">Staff ID</th>
                <th className="text-left p-3 font-medium">Name</th>
                <th className="text-left p-3 font-medium">Phone</th>
                <th className="text-center p-3 font-medium">Total</th>
                <th className="text-center p-3 font-medium">Completed</th>
                <th className="text-center p-3 font-medium">In Progress</th>
                <th className="text-center p-3 font-medium">Pending</th>
                <th className="text-right p-3 font-medium">History</th>
              </tr>
            </thead>
            <tbody>
              {staffLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-t">
                    {Array.from({ length: 8 }).map((__, j) => (
                      <td key={j} className="p-3">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : staff.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-muted-foreground">
                    No cleaning staff found. Add staff from the Tasks tab.
                  </td>
                </tr>
              ) : (
                staff.map((s) => (
                  <tr
                    key={s.id}
                    className={cn(
                      'border-t hover:bg-muted/30 transition-colors',
                      selectedStaffId === s.id && 'bg-amber-50/80'
                    )}
                  >
                    <td className="p-3 font-mono text-xs">{s.staffCode}</td>
                    <td className="p-3 font-medium">{s.name}</td>
                    <td className="p-3 text-muted-foreground">{s.phone || '—'}</td>
                    <td className="p-3 text-center">{s.taskCounts.total}</td>
                    <td className="p-3 text-center text-emerald-700">{s.taskCounts.completed}</td>
                    <td className="p-3 text-center text-orange-700">{s.taskCounts.inProgress}</td>
                    <td className="p-3 text-center text-amber-700">{s.taskCounts.pending}</td>
                    <td className="p-3 text-right">
                      <Button
                        variant={selectedStaffId === s.id ? 'default' : 'outline'}
                        size="sm"
                        className={cn(
                          selectedStaffId === s.id && 'bg-amber-600 hover:bg-amber-700'
                        )}
                        onClick={() => selectStaff(s.id)}
                      >
                        <History className="w-4 h-4 mr-1" />
                        {selectedStaffId === s.id ? 'Hide' : 'View'}
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-3 border-t bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {staffTotal === 0 ? 'No results' : `Showing ${staffRangeStart}–${staffRangeEnd} of ${staffTotal}`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={String(staffPageSize)}
              onValueChange={(v) => {
                setStaffPageSize(Number(v));
                setStaffPage(1);
              }}
            >
              <SelectTrigger className="h-8 w-[110px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10 / page</SelectItem>
                <SelectItem value="20">20 / page</SelectItem>
                <SelectItem value="50">50 / page</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={staffPage <= 1}
              onClick={() => setStaffPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <div className="flex flex-wrap items-center gap-1">
              {staffPageNumbers.map((n, idx) =>
                n === 'ellipsis' ? (
                  <span key={`staff-ellipsis-${idx}`} className="px-2 text-muted-foreground">
                    …
                  </span>
                ) : (
                  <Button
                    key={n}
                    variant={staffPage === n ? 'default' : 'outline'}
                    size="sm"
                    className={cn(
                      'h-8 min-w-8 px-2',
                      staffPage === n && 'bg-amber-600 hover:bg-amber-700'
                    )}
                    onClick={() => setStaffPage(n)}
                  >
                    {n}
                  </Button>
                )
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={staffPage >= staffTotalPages}
              onClick={() => setStaffPage((p) => Math.min(staffTotalPages, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      </div>

      {selectedStaff && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-semibold">
              Work history — {selectedStaff.name}{' '}
              <span className="text-muted-foreground font-normal">({selectedStaff.staffCode})</span>
            </h4>
            <span className="text-sm text-muted-foreground">{historyTotal} record(s)</span>
          </div>

          <div className="rounded-lg border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-3 font-medium">Date</th>
                    <th className="text-left p-3 font-medium">Time</th>
                    <th className="text-left p-3 font-medium">Room No</th>
                    <th className="text-left p-3 font-medium">Floor</th>
                    <th className="text-left p-3 font-medium">Task</th>
                    <th className="text-left p-3 font-medium">Status</th>
                    <th className="text-left p-3 font-medium">Started</th>
                    <th className="text-left p-3 font-medium">Completed</th>
                  </tr>
                </thead>
                <tbody>
                  {historyLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <tr key={i} className="border-t">
                        {Array.from({ length: 8 }).map((__, j) => (
                          <td key={j} className="p-3">
                            <Skeleton className="h-4 w-full" />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : history.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-muted-foreground">
                        No work history for this staff member yet.
                      </td>
                    </tr>
                  ) : (
                    history.map((h) => {
                      const workAt = new Date(h.workAt);
                      return (
                        <tr key={h.id} className="border-t">
                          <td className="p-3">{format(workAt, 'dd MMM yyyy')}</td>
                          <td className="p-3 font-mono text-xs">{format(workAt, 'HH:mm')}</td>
                          <td className="p-3 font-medium">{h.roomNumber}</td>
                          <td className="p-3">{h.floor}</td>
                          <td className="p-3 capitalize">{formatTaskType(h.taskType)}</td>
                          <td className="p-3">
                            <StatusBadge status={h.status} />
                          </td>
                          <td className="p-3 text-muted-foreground text-xs">
                            {h.startedAt ? format(new Date(h.startedAt), 'dd MMM yyyy HH:mm') : '—'}
                          </td>
                          <td className="p-3 text-muted-foreground text-xs">
                            {h.completedAt
                              ? format(new Date(h.completedAt), 'dd MMM yyyy HH:mm')
                              : '—'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {historyTotalPages > 1 && (
            <div className="flex items-center justify-center gap-1 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                disabled={historyPage <= 1}
                onClick={() => setHistoryPage((p) => p - 1)}
              >
                Previous
              </Button>
              {historyPageNumbers.map((n, idx) =>
                n === 'ellipsis' ? (
                  <span key={`ellipsis-${idx}`} className="px-2 text-muted-foreground">
                    …
                  </span>
                ) : (
                  <Button
                    key={n}
                    variant={historyPage === n ? 'default' : 'outline'}
                    size="sm"
                    className={cn(historyPage === n && 'bg-amber-600 hover:bg-amber-700')}
                    onClick={() => setHistoryPage(n)}
                  >
                    {n}
                  </Button>
                )
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={historyPage >= historyTotalPages}
                onClick={() => setHistoryPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}

      {!selectedStaff && staff.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Select a staff member to view their room cleaning history, or export all history using the
          buttons above.
        </p>
      )}
    </div>
  );
}
