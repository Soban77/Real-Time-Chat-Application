import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { config } from '../config';
import { redisService } from '../services/redis.service';
import { TokenPayload } from '../types/auth';
import {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from '../types/socket';
import { registerRoomHandlers } from './room.handler';
import { registerWhiteboardHandlers } from './whiteboard.handler';
import { registerFileHandlers } from './file.handler';

const prisma = new PrismaClient();

export type SignalingServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

type SignalingSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

function extractHandshakeToken(
  auth: Record<string, unknown> | undefined,
  query: Record<string, unknown>,
  authorization: string | undefined
): string | null {
  if (auth?.token && typeof auth.token === 'string') {
    return auth.token;
  }

  if (query.token && typeof query.token === 'string') {
    return query.token;
  }

  if (authorization?.startsWith('Bearer ')) {
    return authorization.slice(7);
  }

  return null;
}

async function socketAuthMiddleware(
  socket: SignalingSocket,
  next: (err?: Error) => void
): Promise<void> {
  try {
    const token = extractHandshakeToken(
      socket.handshake.auth as Record<string, unknown>,
      socket.handshake.query as Record<string, unknown>,
      socket.handshake.headers.authorization
    );

    if (!token) {
      next(new Error('Authentication token required'));
      return;
    }

    let decoded: TokenPayload;
    try {
      decoded = jwt.verify(token, config.jwt.accessSecret) as TokenPayload;
    } catch {
      next(new Error('Invalid or expired access token'));
      return;
    }

    if (decoded.type !== 'access') {
      next(new Error('Invalid token type'));
      return;
    }

    const isBlacklisted = await redisService.isTokenBlacklisted(decoded.jti);
    if (isBlacklisted) {
      next(new Error('Token has been revoked'));
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      select: {
        id: true,
        username: true,
        displayName: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      next(new Error('User account is inactive'));
      return;
    }

    socket.data.userId = user.id;
    socket.data.tokenJti = decoded.jti;
    socket.data.username = user.username;
    socket.data.displayName = user.displayName;
    socket.data.currentRoomId = null;
    socket.data.currentDatabaseRoomId = null;

    next();
  } catch (error) {
    console.error('Socket auth error:', error);
    next(new Error('Authentication failed'));
  }
}

export async function createSocketServer(httpServer: HttpServer): Promise<SignalingServer> {
  const io: SignalingServer = new Server(httpServer, {
    cors: {
      origin: config.corsOrigin,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingInterval: 25000,
    pingTimeout: 20000,
    transports: ['websocket', 'polling'],
  });

  const { pubClient, subClient } = redisService.createPubSubClients();

  pubClient.on('error', (error: Error) => {
    console.error('Socket.io Redis pub client error:', error.message);
  });

  subClient.on('error', (error: Error) => {
    console.error('Socket.io Redis sub client error:', error.message);
  });

  await Promise.all([pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient));

  io.use((socket, next) => {
    socketAuthMiddleware(socket, next).catch((error) => {
      next(error instanceof Error ? error : new Error('Authentication failed'));
    });
  });

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id} (user: ${socket.data.userId})`);
    registerRoomHandlers(io, socket);
    registerWhiteboardHandlers(io, socket);
    registerFileHandlers(io, socket);
  });

  return io;
}
