import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ConnectionState,
  LocalParticipant,
  LocalTrackPublication,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  createLocalTracks,
} from 'livekit-client';
import { authenticatedFetch } from '@/lib/auth';

export interface RemoteParticipantTracks {
  participantSid: string;
  identity: string;
  name: string;
  videoTrack?: RemoteTrack;
  audioTrack?: RemoteTrack;
  isCameraEnabled: boolean;
  isMicrophoneEnabled: boolean;
}

export interface UseWebRTCOptions {
  roomId: string;
  accessToken: string;
  apiBaseUrl?: string;
  autoConnect?: boolean;
  onError?: (error: Error) => void;
}

export interface UseWebRTCReturn {
  room: Room | null;
  connectionState: ConnectionState;
  isConnecting: boolean;
  isReconnecting: boolean;
  localParticipant: LocalParticipant | null;
  localVideoTrack: Track | undefined;
  localAudioTrack: Track | undefined;
  remoteTracks: RemoteParticipantTracks[];
  isCameraEnabled: boolean;
  isMicrophoneEnabled: boolean;
  availableDevices: {
    audioInputs: MediaDeviceInfo[];
    videoInputs: MediaDeviceInfo[];
  };
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  toggleMicrophone: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  switchAudioDevice: (deviceId: string) => Promise<void>;
  switchVideoDevice: (deviceId: string) => Promise<void>;
  refreshDevices: () => Promise<void>;
}

interface RoomTokenResponse {
  token: string;
  url: string;
  roomName: string;
}

function mapRemoteParticipant(participant: RemoteParticipant): RemoteParticipantTracks {
  const videoPublication = participant.getTrackPublication(Track.Source.Camera);
  const audioPublication = participant.getTrackPublication(Track.Source.Microphone);

  return {
    participantSid: participant.sid,
    identity: participant.identity,
    name: participant.name || participant.identity,
    videoTrack: videoPublication?.track,
    audioTrack: audioPublication?.track,
    isCameraEnabled: participant.isCameraEnabled,
    isMicrophoneEnabled: participant.isMicrophoneEnabled,
  };
}

function collectRemoteTracks(activeRoom: Room): RemoteParticipantTracks[] {
  return Array.from(activeRoom.remoteParticipants.values()).map(mapRemoteParticipant);
}

