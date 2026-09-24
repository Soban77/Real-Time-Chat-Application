import { Server, Socket } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { redisService } from '../services/redis.service';
import { roomLookup } from '../services/room.service';
import {
  ClientToServerEvents,
  InterServerEvents,
  RoomJoinPayload,
  RoomJoinResponse,
  RoomLeaveResponse,
  RoomParticipantState,
  ServerToClientEvents,
  SocketData,
  WebRtcAnswerPayload,
  WebRtcIceCandidatePayload,
  WebRtcOfferPayload,
  RoomChatMessageEvent,
} from '../types/socket';

const prisma = new PrismaClient();
type SignalingSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

type SignalingServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

function emitRoomError(socket: SignalingSocket, message: string): void {
  socket.emit('room:error', { message });
}

async function buildParticipant(socket: SignalingSocket): Promise<RoomParticipantState> {
  return {
    socketId: socket.id,
    userId: socket.data.userId,
    username: socket.data.username,
    displayName: socket.data.displayName,
    joinedAt: new Date().toISOString(),
  };
}

async function handleRoomJoin(
  io: SignalingServer,
  socket: SignalingSocket,
  payload: RoomJoinPayload,
  callback?: (response: RoomJoinResponse) => void
): Promise<void> {
  const { roomId } = payload;

  if (!roomId) {
    const response: RoomJoinResponse = { success: false, error: 'roomId is required' };
    callback?.(response);
    emitRoomError(socket, response.error!);
    return;
  }

  if (socket.data.currentRoomId && socket.data.currentRoomId !== roomId) {
    await handleRoomLeave(io, socket);
  }

  const room = await prisma.room.findFirst({
    where: roomLookup(roomId),
    select: { id: true, maxCapacity: true, isPublic: true, ownerId: true },
  });

  if (!room) {
    const response: RoomJoinResponse = { success: false, error: 'Room not found' };
    callback?.(response);
    emitRoomError(socket, response.error!);
    return;
  }

  const alreadyInRoom = socket.data.currentRoomId === roomId;

  const participant = await buildParticipant(socket);
  const reserved = await redisService.reserveRoomParticipant(
    roomId,
    socket.id,
    participant,
    room.maxCapacity
  );

  if (!reserved) {
    const response: RoomJoinResponse = { success: false, error: 'Room is at capacity' };
    callback?.(response);
    emitRoomError(socket, response.error!);
    return;
  }

  await socket.join(roomId);
  socket.data.currentRoomId = roomId;
  socket.data.currentDatabaseRoomId = room.id;

  const participants = await redisService.getRoomParticipants(roomId);

  socket.emit('room:participants', { roomId, participants });

  if (!alreadyInRoom) {
    socket.to(roomId).emit('user-joined', { participant });
  }

  await prisma.roomParticipant.upsert({
    where: {
      userId_roomId: {
        userId: socket.data.userId,
        roomId: socket.data.currentDatabaseRoomId ?? roomId,
      },
    },
    create: {
      userId: socket.data.userId,
      roomId: socket.data.currentDatabaseRoomId ?? roomId,
      role: room.ownerId === socket.data.userId ? 'HOST' : 'PARTICIPANT',
      leftAt: null,
    },
    update: {
      leftAt: null,
      joinedAt: new Date(),
    },
  });

  const response: RoomJoinResponse = {
    success: true,
    roomId,
    participants,
  };
  callback?.(response);
}

async function handleRoomLeave(
  io: SignalingServer,
  socket: SignalingSocket,
  callback?: (response: RoomLeaveResponse) => void
): Promise<void> {
  const roomId = socket.data.currentRoomId;

  if (!roomId) {
    const response: RoomLeaveResponse = { success: true };
    callback?.(response);
    return;
  }

  const wasActiveParticipant = await redisService.removeRoomParticipant(roomId, socket.id);
  socket.leave(roomId);
  socket.data.currentRoomId = null;

  if (!wasActiveParticipant) {
    socket.data.currentDatabaseRoomId = null;
    const response: RoomLeaveResponse = { success: true };
    callback?.(response);
    return;
  }

  io.to(roomId).emit('user-disconnected', {
    socketId: socket.id,
    userId: socket.data.userId,
    roomId,
  });

  await prisma.roomParticipant.updateMany({
    where: {
      userId: socket.data.userId,
      roomId: socket.data.currentDatabaseRoomId ?? roomId,
      leftAt: null,
    },
    data: {
      leftAt: new Date(),
    },
  });
  socket.data.currentDatabaseRoomId = null;

  const response: RoomLeaveResponse = { success: true };
  callback?.(response);
}

function validateSameRoom(
  socket: SignalingSocket,
  roomId: string,
  targetSocketId: string
): boolean {
  if (socket.data.currentRoomId !== roomId) {
    emitRoomError(socket, 'You are not in this room');
    return false;
  }

  if (!targetSocketId) {
    emitRoomError(socket, 'targetSocketId is required');
    return false;
  }

  return true;
}

