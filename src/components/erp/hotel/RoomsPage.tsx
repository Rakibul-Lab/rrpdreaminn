'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Card, CardContent } from '@/components/ui/card';
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
import { Grid3X3, List, Plus, BedDouble, Search } from 'lucide-react';

interface Room {
  id: string;
  roomNumber: string;
  floor: number;
  status: 'AVAILABLE' | 'OCCUPIED' | 'CLEANING' | 'MAINTENANCE';
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
  const FLOOR_OPTIONS = [8, 9, 10];
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
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

  const getStatusBorderColor = (status: string) => {
    switch (status) {
      case 'AVAILABLE': return 'border-l-emerald-500';
      case 'OCCUPIED': return 'border-l-red-500';
      case 'CLEANING': return 'border-l-amber-500';
      case 'IN_PROGRESS': return 'border-l-orange-500';
      case 'MAINTENANCE': return 'border-l-slate-400';
      default: return 'border-l-slate-300';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Rooms</h2>
          <p className="text-sm text-muted-foreground">{filteredRooms.length} rooms found</p>
        </div>
        <Button className="bg-amber-600 hover:bg-amber-700 text-white" onClick={() => setAddDialogOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Add Room
        </Button>
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
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-lg" />
          ))}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {filteredRooms.map((room) => (
            (() => {
              const displayStatus =
                room.status === 'CLEANING' && roomsWithCleaningInProgress.has(room.id)
                  ? 'IN_PROGRESS'
                  : room.status;
              return (
            <Card
              key={room.id}
              className={`cursor-pointer border-l-4 ${getStatusBorderColor(displayStatus)} hover:shadow-md transition-shadow`}
              onClick={() => openEditDialog(room)}
            >
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <BedDouble className="w-5 h-5 text-muted-foreground" />
                  <StatusBadge status={displayStatus} />
                </div>
                <p className="text-lg font-bold">{room.roomNumber}</p>
                <p className="text-xs text-muted-foreground">{room.type?.name}</p>
                <p className="text-xs font-medium text-amber-700 mt-1">৳{room.type?.basePrice?.toLocaleString()}/night</p>
                <p className="text-xs text-muted-foreground">Floor {room.floor}</p>
              </CardContent>
            </Card>
              );
            })()
          ))}
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
                  const displayStatus =
                    room.status === 'CLEANING' && roomsWithCleaningInProgress.has(room.id)
                      ? 'IN_PROGRESS'
                      : room.status;
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
