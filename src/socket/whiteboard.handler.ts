import { Server, Socket } from 'socket.io';
import { redisService } from '../services/redis.service';
import {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from '../types/socket';
import {
  WhiteboardClearEvent,
  WhiteboardDrawStepEvent,
  WhiteboardDrawStepPayload,
  WhiteboardRoomPayload,
  WhiteboardDrawStep,
  WhiteboardStroke,
} from '../types/whiteboard';

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

function strokeKey(stroke: Pick<WhiteboardStroke, 'strokeId' | 'userId'>): string {
  return `${stroke.userId}:${stroke.strokeId}`;
}

function createStrokeFromStep(step: WhiteboardDrawStep): WhiteboardStroke {
  return {
    strokeId: step.strokeId,
    userId: step.userId,
    tool: step.tool,
    color: step.color,
    strokeWidth: step.strokeWidth,
    points: step.point ? [step.point] : [...(step.points ?? [])],
  };
}

function appendStepToStroke(stroke: WhiteboardStroke, step: WhiteboardDrawStep): WhiteboardStroke {
  if (step.tool === 'pen' || step.tool === 'eraser') {
    if (!step.point) {
      return stroke;
    }

    const lastPoint = stroke.points[stroke.points.length - 1];
    if (lastPoint && lastPoint.x === step.point.x && lastPoint.y === step.point.y) {
      return stroke;
    }

    return {
      ...stroke,
      points: [...stroke.points, step.point],
    };
  }

  if (step.points && step.points.length > 0) {
    return {
      ...stroke,
      points: [...step.points],
    };
  }

  return stroke;
}

function validateRoomMembership(socket: SignalingSocket, roomId: string): boolean {
  return socket.data.currentRoomId === roomId;
}

async function persistCompletedStep(roomId: string, step: WhiteboardDrawStep): Promise<void> {
  const existingStrokes = await redisService.getWhiteboardStrokes(roomId);
  const key = strokeKey(step);
  const existing = existingStrokes.find((stroke) => strokeKey(stroke) === key);
  const updated = appendStepToStroke(existing ?? createStrokeFromStep(step), step);
  await redisService.upsertWhiteboardStroke(roomId, updated);
}

async function handleDrawStep(
  io: SignalingServer,
  socket: SignalingSocket,
  payload: WhiteboardDrawStepPayload
): Promise<void> {
  const { roomId, step } = payload;

  if (!roomId || !step) {
    socket.emit('room:error', { message: 'Invalid whiteboard draw step payload' });
    return;
  }

  if (!validateRoomMembership(socket, roomId)) {
    socket.emit('room:error', { message: 'You are not in this room' });
    return;
  }

  if (step.userId !== socket.data.userId) {
    socket.emit('room:error', { message: 'Invalid whiteboard step owner' });
    return;
  }

  if (step.isComplete) {
    await persistCompletedStep(roomId, step);
  }

  const event: WhiteboardDrawStepEvent = {
    fromSocketId: socket.id,
    fromUserId: socket.data.userId,
    roomId,
    step,
  };

  socket.to(roomId).emit('whiteboard:draw-step', event);
}

async function handleClear(
  io: SignalingServer,
  socket: SignalingSocket,
  payload: WhiteboardRoomPayload
): Promise<void> {
  const { roomId } = payload;

  if (!roomId) {
    socket.emit('room:error', { message: 'roomId is required' });
    return;
  }

  if (!validateRoomMembership(socket, roomId)) {
    socket.emit('room:error', { message: 'You are not in this room' });
    return;
  }

  await redisService.clearWhiteboard(roomId);

  const event: WhiteboardClearEvent = {
    fromSocketId: socket.id,
    fromUserId: socket.data.userId,
    roomId,
  };

  socket.to(roomId).emit('whiteboard:clear', event);
}

async function handleRequestSnapshot(
  socket: SignalingSocket,
  payload: WhiteboardRoomPayload
): Promise<void> {
  const { roomId } = payload;

  if (!roomId) {
    socket.emit('room:error', { message: 'roomId is required' });
    return;
  }

  if (!validateRoomMembership(socket, roomId)) {
    socket.emit('room:error', { message: 'You are not in this room' });
    return;
  }

  const strokes = await redisService.getWhiteboardStrokes(roomId);
  socket.emit('whiteboard:snapshot', { roomId, strokes });
}

export function registerWhiteboardHandlers(io: SignalingServer, socket: SignalingSocket): void {
  socket.on('whiteboard:draw-step', (payload) => {
    handleDrawStep(io, socket, payload).catch((error) => {
      console.error('whiteboard:draw-step error:', error);
      socket.emit('room:error', { message: 'Failed to sync whiteboard step' });
    });
  });

  socket.on('whiteboard:clear', (payload) => {
    handleClear(io, socket, payload).catch((error) => {
      console.error('whiteboard:clear error:', error);
      socket.emit('room:error', { message: 'Failed to clear whiteboard' });
    });
  });

  socket.on('whiteboard:request-snapshot', (payload) => {
    handleRequestSnapshot(socket, payload).catch((error) => {
      console.error('whiteboard:request-snapshot error:', error);
      socket.emit('room:error', { message: 'Failed to load whiteboard snapshot' });
    });
  });
}
