import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { s3Service } from '../services/s3.service';
import { roomLookup } from '../services/room.service';

const prisma = new PrismaClient();

interface UploadUrlBody {
  roomId: string;
  filename: string;
  size: number;
  contentType: string;
}

async function userCanAccessRoom(userId: string, roomId: string): Promise<{
  allowed: boolean;
  error?: string;
}> {
  const room = await prisma.room.findFirst({
    where: roomLookup(roomId),
    select: {
      id: true,
      isPublic: true,
      ownerId: true,
    },
  });

  if (!room) {
    return { allowed: false, error: 'Room not found' };
  }

  if (room.isPublic || room.ownerId === userId) {
    return { allowed: true };
  }

  const participation = await prisma.roomParticipant.findUnique({
    where: {
      userId_roomId: {
        userId,
        roomId: room.id,
      },
    },
    select: {
      leftAt: true,
    },
  });

  if (participation && participation.leftAt === null) {
    return { allowed: true };
  }

  return { allowed: false, error: 'You do not have access to this room' };
}

export async function createUploadUrl(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.userId;

    if (!userId) {
      res.status(401).json({ error: 'Access token required' });
      return;
    }

    const { roomId, filename, size, contentType } = req.body as UploadUrlBody;

    if (!roomId || !filename || !contentType || size === undefined) {
      res.status(400).json({ error: 'roomId, filename, size, and contentType are required' });
      return;
    }

    if (typeof filename !== 'string' || filename.trim().length === 0) {
      res.status(400).json({ error: 'filename must be a non-empty string' });
      return;
    }

    const access = await userCanAccessRoom(userId, roomId);
    if (!access.allowed) {
      res.status(access.error === 'Room not found' ? 404 : 403).json({
        error: access.error ?? 'Access denied',
      });
      return;
    }

    const upload = await s3Service.createPresignedUpload({
      roomId,
      userId,
      filename: filename.trim(),
      contentType,
      size: Number(size),
    });

    res.status(200).json(upload);
  } catch (error) {
    console.error('Create upload URL error:', error);
    const message = error instanceof Error ? error.message : 'Failed to generate upload URL';
    const status = message.includes('not allowed') || message.includes('size') ? 400 : 500;
    res.status(status).json({ error: message });
  }
}
