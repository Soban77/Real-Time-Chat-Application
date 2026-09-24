import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AccessToken } from 'livekit-server-sdk';
import { config } from '../config';
import { roomLookup } from '../services/room.service';

const prisma = new PrismaClient();

interface RoomTokenBody {
  roomId: string;
}

async function userCanAccessRoom(userId: string, roomId: string): Promise<{
  allowed: boolean;
  error?: string;
  room?: {
    id: string;
    name: string;
    maxCapacity: number;
    isPublic: boolean;
    ownerId: string;
  };
}> {
  const room = await prisma.room.findFirst({
    where: roomLookup(roomId),
    select: {
      id: true,
      name: true,
      maxCapacity: true,
      isPublic: true,
      ownerId: true,
    },
  });

  if (!room) {
    return { allowed: false, error: 'Room not found' };
  }

  if (room.isPublic || room.ownerId === userId) {
    return { allowed: true, room };
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
    return { allowed: true, room };
  }

  return { allowed: false, error: 'You do not have access to this room' };
}

export async function createRoomToken(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.userId;

    if (!userId) {
      res.status(401).json({ error: 'Access token required' });
      return;
    }

    const { roomId } = req.body as RoomTokenBody;

    if (!roomId) {
      res.status(400).json({ error: 'roomId is required' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        displayName: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      res.status(401).json({ error: 'User account is inactive' });
      return;
    }

    const access = await userCanAccessRoom(userId, roomId);
    if (!access.allowed || !access.room) {
      res.status(access.error === 'Room not found' ? 404 : 403).json({
        error: access.error ?? 'Access denied',
      });
      return;
    }

    const participant = await prisma.roomParticipant.findUnique({
      where: {
        userId_roomId: {
          userId,
          roomId,
        },
      },
      select: { role: true },
    });

    const isPrivileged =
      access.room.ownerId === userId ||
      participant?.role === 'HOST' ||
      participant?.role === 'MODERATOR';

    const token = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
      identity: user.id,
      name: user.displayName ?? user.username,
      ttl: config.livekit.tokenTtlSeconds,
    });

    token.addGrant({
      roomJoin: true,
      room: roomId,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      roomAdmin: isPrivileged,
    });

    const jwt = await token.toJwt();

    res.status(200).json({
      token: jwt,
      url: config.livekit.url,
      roomName: roomId,
      participant: {
        identity: user.id,
        name: user.displayName ?? user.username,
      },
    });
  } catch (error) {
    console.error('Create room token error:', error);
    res.status(500).json({ error: 'Failed to generate room token' });
  }
}
