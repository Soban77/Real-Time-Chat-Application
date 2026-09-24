'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ConnectionState } from 'livekit-client';
import { useRoom } from '@/context/RoomContext';
import { useWebRTC } from '@/hooks/useWebRTC';
import { VideoGrid } from '@/components/VideoGrid';
import { CallControls } from '@/components/CallControls';
import { WhiteboardCanvas } from '@/components/WhiteboardCanvas';
import { FileSharePanel } from '@/components/FileSharePanel';
import { ChatPanel } from '@/components/ChatPanel';
import { ParticipantList } from '@/components/ParticipantList';
import { useToast } from '@/components/ToastProvider';
import { getGuestDisplayName, getStoredUser } from '@/lib/auth';
import type { ChatMessage, MainStageView, SidebarTab } from '@/types/room';
import type { RoomFileSharedEvent } from '@/components/FileSharePanel';

interface CallRoomPageProps {}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function mapConnectionStatus(
  socketStatus: string,
  livekitState: ConnectionState,
  isReconnecting: boolean
): string {
  if (isReconnecting || livekitState === ConnectionState.Reconnecting) {
    return 'Reconnecting';
  }

  if (socketStatus === 'connecting' || livekitState === ConnectionState.Connecting) {
    return 'Connecting';
  }

  if (socketStatus === 'connected' && livekitState === ConnectionState.Connected) {
    return 'Connected';
  }

  return 'Disconnected';
}

