export interface PresignedUploadInput {
  roomId: string;
  userId: string;
  filename: string;
  contentType: string;
  size: number;
}

export interface PresignedUploadResult {
  uploadUrl: string;
  fields: Record<string, string>;
  objectKey: string;
  expiresIn: number;
}

export interface PresignedDownloadResult {
  downloadUrl: string;
  expiresIn: number;
}

export interface RoomFileSharedPayload {
  roomId: string;
  objectKey: string;
  filename: string;
  size: number;
  contentType: string;
}

export interface RoomFileSharedEvent {
  fromSocketId: string;
  fromUserId: string;
  fromUsername: string;
  fromDisplayName: string | null;
  roomId: string;
  objectKey: string;
  filename: string;
  size: number;
  contentType: string;
  downloadUrl: string;
  sharedAt: string;
}
