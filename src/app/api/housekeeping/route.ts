import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { successResponse, paginatedResponse, errorResponse, notFoundResponse, logActivity } from '@/lib/api-utils';
import { RoleType } from '@prisma/client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const status = searchParams.get('status');
    const roomId = searchParams.get('roomId');
    const assignedTo = searchParams.get('assignedTo');
    const taskType = searchParams.get('taskType');

    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (roomId) where.roomId = roomId;
    if (assignedTo) where.assignedTo = assignedTo;
    if (taskType) where.taskType = taskType;

    const [tasks, total] = await Promise.all([
      db.housekeepingTask.findMany({
        where,
        include: {
          room: true,
          assigned: { select: { id: true, name: true, email: true, role: true } },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      db.housekeepingTask.count({ where }),
    ]);

    return paginatedResponse(tasks, total, page, limit);
  } catch (error) {
    console.error('Housekeeping list error:', error);
    return errorResponse('Failed to fetch housekeeping tasks', 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType);
    if (authResult instanceof Response) return authResult;

    const body = await request.json();
    const { roomId, taskType, assignedTo, notes } = body;

    if (!roomId || !taskType || !assignedTo) {
      return errorResponse('Room ID, task type, and assigned user are required');
    }

    // Verify room exists
    const room = await db.room.findUnique({ where: { id: roomId } });
    if (!room) {
      return notFoundResponse('Room');
    }

    // Verify assigned user exists
    const user = await db.user.findUnique({ where: { id: assignedTo } });
    if (!user) {
      return errorResponse('Assigned user not found');
    }

    const task = await db.housekeepingTask.create({
      data: {
        roomId,
        taskType,
        assignedTo,
        notes,
      },
      include: {
        room: true,
        assigned: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    await logActivity(
      authResult.id,
      'CREATE_HOUSEKEEPING_TASK',
      'hotel',
      JSON.stringify({ taskId: task.id, roomId, taskType, assignedTo })
    );

    return successResponse(task, 'Housekeeping task created successfully', 201);
  } catch (error) {
    console.error('Housekeeping task creation error:', error);
    return errorResponse('Failed to create housekeeping task', 500);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const authResult = requireRole(request, 'ADMIN' as RoleType, 'HOTEL_STAFF' as RoleType);
    if (authResult instanceof Response) return authResult;

    const body = await request.json();
    const { id, status, notes, assignedTo } = body;

    if (!id) {
      return errorResponse('Task ID is required');
    }

    const existing = await db.housekeepingTask.findUnique({
      where: { id },
      include: { room: true },
    });

    if (!existing) {
      return notFoundResponse('Housekeeping task');
    }

    const updateData: Record<string, unknown> = {};
    if (status !== undefined) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes;
    if (assignedTo !== undefined) {
      const assignedUser = await db.user.findUnique({
        where: { id: assignedTo },
        select: { id: true, active: true },
      });
      if (!assignedUser || !assignedUser.active) {
        return errorResponse('Assigned user not found');
      }
      updateData.assignedTo = assignedUser.id;
    }

    // Handle status transitions
    if (status === 'IN_PROGRESS') {
      updateData.startedAt = new Date();
      await db.room.update({
        where: { id: existing.roomId },
        data: { status: 'CLEANING' },
      });
    }

    if (status === 'COMPLETED') {
      updateData.completedAt = new Date();

      // When task is completed, set room status to AVAILABLE
      // Only if room is in CLEANING status
      if (existing.room.status === 'CLEANING') {
        await db.room.update({
          where: { id: existing.roomId },
          data: { status: 'AVAILABLE' },
        });
      }
    }

    const task = await db.housekeepingTask.update({
      where: { id },
      data: updateData,
      include: {
        room: true,
        assigned: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    await logActivity(
      authResult.id,
      'UPDATE_HOUSEKEEPING_TASK',
      'hotel',
      JSON.stringify({
        taskId: id,
        previousStatus: existing.status,
        newStatus: status,
        roomId: existing.roomId,
        roomStatusUpdated: status === 'COMPLETED' && existing.room.status === 'CLEANING',
      })
    );

    return successResponse(task, 'Housekeeping task updated successfully');
  } catch (error) {
    console.error('Housekeeping task update error:', error);
    return errorResponse('Failed to update housekeeping task', 500);
  }
}
