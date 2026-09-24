import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { authenticatedFetch } from '@/lib/auth';

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

interface PresignedUploadResponse {
  uploadUrl: string;
  fields: Record<string, string>;
  objectKey: string;
  expiresIn: number;
}

interface FileSharePanelProps {
  socket: Socket | null;
  roomId: string;
  accessToken: string;
  apiBaseUrl?: string;
  className?: string;
}

interface SharedFileEntry extends RoomFileSharedEvent {
  id: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function requestUploadUrl(
  apiBaseUrl: string,
  accessToken: string,
  roomId: string,
  file: File
): Promise<PresignedUploadResponse> {
  const response = await authenticatedFetch(`${apiBaseUrl}/api/files/upload-url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      roomId,
      filename: file.name,
      size: file.size,
      contentType: file.type || 'application/octet-stream',
    }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `Upload URL request failed (${response.status})`);
  }

  return response.json() as Promise<PresignedUploadResponse>;
}

async function uploadFileToS3(
  upload: PresignedUploadResponse,
  file: File,
  onProgress?: (progress: number) => void
): Promise<void> {
  const formData = new FormData();

  Object.entries(upload.fields).forEach(([key, value]) => {
    formData.append(key, value);
  });
  formData.append('file', file);

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable || !onProgress) {
        return;
      }

      onProgress(Math.round((event.loaded / event.total) * 100));
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }

      reject(new Error(`S3 upload failed (${xhr.status})`));
    });

    xhr.addEventListener('error', () => {
      reject(new Error('S3 upload failed due to a network error'));
    });

    xhr.open('POST', upload.uploadUrl);
    xhr.send(formData);
  });
}

export function FileSharePanel({
  socket,
  roomId,
  accessToken,
  apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000',
  className,
}: FileSharePanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sharedFiles, setSharedFiles] = useState<SharedFileEntry[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!socket) {
      return;
    }

    const handleFileShared = (payload: RoomFileSharedEvent) => {
      if (payload.roomId !== roomId) {
        return;
      }

      setSharedFiles((previous) => {
        const exists = previous.some(
          (entry) => entry.objectKey === payload.objectKey && entry.sharedAt === payload.sharedAt
        );

        if (exists) {
          return previous;
        }

        return [
          {
            ...payload,
            id: `${payload.objectKey}:${payload.sharedAt}`,
          },
          ...previous,
        ];
      });
    };

    socket.on('room:file-shared', handleFileShared);

    return () => {
      socket.off('room:file-shared', handleFileShared);
    };
  }, [roomId, socket]);

  const shareUploadedFile = useCallback(
    (objectKey: string, file: File) => {
      if (!socket) {
        throw new Error('Socket connection is not available');
      }

      socket.emit('room:file-shared', {
        roomId,
        objectKey,
        filename: file.name,
        size: file.size,
        contentType: file.type || 'application/octet-stream',
      });
    },
    [roomId, socket]
  );

  const handleFileSelected = useCallback(
    async (fileList: FileList | null) => {
      const file = fileList?.[0];
      if (!file || !socket) {
        return;
      }

      setError(null);
      setIsUploading(true);
      setUploadProgress(0);

      try {
        const upload = await requestUploadUrl(apiBaseUrl, accessToken, roomId, file);
        await uploadFileToS3(upload, file, setUploadProgress);
        shareUploadedFile(upload.objectKey, file);
      } catch (uploadError) {
        const message =
          uploadError instanceof Error ? uploadError.message : 'Failed to upload file';
        setError(message);
      } finally {
        setIsUploading(false);
        setUploadProgress(0);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    },
    [accessToken, apiBaseUrl, roomId, shareUploadedFile, socket]
  );

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: 12,
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          background: '#f9fafb',
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          disabled={isUploading || !socket}
          onChange={(event) => {
            void handleFileSelected(event.target.files);
          }}
          style={{ flex: 1 }}
        />

        {isUploading && (
          <span style={{ fontSize: 14, color: '#2563eb' }}>Uploading {uploadProgress}%</span>
        )}
      </div>

      {error && (
        <div
          style={{
            padding: 10,
            borderRadius: 8,
            background: '#fee2e2',
            color: '#991b1b',
            fontSize: 14,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Shared Files</h3>

        {sharedFiles.length === 0 ? (
          <p style={{ margin: 0, color: '#6b7280', fontSize: 14 }}>No files shared yet.</p>
        ) : (
          sharedFiles.map((file) => (
            <div
              key={file.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: 10,
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                background: '#ffffff',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, wordBreak: 'break-word' }}>
                  {file.filename}
                </div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  {file.fromDisplayName ?? file.fromUsername} · {formatFileSize(file.size)}
                </div>
              </div>

              <a
                href={file.downloadUrl}
                target="_blank"
                rel="noreferrer"
                download={file.filename}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  background: '#2563eb',
                  color: '#ffffff',
                  textDecoration: 'none',
                  fontSize: 14,
                  whiteSpace: 'nowrap',
                }}
              >
                Download
              </a>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