export default function CallRoomPage(_props: CallRoomPageProps) {
  const router = useRouter();
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId;
  const { socket, connectionStatus, participants, accessToken, joinRoom, leaveRoom } = useRoom();
  const { pushToast } = useToast();

  const storedUser = getStoredUser();
  const displayName =
    getGuestDisplayName() ?? storedUser?.displayName ?? storedUser?.username ?? 'You';

  const [mainStageView, setMainStageView] = useState<MainStageView>('video');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('chat');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [callSeconds, setCallSeconds] = useState(0);
  const [hasJoinedRoom, setHasJoinedRoom] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const webrtc = useWebRTC({
    roomId,
    accessToken: accessToken ?? '',
    autoConnect: Boolean(accessToken && hasJoinedRoom),
    onError: (error) => pushToast(error.message, 'error'),
  });

  useEffect(() => {
    if (!accessToken) {
      router.replace(`/room/${roomId}/lobby`);
      return;
    }

    joinRoom()
      .then(() => setHasJoinedRoom(true))
      .catch((error) => {
        pushToast(error instanceof Error ? error.message : 'Failed to join room', 'error');
      });
  }, [accessToken, joinRoom, pushToast, roomId, router]);

  useEffect(() => {
    if (webrtc.connectionState !== ConnectionState.Connected) {
      return;
    }

    const timer = window.setInterval(() => {
      setCallSeconds((previous) => previous + 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [webrtc.connectionState]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    const handleUserJoined = (payload: {
      participant: { displayName: string | null; username: string };
    }) => {
      const name = payload.participant.displayName ?? payload.participant.username;
      pushToast(`${name} joined the meeting`, 'info');
    };

    const handleUserDisconnected = () => {
      pushToast('A participant left the meeting', 'warning');
    };

    const handleFileShared = (payload: RoomFileSharedEvent) => {
      if (payload.roomId !== roomId) {
        return;
      }

      const name = payload.fromDisplayName ?? payload.fromUsername;
      pushToast(`${name} shared ${payload.filename}`, 'success');
    };

    const handleChatMessage = (message: {
      id: string;
      roomId: string;
      userId: string;
      displayName: string;
      text: string;
      timestamp: string;
    }) => {
      if (message.roomId !== roomId) {
        return;
      }

      setChatMessages((previous) =>
        previous.some((entry) => entry.id === message.id) ? previous : [...previous, message]
      );
    };

    socket.on('user-joined', handleUserJoined);
    socket.on('user-disconnected', handleUserDisconnected);
    socket.on('room:file-shared', handleFileShared);
    socket.on('room:chat-message', handleChatMessage);

    return () => {
      socket.off('user-joined', handleUserJoined);
      socket.off('user-disconnected', handleUserDisconnected);
      socket.off('room:file-shared', handleFileShared);
      socket.off('room:chat-message', handleChatMessage);
    };
  }, [pushToast, roomId, socket]);

  const connectionLabel = useMemo(
    () => mapConnectionStatus(connectionStatus, webrtc.connectionState, webrtc.isReconnecting),
    [connectionStatus, webrtc.connectionState, webrtc.isReconnecting]
  );

  const handleCopyLink = async () => {
    const joinLink = `${window.location.origin}/room/${roomId}/lobby`;

    try {
      await navigator.clipboard.writeText(joinLink);
      setLinkCopied(true);
      pushToast('Join link copied to clipboard', 'success');
      window.setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      pushToast('Failed to copy join link', 'error');
    }
  };

  const handleSendMessage = useCallback(
    (text: string) => {
      if (!storedUser || !socket) {
        return;
      }

      socket.emit('room:chat-message', { roomId, text });
    },
    [roomId, socket, storedUser]
  );

  const handleLeave = () => {
    void webrtc.disconnect();
    leaveRoom();
    router.push(`/room/${roomId}/lobby`);
  };

  const securityBadge =
    connectionLabel === 'Connected'
      ? 'Secure · E2E media via SFU'
      : connectionLabel === 'Reconnecting'
        ? 'Reconnecting'
        : 'Not connected';

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 bg-slate-900/80 px-4 py-3 backdrop-blur">
        <div>
          <h1 className="text-lg font-semibold text-white">Room {roomId}</h1>
          <p className="text-xs text-slate-400">Collaboration session</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              void handleCopyLink();
            }}
            className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700"
          >
            {linkCopied ? 'Copied!' : 'Copy Join Link'}
          </button>

          <div className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200">
            {formatDuration(callSeconds)}
          </div>

          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              connectionLabel === 'Connected'
                ? 'bg-emerald-500/20 text-emerald-300'
                : connectionLabel === 'Reconnecting'
                  ? 'bg-amber-500/20 text-amber-300'
                  : 'bg-slate-700 text-slate-300'
            }`}
          >
            {securityBadge}
          </span>

          <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">
            {connectionLabel}
          </span>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <main className="flex flex-1 flex-col overflow-hidden p-4">
          <div className="flex-1 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 p-3">
            {mainStageView === 'video' ? (
              <VideoGrid
                localName={displayName}
                localVideoTrack={webrtc.localVideoTrack}
                isCameraEnabled={webrtc.isCameraEnabled}
                remoteTracks={webrtc.remoteTracks}
              />
            ) : (
              <WhiteboardCanvas
                socket={socket}
                roomId={roomId}
                userId={storedUser?.id ?? 'guest'}
                className="h-full"
              />
            )}
          </div>

          <div className="mt-4 flex justify-center">
            <CallControls
              isCameraEnabled={webrtc.isCameraEnabled}
              isMicrophoneEnabled={webrtc.isMicrophoneEnabled}
              mainStageView={mainStageView}
              onToggleCamera={() => {
                void webrtc.toggleCamera();
              }}
              onToggleMicrophone={() => {
                void webrtc.toggleMicrophone();
              }}
              onToggleStageView={() =>
                setMainStageView((previous) => (previous === 'video' ? 'whiteboard' : 'video'))
              }
              onToggleSidebar={() => setSidebarOpen((previous) => !previous)}
              isSidebarOpen={sidebarOpen}
              onLeave={handleLeave}
            />
          </div>
        </main>

        {sidebarOpen && (
          <aside className="flex w-full max-w-md flex-col border-l border-slate-800 bg-slate-900/70">
            <div className="grid grid-cols-3 border-b border-slate-800">
              {(['chat', 'files', 'participants'] as SidebarTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setSidebarTab(tab)}
                  className={`px-3 py-3 text-sm font-medium capitalize ${
                    sidebarTab === tab
                      ? 'border-b-2 border-accent text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-hidden">
              {sidebarTab === 'chat' && (
                <ChatPanel
                  messages={chatMessages}
                  currentUserId={storedUser?.id ?? ''}
                  onSendMessage={handleSendMessage}
                />
              )}

              {sidebarTab === 'files' && accessToken && (
                <div className="h-full overflow-y-auto p-3">
                  <FileSharePanel socket={socket} roomId={roomId} accessToken={accessToken} />
                </div>
              )}

              {sidebarTab === 'participants' && (
                <ParticipantList
                  participants={participants}
                  currentUserId={storedUser?.id ?? ''}
                />
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