async function fetchRoomToken(
  apiBaseUrl: string,
  roomId: string,
  accessToken: string
): Promise<RoomTokenResponse> {
  const response = await authenticatedFetch(`${apiBaseUrl}/api/rooms/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ roomId }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `Token request failed (${response.status})`);
  }

  return response.json() as Promise<RoomTokenResponse>;
}

export function useWebRTC({
  roomId,
  accessToken,
  apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000',
  autoConnect = true,
  onError,
}: UseWebRTCOptions): UseWebRTCReturn {
  const roomRef = useRef<Room | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const connectRef = useRef<(() => Promise<void>) | null>(null);

  const [room, setRoom] = useState<Room | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    ConnectionState.Disconnected
  );
  const [isConnecting, setIsConnecting] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [localParticipant, setLocalParticipant] = useState<LocalParticipant | null>(null);
  const [localVideoTrack, setLocalVideoTrack] = useState<Track | undefined>();
  const [localAudioTrack, setLocalAudioTrack] = useState<Track | undefined>();
  const [remoteTracks, setRemoteTracks] = useState<RemoteParticipantTracks[]>([]);
  const [isCameraEnabled, setIsCameraEnabled] = useState(true);
  const [isMicrophoneEnabled, setIsMicrophoneEnabled] = useState(true);
  const [availableDevices, setAvailableDevices] = useState<{
    audioInputs: MediaDeviceInfo[];
    videoInputs: MediaDeviceInfo[];
  }>({ audioInputs: [], videoInputs: [] });

  const syncLocalTracks = useCallback((participant: LocalParticipant) => {
    const videoPublication = participant.getTrackPublication(Track.Source.Camera);
    const audioPublication = participant.getTrackPublication(Track.Source.Microphone);

    setLocalVideoTrack(videoPublication?.track);
    setLocalAudioTrack(audioPublication?.track);
    setIsCameraEnabled(participant.isCameraEnabled);
    setIsMicrophoneEnabled(participant.isMicrophoneEnabled);
  }, []);

  const refreshRemoteTracks = useCallback((activeRoom: Room) => {
    setRemoteTracks(collectRemoteTracks(activeRoom));
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      const devices = await Room.getLocalDevices();
      setAvailableDevices({
        audioInputs: devices.filter((device) => device.kind === 'audioinput'),
        videoInputs: devices.filter((device) => device.kind === 'videoinput'),
      });
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error('Failed to enumerate devices'));
    }
  }, [onError]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current || !autoConnect) {
      return;
    }

    clearReconnectTimer();

    const attempt = reconnectAttemptRef.current;
    const delayMs = Math.min(1000 * 2 ** attempt, 15000);

    setIsReconnecting(true);
    reconnectTimerRef.current = setTimeout(() => {
      reconnectAttemptRef.current += 1;
      connectRef.current?.().catch((error) => {
        onError?.(error instanceof Error ? error : new Error('Reconnection failed'));
      });
    }, delayMs);
  }, [autoConnect, clearReconnectTimer, onError]);

  const attachRoomListeners = useCallback(
    (activeRoom: Room) => {
      const handleConnectionStateChanged = (state: ConnectionState) => {
        setConnectionState(state);

        if (state === ConnectionState.Connected) {
          reconnectAttemptRef.current = 0;
          setIsReconnecting(false);
          clearReconnectTimer();
        }

        if (state === ConnectionState.Disconnected) {
          scheduleReconnect();
        }
      };

      const handleParticipantChanged = () => {
        refreshRemoteTracks(activeRoom);
      };

      const handleLocalTrackPublished = () => {
        if (activeRoom.localParticipant) {
          syncLocalTracks(activeRoom.localParticipant);
        }
        refreshRemoteTracks(activeRoom);
      };

      const handleTrackSubscribed = (
        _track: RemoteTrack,
        _publication: RemoteTrackPublication,
        participant: RemoteParticipant
      ) => {
        void participant;
        refreshRemoteTracks(activeRoom);
      };

      const handleTrackUnsubscribed = (
        _track: RemoteTrack,
        _publication: RemoteTrackPublication,
        participant: RemoteParticipant
      ) => {
        void participant;
        refreshRemoteTracks(activeRoom);
      };

      const handleDisconnected = () => {
        setLocalParticipant(null);
        setLocalVideoTrack(undefined);
        setLocalAudioTrack(undefined);
        setRemoteTracks([]);
        scheduleReconnect();
      };

      const handleReconnecting = () => {
        setIsReconnecting(true);
      };

      const handleReconnected = () => {
        reconnectAttemptRef.current = 0;
        setIsReconnecting(false);
        if (activeRoom.localParticipant) {
          syncLocalTracks(activeRoom.localParticipant);
        }
        refreshRemoteTracks(activeRoom);
      };

      activeRoom
        .on(RoomEvent.ConnectionStateChanged, handleConnectionStateChanged)
        .on(RoomEvent.ParticipantConnected, handleParticipantChanged)
        .on(RoomEvent.ParticipantDisconnected, handleParticipantChanged)
        .on(RoomEvent.LocalTrackPublished, handleLocalTrackPublished)
        .on(RoomEvent.LocalTrackUnpublished, handleLocalTrackPublished)
        .on(RoomEvent.TrackSubscribed, handleTrackSubscribed)
        .on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed)
        .on(RoomEvent.TrackMuted, handleParticipantChanged)
        .on(RoomEvent.TrackUnmuted, handleParticipantChanged)
        .on(RoomEvent.Disconnected, handleDisconnected)
        .on(RoomEvent.Reconnecting, handleReconnecting)
        .on(RoomEvent.Reconnected, handleReconnected);
    },
    [clearReconnectTimer, refreshRemoteTracks, scheduleReconnect, syncLocalTracks]
  );

  const disconnect = useCallback(async () => {
    clearReconnectTimer();
    reconnectAttemptRef.current = 0;
    setIsReconnecting(false);

    const activeRoom = roomRef.current;
    if (!activeRoom) {
      return;
    }

    activeRoom.removeAllListeners();
    await activeRoom.disconnect();
    roomRef.current = null;
    setRoom(null);
    setLocalParticipant(null);
    setLocalVideoTrack(undefined);
    setLocalAudioTrack(undefined);
    setRemoteTracks([]);
    setConnectionState(ConnectionState.Disconnected);
  }, [clearReconnectTimer]);

  const connect = useCallback(async () => {
    if (!roomId || !accessToken) {
      throw new Error('roomId and accessToken are required');
    }

    if (roomRef.current?.state === ConnectionState.Connected) {
      return;
    }

    setIsConnecting(true);

    try {
      const { token, url } = await fetchRoomToken(apiBaseUrl, roomId, accessToken);

      const activeRoom =
        roomRef.current ??
        new Room({
          adaptiveStream: true,
          dynacast: true,
          videoCaptureDefaults: {
            resolution: VideoPresets.h720.resolution,
          },
        });

      if (!roomRef.current) {
        attachRoomListeners(activeRoom);
        roomRef.current = activeRoom;
        setRoom(activeRoom);
      }

      await activeRoom.connect(url, token);

      if (activeRoom.localParticipant.trackPublications.size === 0) {
        const tracks = await createLocalTracks({
          audio: true,
          video: true,
        });

        for (const track of tracks) {
          await activeRoom.localParticipant.publishTrack(track);
        }
      }

      syncLocalTracks(activeRoom.localParticipant);
      refreshRemoteTracks(activeRoom);
      await refreshDevices();

      setConnectionState(activeRoom.state);
      setLocalParticipant(activeRoom.localParticipant);
    } catch (error) {
      scheduleReconnect();
      throw error instanceof Error ? error : new Error('Failed to connect to room');
    } finally {
      if (mountedRef.current) {
        setIsConnecting(false);
      }
    }
  }, [
    accessToken,
    apiBaseUrl,
    attachRoomListeners,
    refreshDevices,
    refreshRemoteTracks,
    roomId,
    scheduleReconnect,
    syncLocalTracks,
  ]);

  connectRef.current = connect;

  const toggleMicrophone = useCallback(async () => {
    const participant = roomRef.current?.localParticipant;
    if (!participant) {
      return;
    }

    await participant.setMicrophoneEnabled(!participant.isMicrophoneEnabled);
    syncLocalTracks(participant);
  }, [syncLocalTracks]);

  const toggleCamera = useCallback(async () => {
    const participant = roomRef.current?.localParticipant;
    if (!participant) {
      return;
    }

    await participant.setCameraEnabled(!participant.isCameraEnabled);
    syncLocalTracks(participant);
  }, [syncLocalTracks]);

  const switchAudioDevice = useCallback(
    async (deviceId: string) => {
      const participant = roomRef.current?.localParticipant;
      if (!participant) {
        return;
      }

      await participant.setMicrophoneEnabled(true, { deviceId });
      syncLocalTracks(participant);
    },
    [syncLocalTracks]
  );

  const switchVideoDevice = useCallback(
    async (deviceId: string) => {
      const participant = roomRef.current?.localParticipant;
      if (!participant) {
        return;
      }

      await participant.setCameraEnabled(true, { deviceId });
      syncLocalTracks(participant);
    },
    [syncLocalTracks]
  );

  useEffect(() => {
    mountedRef.current = true;

    if (autoConnect) {
      connect().catch((error) => {
        onError?.(error instanceof Error ? error : new Error('Connection failed'));
      });
    }

    return () => {
      mountedRef.current = false;
      clearReconnectTimer();
      void disconnect();
    };
  }, [roomId, accessToken, autoConnect]);

  useEffect(() => {
    const handleDeviceChange = () => {
      void refreshDevices();
    };

    navigator.mediaDevices?.addEventListener('devicechange', handleDeviceChange);
    return () => {
      navigator.mediaDevices?.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [refreshDevices]);

  return {
    room,
    connectionState,
    isConnecting,
    isReconnecting,
    localParticipant,
    localVideoTrack,
    localAudioTrack,
    remoteTracks,
    isCameraEnabled,
    isMicrophoneEnabled,
    availableDevices,
    connect,
    disconnect,
    toggleMicrophone,
    toggleCamera,
    switchAudioDevice,
    switchVideoDevice,
    refreshDevices,
  };
}
