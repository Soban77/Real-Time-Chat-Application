import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { roomLookup } from '../services/room.service';

const prisma = new PrismaClient();

interface CreateRoomBody {
  name: string;
  description?: string;
  isPublic?: boolean;
  maxCapacity?: number;
}

function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

  return `${base || 'room'}-${uuidv4().slice(0, 8)}`;
}

export async function createRoom(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.userId;

    if (!userId) {
      res.status(401).json({ error: 'Access token required' });
      return;
    }

    const { name, description, isPublic = true, maxCapacity = 10 } = req.body as CreateRoomBody;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'Room name is required' });
      return;
    }

    if (name.trim().length > 100) {
      res.status(400).json({ error: 'Room name must be 100 characters or fewer' });
      return;
    }

    if (maxCapacity < 2 || maxCapacity > 50) {
      res.status(400).json({ error: 'maxCapacity must be between 2 and 50' });
      return;
    }

    const room = await prisma.room.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        slug: generateSlug(name.trim()),
        isPublic,
        maxCapacity,
        ownerId: userId,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        isPublic: true,
        maxCapacity: true,
        createdAt: true,
      },
    });

    res.status(201).json({ room });
  } catch (error) {
    console.error('Create room error:', error);
    res.status(500).json({ error: 'Failed to create room' });
  }
}

export async function getRoom(req: Request, res: Response): Promise<void> {
  try {
    const { roomId } = req.params;

    if (typeof roomId !== 'string' || roomId.length === 0) {
      res.status(400).json({ error: 'roomId is required' });
      return;
    }

    const room = await prisma.room.findFirst({
      where: roomLookup(roomId),
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        isPublic: true,
        maxCapacity: true,
        createdAt: true,
      },
    });

    if (!room) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }

    res.status(200).json({ room });
  } catch (error) {
    console.error('Get room error:', error);
    res.status(500).json({ error: 'Failed to fetch room' });
  }
}
