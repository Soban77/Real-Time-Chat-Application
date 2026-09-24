import { RTCSessionDescriptionInit, RTCIceCandidateInit } from './webrtc';
import {
  WhiteboardClearEvent,
  WhiteboardDrawStepEvent,
  WhiteboardDrawStepPayload,
  WhiteboardRoomPayload,
  WhiteboardSnapshotEvent,
} from './whiteboard';
import { RoomFileSharedEvent, RoomFileSharedPayload } from './files';

export interface RoomParticipantState {
  socketId: string;
  userId: string;
  username: string;
  displayName: string | null;
  joinedAt: string;
}

export interface RoomJoinPayload {
  roomId: string;
}

export interface WebRtcOfferPayload {
  targetSocketId: string;
  roomId: string;
  offer: RTCSessionDescriptionInit;
}

export interface WebRtcAnswerPayload {
  targetSocketId: string;
  roomId: string;
  answer: RTCSessionDescriptionInit;
}

export interface WebRtcIceCandidatePayload {
  targetSocketId: string;
  roomId: string;
  candidate: RTCIceCandidateInit;
}

export interface UserJoinedEvent {
  participant: RoomParticipantState;
}

export interface UserDisconnectedEvent {
  socketId: string;
  userId: string;
  roomId: string;
}

export interface RoomParticipantsEvent {
  roomId: string;
  participants: RoomParticipantState[];
}

export interface RoomChatMessageEvent {
  id: string;
  roomId: string;
  userId: string;
  displayName: string;
  text: string;
  timestamp: string;
}

export interface IncomingWebRtcOfferEvent {
  fromSocketId: string;
  fromUserId: string;
  roomId: string;
  offer: RTCSessionDescriptionInit;
}

export interface IncomingWebRtcAnswerEvent {
  fromSocketId: string;
  fromUserId: string;
  roomId: string;
  answer: RTCSessionDescriptionInit;
}

export interface IncomingWebRtcIceCandidateEvent {
  fromSocketId: string;
  fromUserId: string;
  roomId: string;
  candidate: RTCIceCandidateInit;
}

export interface ClientToServerEvents {
  'room:join': (payload: RoomJoinPayload, callback?: (response: RoomJoinResponse) => void) => void;
  'room:leave': (callback?: (response: RoomLeaveResponse) => void) => void;
  'webrtc:offer': (payload: WebRtcOfferPayload) => void;
  'webrtc:answer': (payload: WebRtcAnswerPayload) => void;
  'webrtc:ice-candidate': (payload: WebRtcIceCandidatePayload) => void;
  'whiteboard:draw-step': (payload: WhiteboardDrawStepPayload) => void;
  'whiteboard:clear': (payload: WhiteboardRoomPayload) => void;
  'whiteboard:request-snapshot': (payload: WhiteboardRoomPayload) => void;
  'room:file-shared': (payload: RoomFileSharedPayload) => void;
  'room:chat-message': (payload: { roomId: string; text: string }) => void;
}

export interface ServerToClientEvents {
  'room:participants': (payload: RoomParticipantsEvent) => void;
  'user-joined': (payload: UserJoinedEvent) => void;
  'user-disconnected': (payload: UserDisconnectedEvent) => void;
  'webrtc:offer': (payload: IncomingWebRtcOfferEvent) => void;
  'webrtc:answer': (payload: IncomingWebRtcAnswerEvent) => void;
  'webrtc:ice-candidate': (payload: IncomingWebRtcIceCandidateEvent) => void;
  'room:error': (payload: { message: string }) => void;
  'whiteboard:draw-step': (payload: WhiteboardDrawStepEvent) => void;
  'whiteboard:clear': (payload: WhiteboardClearEvent) => void;
  'whiteboard:snapshot': (payload: WhiteboardSnapshotEvent) => void;
  'room:file-shared': (payload: RoomFileSharedEvent) => void;
  'room:chat-message': (payload: RoomChatMessageEvent) => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  userId: string;
  tokenJti: string;
  username: string;
  displayName: string | null;
  currentRoomId: string | null;
  currentDatabaseRoomId: string | null;
}

export interface RoomJoinResponse {
  success: boolean;
  roomId?: string;
  participants?: RoomParticipantState[];
  error?: string;
}

export interface RoomLeaveResponse {
  success: boolean;
  error?: string;
}
