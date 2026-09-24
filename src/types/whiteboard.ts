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

export interface WhiteboardDrawStepPayload {
  roomId: string;
  step: WhiteboardDrawStep;
}

export interface WhiteboardRoomPayload {
  roomId: string;
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
