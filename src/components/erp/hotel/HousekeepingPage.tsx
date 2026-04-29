'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
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
import { format } from 'date-fns';
import { Plus, Play, CheckCircle2, Clock, SprayCan } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface HousekeepingTask {
  id: string;
  roomId: string;
  taskType: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  assignedTo: string;
  notes?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  room: { id: string; roomNumber: string; floor: number; status: string };
  assigned: { id: string; name: string; email: string; role: string };
}

interface Room {
  id: string;
  roomNumber: string;
  floor: number;
  status: string;
}

export function HousekeepingPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [startDialogOpen, setStartDialogOpen] = useState(false);
  const [startTask, setStartTask] = useState<HousekeepingTask | null>(null);
  const [startAssignedTo, setStartAssignedTo] = useState('');
  const [startNotes, setStartNotes] = useState('');

  // Form state
  const [formRoomId, setFormRoomId] = useState('');
  const [formTaskType, setFormTaskType] = useState('cleaning');
  const [formAssignedTo, setFormAssignedTo] = useState('');
  const [formNotes, setFormNotes] = useState('');

  const buildQuery = () => {
    const params: string[] = ['limit=50'];
    if (statusFilter !== 'all') params.push(`status=${statusFilter}`);
    return `/housekeeping?${params.join('&')}`;
  };

  const { data, isLoading } = useQuery({
    queryKey: ['housekeeping', statusFilter],
    queryFn: () => api.get<{ success: boolean; data: HousekeepingTask[]; meta: { total: number } }>(buildQuery()),
  });

  const { data: roomsData } = useQuery({
    queryKey: ['rooms-for-housekeeping'],
    queryFn: () => api.get('/rooms?limit=100'),
  });

  const tasks = ((data as any)?.data || []) as HousekeepingTask[];
  const rooms = ((roomsData as any)?.data || []) as Room[];

  // Get staff list for assignment - we can reuse the rooms data for now
  // In a real app, there'd be a dedicated staff endpoint
  const { data: staffData } = useQuery({
    queryKey: ['staff-list'],
    queryFn: () => api.get('/auth/seed'),
    retry: false,
    enabled: false, // Don't auto-fetch; we'll use a simpler approach
  });

  // For now, we'll use a hardcoded list based on the seeded data
  // In production, there should be a /users endpoint
  const staffMembers = [
    { id: 'hotel-staff', name: 'Hotel Manager' },
    { id: 'reception', name: 'Front Desk' },
    { id: 'housekeeping-1', name: 'Housekeeper 1' },
    { id: 'housekeeping-2', name: 'Housekeeper 2' },
  ];

  const createMutation = useMutation({
    mutationFn: (body: any) => api.post('/housekeeping', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['housekeeping'] });
      toast.success('Task created successfully');
      closeCreateDialog();
    },
    onError: () => toast.error('Failed to create task'),
  });

  const updateMutation = useMutation({
    mutationFn: (body: any) => api.put('/housekeeping', body),
    onSuccess: (res: any) => {
      if (!res?.success) {
        toast.error(res?.error || res?.message || 'Failed to update task');
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['housekeeping'] });
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
      toast.success('Task updated successfully');
      setStartDialogOpen(false);
      setStartTask(null);
      setStartAssignedTo('');
      setStartNotes('');
    },
    onError: () => toast.error('Failed to update task'),
  });

  const closeCreateDialog = () => {
    setCreateDialogOpen(false);
    setFormRoomId('');
    setFormTaskType('cleaning');
    setFormAssignedTo('');
    setFormNotes('');
  };

  const handleCreate = () => {
    if (!formRoomId || !formTaskType || !formAssignedTo) {
      toast.error('Room, task type, and assigned staff are required');
      return;
    }
    createMutation.mutate({
      roomId: formRoomId,
      taskType: formTaskType,
      assignedTo: formAssignedTo,
      notes: formNotes,
    });
  };

  const handleStatusUpdate = (taskId: string, newStatus: string) => {
    updateMutation.mutate({ id: taskId, status: newStatus });
  };

  const openStartDialog = (task: HousekeepingTask) => {
    setStartTask(task);
    setStartAssignedTo(task.assignedTo || '');
    setStartNotes(task.notes || '');
    setStartDialogOpen(true);
  };

  const handleStartTask = () => {
    if (!startTask) return;
    if (!startAssignedTo.trim()) {
      toast.error('Staff user ID is required');
      return;
    }
    updateMutation.mutate({
      id: startTask.id,
      status: 'IN_PROGRESS',
      assignedTo: startAssignedTo.trim(),
      notes: startNotes || null,
    });
  };

  const getTaskTypeIcon = (type: string) => {
    switch (type) {
      case 'cleaning':
        return <SprayCan className="w-4 h-4 text-amber-500" />;
      case 'maintenance':
        return <Clock className="w-4 h-4 text-slate-500" />;
      case 'deep_clean':
        return <SprayCan className="w-4 h-4 text-emerald-500" />;
      default:
        return <SprayCan className="w-4 h-4" />;
    }
  };

  const getStatusCounts = () => {
    return {
      pending: tasks.filter((t) => t.status === 'PENDING').length,
      inProgress: tasks.filter((t) => t.status === 'IN_PROGRESS').length,
      completed: tasks.filter((t) => t.status === 'COMPLETED').length,
    };
  };

  const counts = getStatusCounts();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Housekeeping</h2>
          <p className="text-sm text-muted-foreground">Manage cleaning and maintenance tasks</p>
        </div>
        <Button className="bg-amber-600 hover:bg-amber-700 text-white" onClick={() => setCreateDialogOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Create Task
        </Button>
      </div>

      {/* Status Summary */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="p-4 flex items-center gap-3">
            <Clock className="w-5 h-5 text-amber-600" />
            <div>
              <p className="text-2xl font-bold text-amber-700">{counts.pending}</p>
              <p className="text-xs text-amber-600">Pending</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-orange-50 border-orange-200">
          <CardContent className="p-4 flex items-center gap-3">
            <Play className="w-5 h-5 text-orange-600" />
            <div>
              <p className="text-2xl font-bold text-orange-700">{counts.inProgress}</p>
              <p className="text-xs text-orange-600">In Progress</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-emerald-50 border-emerald-200">
          <CardContent className="p-4 flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <div>
              <p className="text-2xl font-bold text-emerald-700">{counts.completed}</p>
              <p className="text-xs text-emerald-600">Completed</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Filter status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tasks</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
            <SelectItem value="COMPLETED">Completed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tasks Table */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border max-h-[500px] overflow-y-auto custom-scrollbar">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 sticky top-0">
              <tr>
                <th className="text-left p-3 font-medium">Room</th>
                <th className="text-left p-3 font-medium">Task Type</th>
                <th className="text-left p-3 font-medium">Assigned To</th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-left p-3 font-medium">Created</th>
                <th className="text-left p-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id} className="border-t hover:bg-muted/30">
                  <td className="p-3">
                    <div>
                      <p className="font-medium">Room {task.room?.roomNumber}</p>
                      <p className="text-xs text-muted-foreground">Floor {task.room?.floor}</p>
                    </div>
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      {getTaskTypeIcon(task.taskType)}
                      <span className="capitalize">{task.taskType?.replace('_', ' ')}</span>
                    </div>
                  </td>
                  <td className="p-3">
                    <p className="font-medium">{task.assigned?.name || 'Unassigned'}</p>
                  </td>
                  <td className="p-3">
                    <StatusBadge status={task.status} />
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {format(new Date(task.createdAt), 'MMM dd, HH:mm')}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-1">
                      {task.status === 'PENDING' && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs border-amber-500 text-amber-700 hover:bg-amber-50"
                          onClick={() => openStartDialog(task)}
                          disabled={updateMutation.isPending}
                        >
                          <Play className="w-3 h-3 mr-1" />
                          Start
                        </Button>
                      )}
                      {task.status === 'IN_PROGRESS' && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs border-emerald-500 text-emerald-700 hover:bg-emerald-50"
                          onClick={() => handleStatusUpdate(task.id, 'COMPLETED')}
                          disabled={updateMutation.isPending}
                        >
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          Complete
                        </Button>
                      )}
                      {task.status === 'COMPLETED' && (
                        <span className="text-xs text-emerald-600">Done</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {tasks.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    No housekeeping tasks found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Task Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={(open) => { if (!open) closeCreateDialog(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Housekeeping Task</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Room *</Label>
              <Select value={formRoomId} onValueChange={setFormRoomId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select room" />
                </SelectTrigger>
                <SelectContent>
                  {rooms.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      Room {r.roomNumber} - Floor {r.floor} ({r.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Task Type *</Label>
              <Select value={formTaskType} onValueChange={setFormTaskType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cleaning">Cleaning</SelectItem>
                  <SelectItem value="deep_clean">Deep Clean</SelectItem>
                  <SelectItem value="maintenance">Maintenance</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Assign To *</Label>
              <Input
                value={formAssignedTo}
                onChange={(e) => setFormAssignedTo(e.target.value)}
                placeholder="Staff user ID"
              />
              <p className="text-xs text-muted-foreground">Enter the user ID of the staff member</p>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} placeholder="Additional instructions..." rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeCreateDialog}>Cancel</Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={handleCreate}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? 'Creating...' : 'Create Task'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Start Cleaning Dialog */}
      <Dialog
        open={startDialogOpen}
        onOpenChange={(open) => {
          setStartDialogOpen(open);
          if (!open) {
            setStartTask(null);
            setStartAssignedTo('');
            setStartNotes('');
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Start Cleaning</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p className="font-medium">Room {startTask?.room?.roomNumber || '-'}</p>
              <p className="text-xs text-muted-foreground">
                {startTask?.taskType ? startTask.taskType.replace('_', ' ') : 'Cleaning task'}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Staff User ID *</Label>
              <Input
                value={startAssignedTo}
                onChange={(e) => setStartAssignedTo(e.target.value)}
                placeholder="Enter staff user id"
              />
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={startNotes}
                onChange={(e) => setStartNotes(e.target.value)}
                placeholder="Cleaning instructions..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStartDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={handleStartTask}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? 'Starting...' : 'Start Cleaning'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

