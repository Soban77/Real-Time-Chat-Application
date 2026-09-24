import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import {
  PresignedDownloadResult,
  PresignedUploadInput,
  PresignedUploadResult,
} from '../types/files';

const DOWNLOAD_EXPIRES_SECONDS = 60 * 60;
const UPLOAD_EXPIRES_SECONDS = 15 * 60;
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'application/zip',
  'application/x-zip-compressed',
  'video/mp4',
  'audio/mpeg',
  'audio/wav',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

class S3Service {
  private readonly client: S3Client;

  constructor() {
    this.client = new S3Client({
      region: config.s3.region,
      credentials: {
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey,
      },
    });
  }

  validateUploadRequest(contentType: string, size: number): string | null {
    if (!Number.isFinite(size) || size <= 0) {
      return 'File size must be greater than zero';
    }

    if (size > MAX_FILE_SIZE_BYTES) {
      return `File size exceeds the ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB limit`;
    }

    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      return 'File type is not allowed';
    }

    return null;
  }

  buildObjectKey(roomId: string, userId: string, filename: string): string {
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `rooms/${roomId}/users/${userId}/${uuidv4()}-${sanitizedFilename}`;
  }

  async createPresignedUpload(input: PresignedUploadInput): Promise<PresignedUploadResult> {
    const validationError = this.validateUploadRequest(input.contentType, input.size);
    if (validationError) {
      throw new Error(validationError);
    }

    const objectKey = this.buildObjectKey(input.roomId, input.userId, input.filename);

    const { url, fields } = await createPresignedPost(this.client, {
      Bucket: config.s3.bucket,
      Key: objectKey,
      Conditions: [
        ['content-length-range', 1, input.size],
        ['eq', '$Content-Type', input.contentType],
        ['eq', '$key', objectKey],
      ],
      Fields: {
        'Content-Type': input.contentType,
        key: objectKey,
      },
      Expires: UPLOAD_EXPIRES_SECONDS,
    });

    return {
      uploadUrl: url,
      fields,
      objectKey,
      expiresIn: UPLOAD_EXPIRES_SECONDS,
    };
  }

  async createPresignedDownload(objectKey: string): Promise<PresignedDownloadResult> {
    const command = new GetObjectCommand({
      Bucket: config.s3.bucket,
      Key: objectKey,
    });

    const downloadUrl = await getSignedUrl(this.client, command, {
      expiresIn: DOWNLOAD_EXPIRES_SECONDS,
    });

    return {
      downloadUrl,
      expiresIn: DOWNLOAD_EXPIRES_SECONDS,
    };
  }

  isRoomObjectKey(objectKey: string, roomId: string): boolean {
    return objectKey.startsWith(`rooms/${roomId}/`);
  }
}

export const s3Service = new S3Service();
