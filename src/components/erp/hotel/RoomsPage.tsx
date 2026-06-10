'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { StatusBadge } from '../shared/StatusBadge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { FileDown, Grid3X3, List, Loader2, Plus, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/auth-store';
import { downloadRoomsPdf, type RoomExportRecord } from '@/lib/rooms-export';

const ROOMS_PER_ROW = 8;

function chunkRooms<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size));
  }
  return rows;
}

interface Room {
  id: string;
  roomNumber: string;
  floor: number;
  status: 'AVAILABLE' | 'RESERVED' | 'OCCUPIED' | 'CLEANING' | 'MAINTENANCE';
  typeId: string;
  type: {
    id: string;
    name: string;
    basePrice: number;
    capacity: number;
  };
}

interface RoomType {
  id: string;
  name: string;
  basePrice: number;
  capacity: number;
}

interface HousekeepingTaskLite {
  id: string;
  roomId: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
}

export function RoomsPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const FLOOR_OPTIONS = [8, 9, 10];
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [exportingPdf, setExportingPdf] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [floorFilter, setFloorFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editRoom, setEditRoom] = useState<Room | null>(null);

  // Form state
  const [formRoomNumber, setFormRoomNumber] = useState('');
  const [formFloor, setFormFloor] = useState('8');
  const [formTypeId, setFormTypeId] = useState('');
  const [formStatus, setFormStatus] = useState('AVAILABLE');

  const { data: roomTypesData } = useQuery({
    queryKey: ['room-types'],
    queryFn: () => api.get<{ success: boolean; data: RoomType[] }>('/room-types'),
  });

  const roomTypes = (roomTypesData as any)?.data || [];

  const buildQuery = () => {
    const params: string[] = [];
    if (statusFilter !== 'all') params.push(`status=${statusFilter}`);
    if (floorFilter !== 'all') params.push(`floor=${floorFilter}`);
    if (typeFilter !== 'all') params.push(`typeId=${typeFilter}`);
    params.push('limit=100');
    return `/rooms?${params.join('&')}`;
  };

  const { data: roomsData, isLoading } = useQuery({
    queryKey: ['rooms', statusFilter, floorFilter, typeFilter],
    queryFn: () => api.get<{ success: boolean; data: Room[]; meta: { total: number } }>(buildQuery()),
  });

  const { data: housekeepingInProgressData } = useQuery({
    queryKey: ['housekeeping-room-status', 'IN_PROGRESS'],
    queryFn: () =>
      api.get<{ success: boolean; data: HousekeepingTaskLite[]; meta: { total: number } }>(
        '/housekeeping?status=IN_PROGRESS&limit=200'
      ),
  });

  const rooms = ((roomsData as any)?.data || []) as Room[];
  const housekeepingInProgress = ((housekeepingInProgressData as any)?.data || []) as HousekeepingTaskLite[];
  const roomsWithCleaningInProgress = new Set(housekeepingInProgress.map((t) => t.roomId));

  const filteredRooms = (search
    ? rooms.filter((r) => r.roomNumber.includes(search) || r.type?.name?.toLowerCase().includes(search.toLowerCase()))
    : rooms)
    .sort((a, b) => {
      if (a.floor !== b.floor) return a.floor - b.floor;
      return Number(a.roomNumber) - Number(b.roomNumber);
    });

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/rooms', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
      toast.success('Room created successfully');
      closeDialog();
    },
    onError: () => toast.error('Failed to create room'),
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) => api.put(`/rooms/${data.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
      toast.success('Room updated successfully');
      closeDialog();
    },
    onError: () => toast.error('Failed to update room'),
  });

  const closeDialog = () => {
    setAddDialogOpen(false);
    setEditRoom(null);
    setFormRoomNumber('');
    setFormFloor('8');
    setFormTypeId('');
    setFormStatus('AVAILABLE');
  };

  const openEditDialog = (room: Room) => {
    setEditRoom(room);
    setFormRoomNumber(room.roomNumber);
    setFormFloor(String(room.floor));
    setFormTypeId(room.typeId);
    setFormStatus(room.status);
    setAddDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!formRoomNumber || !formTypeId) {
      toast.error('Room number and type are required');
      return;
    }

    const payload = {
      roomNumber: formRoomNumber,
      floor: parseInt(formFloor),
      typeId: formTypeId,
      status: formStatus,
    };

    if (editRoom) {
      updateMutation.mutate({ id: editRoom.id, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const getStatusContainerClasses = (status: string) => {
    switch (status) {
      case 'AVAILABLE':
        return 'bg-emerald-500 border-emerald-600 text-white hover:bg-emerald-600';
      case 'RESERVED':
        return 'bg-sky-500 border-sky-600 text-white hover:bg-sky-600';
      case 'OCCUPIED':
        return 'bg-yellow-400 border-yellow-500 text-yellow-950 hover:bg-yellow-500';
      case 'CLEANING':
      case 'IN_PROGRESS':
        return 'bg-red-500 border-red-600 text-white hover:bg-red-600';
      case 'MAINTENANCE':
        return 'bg-slate-500 border-slate-600 text-white hover:bg-slate-600';
      default:
        return 'bg-muted border-border text-foreground';
    }
  };

  const getDisplayStatus = (room: Room) =>
    room.status === 'CLEANING' && roomsWithCleaningInProgress.has(room.id)
      ? 'IN_PROGRESS'
      : room.status;

  const floorGroups = [...new Set(filteredRooms.map((r) => r.floor))]
    .sort((a, b) => a - b)
    .map((floor) => ({
      floor,
      rows: chunkRooms(
        filteredRooms.filter((r) => r.floor === floor),
        ROOMS_PER_ROW
      ),
    }));

  const buildExportRows = (): RoomExportRecord[] =>
    filteredRooms.map((room) => ({
      roomNumber: room.roomNumber,
      floor: room.floor,
      status: room.status,
      displayStatus: getDisplayStatus(room),
      typeName: room.type?.name ?? '',
      basePrice: room.type?.basePrice ?? 0,
    }));

  const buildExportMeta = () => ({
    exportedAt: new Date(),
    generatedBy: user
      ? { name: user.name, email: user.email }
      : undefined,
    filters: {
      status: statusFilter === 'all' ? 'All status' : statusFilter.replace(/_/g, ' '),
      floor: floorFilter === 'all' ? 'All floors' : `Floor ${floorFilter}`,
      type:
        typeFilter === 'all'
          ? 'All types'
          : roomTypes.find((rt: RoomType) => rt.id === typeFilter)?.name ?? typeFilter,
      search: search.trim() || '—',
    },
  });

  const handleExportPdf = async () => {
    setExportingPdf(true);
    const toastId = toast.loading('Preparing PDF export…');
    try {
      const rows = buildExportRows();
      if (!rows.length) {
        toast.error('No rooms match the current filters', { id: toastId });
        return;
      }
      await downloadRoomsPdf(rows, buildExportMeta());
      toast.success(`Exported ${rows.length} room(s) to PDF`, { id: toastId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export failed';
      toast.error(msg, { id: toastId });
    } finally {
      setExportingPdf(false);
    }
  };

  const renderRoomTile = (room: Room) => {
    const displayStatus = getDisplayStatus(room);
    const isLightText = displayStatus === 'OCCUPIED';

    return (
      <button
        key={room.id}
        type="button"
        onClick={() => openEditDialog(room)}
        className={cn(
          'flex min-h-[92px] w-full flex-col justify-between rounded-lg border p-3 text-left shadow-sm transition-colors',
          getStatusContainerClasses(displayStatus)
        )}
      >
        <div className="flex items-start justify-between gap-1">
          <p className="text-lg font-bold leading-none">{room.roomNumber}</p>
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
              isLightText ? 'bg-yellow-600/20 text-yellow-950' : 'bg-black/15 text-inherit'
            )}
          >
            {displayStatus === 'IN_PROGRESS' ? 'Cleaning' : displayStatus.replace('_', ' ')}
          </span>
        </div>
        <div className={cn('space-y-0.5 text-xs', isLightText ? 'text-yellow-900/80' : 'text-white/90')}>
          <p className="font-medium">{room.type?.name}</p>
          <p>৳{room.type?.basePrice?.toLocaleString()}/night</p>
        </div>
      </button>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Rooms</h2>
          <p className="text-sm text-muted-foreground">{filteredRooms.length} rooms found</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => void handleExportPdf()}
            disabled={exportingPdf || isLoading}
          >
            {exportingPdf ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <FileDown className="w-4 h-4 mr-2" />
            )}
            Export PDF
          </Button>
          <Button className="bg-amber-600 hover:bg-amber-700 text-white" onClick={() => setAddDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add Room
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search room number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="AVAILABLE">Available</SelectItem>
            <SelectItem value="RESERVED">Reserved</SelectItem>
            <SelectItem value="OCCUPIED">Occupied</SelectItem>
            <SelectItem value="CLEANING">Cleaning</SelectItem>
            <SelectItem value="MAINTENANCE">Maintenance</SelectItem>
          </SelectContent>
        </Select>
        <Select value={floorFilter} onValueChange={setFloorFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Floor" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Floors</SelectItem>
            {FLOOR_OPTIONS.map((f) => (
              <SelectItem key={f} value={String(f)}>Floor {f}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Room Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {roomTypes.map((rt: RoomType) => (
              <SelectItem key={rt.id} value={rt.id}>{rt.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex border rounded-lg overflow-hidden">
          <Button
            variant={viewMode === 'grid' ? 'default' : 'ghost'}
            size="icon"
            className="h-9 w-9 rounded-none"
            onClick={() => setViewMode('grid')}
          >
            <Grid3X3 className="w-4 h-4" />
          </Button>
          <Button
            variant={viewMode === 'list' ? 'default' : 'ghost'}
            size="icon"
            className="h-9 w-9 rounded-none"
            onClick={() => setViewMode('list')}
          >
            <List className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, row) => (
            <div key={row} className="grid grid-cols-8 gap-2">
              {Array.from({ length: ROOMS_PER_ROW }).map((_, i) => (
                <Skeleton key={i} className="h-[92px] rounded-lg" />
              ))}
            </div>
          ))}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-4 text-xs font-medium">
            <span className="flex items-center gap-2">
              <span className="h-4 w-8 rounded bg-emerald-500" />
              Available
            </span>
            <span className="flex items-center gap-2">
              <span className="h-4 w-8 rounded bg-sky-500" />
              Reserved
            </span>
            <span className="flex items-center gap-2">
              <span className="h-4 w-8 rounded bg-yellow-400" />
              Occupied
            </span>
            <span className="flex items-center gap-2">
              <span className="h-4 w-8 rounded bg-red-500" />
              Cleaning
            </span>
            <span className="flex items-center gap-2">
              <span className="h-4 w-8 rounded bg-slate-500" />
              Maintenance
            </span>
          </div>

          {floorGroups.map(({ floor, rows }) => (
            <div key={floor} className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground">Floor {floor}</h3>
              {rows.map((rowRooms, rowIndex) => (
                <div
                  key={`${floor}-${rowIndex}`}
                  className="grid grid-cols-8 gap-2"
                >
                  {rowRooms.map((room) => renderRoomTile(room))}
                </div>
              ))}
            </div>
          ))}

          {filteredRooms.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">No rooms match your filters.</p>
          )}
        </div>
      ) : (
        <div className="rounded-lg border max-h-[600px] overflow-y-auto custom-scrollbar">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 sticky top-0">
              <tr>
                <th className="text-left p-3 font-medium">Room</th>
                <th className="text-left p-3 font-medium">Floor</th>
                <th className="text-left p-3 font-medium">Type</th>
                <th className="text-left p-3 font-medium">Price</th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-left p-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRooms.map((room) => (
                (() => {
                  const displayStatus = getDisplayStatus(room);
                  return (
                <tr key={room.id} className="border-t hover:bg-muted/30">
                  <td className="p-3 font-medium">{room.roomNumber}</td>
                  <td className="p-3">{room.floor}</td>
                  <td className="p-3">{room.type?.name}</td>
                  <td className="p-3">৳{room.type?.basePrice?.toLocaleString()}</td>
                  <td className="p-3"><StatusBadge status={displayStatus} /></td>
                  <td className="p-3">
                    <Button variant="ghost" size="sm" onClick={() => openEditDialog(room)}>
                      Edit
                    </Button>
                  </td>
                </tr>
                  );
                })()
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editRoom ? 'Edit Room' : 'Add New Room'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Room Number</Label>
              <Input
                value={formRoomNumber}
                onChange={(e) => setFormRoomNumber(e.target.value)}
                placeholder="e.g. 101"
              />
            </div>
            <div className="space-y-2">
              <Label>Floor</Label>
              <Select value={formFloor} onValueChange={setFormFloor}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FLOOR_OPTIONS.map((f) => (
                    <SelectItem key={f} value={String(f)}>Floor {f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Room Type</Label>
              <Select value={formTypeId} onValueChange={setFormTypeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {roomTypes.map((rt: RoomType) => (
                    <SelectItem key={rt.id} value={rt.id}>{rt.name} - ৳{rt.basePrice}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {editRoom && (
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={formStatus} onValueChange={setFormStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AVAILABLE">Available</SelectItem>
                    <SelectItem value="RESERVED">Reserved</SelectItem>
                    <SelectItem value="OCCUPIED">Occupied</SelectItem>
                    <SelectItem value="CLEANING">Cleaning</SelectItem>
                    <SelectItem value="MAINTENANCE">Maintenance</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {(createMutation.isPending || updateMutation.isPending) ? 'Saving...' : editRoom ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