async function handleChatMessage(
  io: SignalingServer,
  socket: SignalingSocket,
  payload: { roomId: string; text: string }
): Promise<void> {
  const text = typeof payload?.text === 'string' ? payload.text.trim() : '';

  if (!payload?.roomId || !text || text.length > 2000) {
    emitRoomError(socket, 'Message must contain 1-2000 characters');
    return;
  }

  if (!validateSameRoom(socket, payload.roomId, socket.id)) {
    return;
  }

  const message: RoomChatMessageEvent = {
    id: uuidv4(),
    roomId: payload.roomId,
    userId: socket.data.userId,
    displayName: socket.data.displayName ?? socket.data.username,
    text,
    timestamp: new Date().toISOString(),
  };

  io.to(payload.roomId).emit('room:chat-message', message);
}

function handleWebRtcOffer(socket: SignalingSocket, payload: WebRtcOfferPayload): void {
  const { targetSocketId, roomId, offer } = payload;

  if (!validateSameRoom(socket, roomId, targetSocketId)) {
    return;
  }

  if (!offer) {
    emitRoomError(socket, 'offer is required');
    return;
  }

  socket.to(targetSocketId).emit('webrtc:offer', {
    fromSocketId: socket.id,
    fromUserId: socket.data.userId,
    roomId,
    offer,
  });
}

function handleWebRtcAnswer(socket: SignalingSocket, payload: WebRtcAnswerPayload): void {
  const { targetSocketId, roomId, answer } = payload;

  if (!validateSameRoom(socket, roomId, targetSocketId)) {
    return;
  }

  if (!answer) {
    emitRoomError(socket, 'answer is required');
    return;
  }

  socket.to(targetSocketId).emit('webrtc:answer', {
    fromSocketId: socket.id,
    fromUserId: socket.data.userId,
    roomId,
    answer,
  });
}

function handleWebRtcIceCandidate(
  socket: SignalingSocket,
  payload: WebRtcIceCandidatePayload
): void {
  const { targetSocketId, roomId, candidate } = payload;

  if (!validateSameRoom(socket, roomId, targetSocketId)) {
    return;
  }

  if (!candidate) {
    emitRoomError(socket, 'candidate is required');
    return;
  }

  socket.to(targetSocketId).emit('webrtc:ice-candidate', {
    fromSocketId: socket.id,
    fromUserId: socket.data.userId,
    roomId,
    candidate,
  });
}

async function handleDisconnect(io: SignalingServer, socket: SignalingSocket): Promise<void> {
  const roomId = socket.data.currentRoomId ?? (await redisService.getSocketRoom(socket.id));

  if (!roomId) {
    return;
  }

  const wasActiveParticipant = await redisService.removeRoomParticipant(roomId, socket.id);
  socket.data.currentRoomId = null;

  if (!wasActiveParticipant) {
    socket.data.currentDatabaseRoomId = null;
    return;
  }

  io.to(roomId).emit('user-disconnected', {
    socketId: socket.id,
    userId: socket.data.userId,
    roomId,
  });

  await prisma.roomParticipant.updateMany({
    where: {
      userId: socket.data.userId,
      roomId: socket.data.currentDatabaseRoomId ?? roomId,
      leftAt: null,
    },
    data: {
      leftAt: new Date(),
    },
  });
  socket.data.currentDatabaseRoomId = null;
}

export function registerRoomHandlers(io: SignalingServer, socket: SignalingSocket): void {
  socket.on('room:join', (payload, callback) => {
    handleRoomJoin(io, socket, payload, callback).catch((error) => {
      console.error('room:join error:', error);
      const response: RoomJoinResponse = { success: false, error: 'Failed to join room' };
      callback?.(response);
      emitRoomError(socket, response.error!);
    });
  });

  socket.on('room:leave', (callback) => {
    handleRoomLeave(io, socket, callback).catch((error) => {
      console.error('room:leave error:', error);
      const response: RoomLeaveResponse = { success: false, error: 'Failed to leave room' };
      callback?.(response);
      emitRoomError(socket, response.error!);
    });
  });

  socket.on('webrtc:offer', (payload) => {
    handleWebRtcOffer(socket, payload);
  });

  socket.on('webrtc:answer', (payload) => {
    handleWebRtcAnswer(socket, payload);
  });

  socket.on('webrtc:ice-candidate', (payload) => {
    handleWebRtcIceCandidate(socket, payload);
  });

  socket.on('room:chat-message', (payload) => {
    handleChatMessage(io, socket, payload).catch((error) => {
      console.error('room:chat-message error:', error);
      emitRoomError(socket, 'Failed to send chat message');
    });
  });

  socket.on('disconnect', () => {
    handleDisconnect(io, socket).catch((error) => {
      console.error('disconnect cleanup error:', error);
    });
  });
}
