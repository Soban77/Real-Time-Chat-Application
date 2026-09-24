import { Server, Socket } from 'socket.io';
import { s3Service } from '../services/s3.service';
import {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from '../types/socket';
import { RoomFileSharedEvent, RoomFileSharedPayload } from '../types/files';

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

function validateRoomMembership(socket: SignalingSocket, roomId: string): boolean {
  return socket.data.currentRoomId === roomId;
}

async function handleFileShared(
  io: SignalingServer,
  socket: SignalingSocket,
  payload: RoomFileSharedPayload
): Promise<void> {
  const { roomId, objectKey, filename, size, contentType } = payload;

  if (!roomId || !objectKey || !filename || !contentType || size === undefined) {
    socket.emit('room:error', { message: 'Invalid file share payload' });
    return;
  }

  if (!validateRoomMembership(socket, roomId)) {
    socket.emit('room:error', { message: 'You are not in this room' });
    return;
  }

  if (!s3Service.isRoomObjectKey(objectKey, roomId)) {
    socket.emit('room:error', { message: 'Invalid file object key for this room' });
    return;
  }

  const { downloadUrl } = await s3Service.createPresignedDownload(objectKey);

  const event: RoomFileSharedEvent = {
    fromSocketId: socket.id,
    fromUserId: socket.data.userId,
    fromUsername: socket.data.username,
    fromDisplayName: socket.data.displayName,
    roomId,
    objectKey,
    filename,
    size,
    contentType,
    downloadUrl,
    sharedAt: new Date().toISOString(),
  };

  io.to(roomId).emit('room:file-shared', event);
}

export function registerFileHandlers(io: SignalingServer, socket: SignalingSocket): void {
  socket.on('room:file-shared', (payload) => {
    handleFileShared(io, socket, payload).catch((error) => {
      console.error('room:file-shared error:', error);
      socket.emit('room:error', { message: 'Failed to share file with room' });
    });
  });
}
