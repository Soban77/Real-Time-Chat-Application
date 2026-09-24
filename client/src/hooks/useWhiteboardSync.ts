import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';

export type DrawingTool = 'pen' | 'eraser' | 'rectangle' | 'circle' | 'line';

export interface Point {
  x: number;
  y: number;
}

export interface WhiteboardDrawStep {
  strokeId: string;
  userId: string;
  tool: DrawingTool;
  color: string;
  strokeWidth: number;
  point?: Point;
  points?: Point[];
  isComplete: boolean;
  timestamp: number;
}

export interface WhiteboardStroke {
  strokeId: string;
  userId: string;
  tool: DrawingTool;
  color: string;
  strokeWidth: number;
  points: Point[];
}

export interface WhiteboardDrawStepEvent {
  fromSocketId: string;
  fromUserId: string;
  roomId: string;
  step: WhiteboardDrawStep;
}

export interface WhiteboardClearEvent {
  fromSocketId: string;
  fromUserId: string;
  roomId: string;
}

export interface WhiteboardSnapshotEvent {
  roomId: string;
  strokes: WhiteboardStroke[];
}

interface UseWhiteboardSyncOptions {
  socket: Socket | null;
  roomId: string;
  userId: string;
  enabled?: boolean;
}

interface UseWhiteboardSyncReturn {
  strokes: WhiteboardStroke[];
  applyLocalStep: (step: WhiteboardDrawStep) => void;
  emitDrawStep: (step: WhiteboardDrawStep) => void;
  clearCanvas: () => void;
  requestSnapshot: () => void;
}

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

function commitStroke(
  committed: WhiteboardStroke[],
  stroke: WhiteboardStroke
): WhiteboardStroke[] {
  const key = strokeKey(stroke);
  const existingIndex = committed.findIndex((entry) => strokeKey(entry) === key);

  if (existingIndex === -1) {
    return [...committed, stroke];
  }

  const next = [...committed];
  next[existingIndex] = stroke;
  return next;
}

export function useWhiteboardSync({
  socket,
  roomId,
  userId,
  enabled = true,
}: UseWhiteboardSyncOptions): UseWhiteboardSyncReturn {
  const [committedStrokes, setCommittedStrokes] = useState<WhiteboardStroke[]>([]);
  const [liveStrokes, setLiveStrokes] = useState<Record<string, WhiteboardStroke>>({});

  const committedRef = useRef(committedStrokes);
  const liveRef = useRef(liveStrokes);
  const socketIdRef = useRef<string | null>(null);

  committedRef.current = committedStrokes;
  liveRef.current = liveStrokes;

  const applyStep = useCallback((step: WhiteboardDrawStep) => {
    const key = strokeKey(step);

    setLiveStrokes((previousLive) => {
      const existing = previousLive[key] ?? createStrokeFromStep(step);
      const updated = appendStepToStroke(existing, step);

      if (!step.isComplete) {
        return { ...previousLive, [key]: updated };
      }

      const { [key]: _removed, ...remainingLive } = previousLive;
      setCommittedStrokes((previousCommitted) => commitStroke(previousCommitted, updated));
      return remainingLive;
    });
  }, []);

  const applyLocalStep = useCallback(
    (step: WhiteboardDrawStep) => {
      applyStep(step);
    },
    [applyStep]
  );

  const emitDrawStep = useCallback(
    (step: WhiteboardDrawStep) => {
      if (!socket || !roomId || !enabled) {
        return;
      }

      socket.emit('whiteboard:draw-step', { roomId, step });
    },
    [enabled, roomId, socket]
  );

  const clearCanvas = useCallback(() => {
    setCommittedStrokes([]);
    setLiveStrokes({});

    if (!socket || !roomId || !enabled) {
      return;
    }

    socket.emit('whiteboard:clear', { roomId });
  }, [enabled, roomId, socket]);

  const requestSnapshot = useCallback(() => {
    if (!socket || !roomId || !enabled) {
      return;
    }

    socket.emit('whiteboard:request-snapshot', { roomId });
  }, [enabled, roomId, socket]);

  const hydrateSnapshot = useCallback((strokes: WhiteboardStroke[]) => {
    setCommittedStrokes(strokes);
    setLiveStrokes({});
  }, []);

  useEffect(() => {
    if (!socket || !enabled) {
      return;
    }

    socketIdRef.current = socket.id ?? null;

    const handleConnect = () => {
      socketIdRef.current = socket.id ?? null;
      requestSnapshot();
    };

    const handleDrawStep = (payload: WhiteboardDrawStepEvent) => {
      if (payload.roomId !== roomId) {
        return;
      }

      if (payload.fromSocketId === socketIdRef.current) {
        return;
      }

      applyStep(payload.step);
    };

    const handleClear = (payload: WhiteboardClearEvent) => {
      if (payload.roomId !== roomId) {
        return;
      }

      if (payload.fromSocketId === socketIdRef.current) {
        return;
      }

      setCommittedStrokes([]);
      setLiveStrokes({});
    };

    const handleSnapshot = (payload: WhiteboardSnapshotEvent) => {
      if (payload.roomId !== roomId) {
        return;
      }

      hydrateSnapshot(payload.strokes);
    };

    socket.on('connect', handleConnect);
    socket.on('whiteboard:draw-step', handleDrawStep);
    socket.on('whiteboard:clear', handleClear);
    socket.on('whiteboard:snapshot', handleSnapshot);

    if (socket.connected) {
      requestSnapshot();
    }

    return () => {
      socket.off('connect', handleConnect);
      socket.off('whiteboard:draw-step', handleDrawStep);
      socket.off('whiteboard:clear', handleClear);
      socket.off('whiteboard:snapshot', handleSnapshot);
    };
  }, [applyStep, enabled, hydrateSnapshot, requestSnapshot, roomId, socket]);

  const strokes = [...committedStrokes, ...Object.values(liveStrokes)];

  return {
    strokes,
    applyLocalStep,
    emitDrawStep,
    clearCanvas,
    requestSnapshot,
  };
}
