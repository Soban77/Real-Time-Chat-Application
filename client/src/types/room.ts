export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface RoomParticipant {
  socketId: string;
  userId: string;
  username: string;
  displayName: string | null;
  joinedAt: string;
}

export interface ChatMessage {
  id: string;
  userId: string;
  displayName: string;
  text: string;
  timestamp: string;
}

export type SidebarTab = 'chat' | 'files' | 'participants';

export type MainStageView = 'video' | 'whiteboard';
