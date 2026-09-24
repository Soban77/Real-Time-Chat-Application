'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { getApiBaseUrl, getStoredAccessToken, refreshAccessToken } from '@/lib/auth';
import type { ConnectionStatus, RoomParticipant } from '@/types/room';

interface RoomJoinResponse {
  success: boolean;
  roomId?: string;
  participants?: RoomParticipant[];
  error?: string;
}

interface RoomContextValue {
  roomId: string;
  socket: Socket | null;
  connectionStatus: ConnectionStatus;
  participants: RoomParticipant[];
  accessToken: string | null;
  joinRoom: () => Promise<void>;
  leaveRoom: () => void;
}

const RoomContext = createContext<RoomContextValue | null>(null);

interface RoomProviderProps {
  roomId: string;
  children: React.ReactNode;
  autoJoin?: boolean;
}

export function RoomProvider({ roomId, children, autoJoin = false }: RoomProviderProps) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [participants, setParticipants] = useState<RoomParticipant[]>([]);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  const joinRoom = useCallback(async () => {
    if (!socket) {
      throw new Error('Socket is not connected');
    }

    return new Promise<void>((resolve, reject) => {
      socket.emit('room:join', { roomId }, (response: RoomJoinResponse) => {
        if (!response?.success) {
          reject(new Error(response?.error ?? 'Failed to join room'));
          return;
        }

        if (response.participants) {
          setParticipants(response.participants);
        }

        resolve();
      });
    });
  }, [socket, roomId]);

  // 2. Stable leaveRoom callback
  const leaveRoom = useCallback(() => {
    socket?.emit('room:leave');
    setParticipants([]);
  }, [socket]);

  useEffect(() => {
    const token = getStoredAccessToken();
    setAccessToken(token);

    if (!token) {
      setConnectionStatus('disconnected');
      return;
    }

    const nextSocket = io(getApiBaseUrl(), {
      auth: { token },
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });

    const handleConnect = () => setConnectionStatus('connected');
    const handleDisconnect = () => setConnectionStatus('disconnected');
    const handleReconnectAttempt = () => setConnectionStatus('reconnecting');
    const handleConnectError = () => {
      setConnectionStatus('reconnecting');
      void refreshAccessToken().then((refreshed) => {
        if (!refreshed) {
          setAccessToken(null);
          setConnectionStatus('disconnected');
          return;
        }

        nextSocket.auth = { token: refreshed.accessToken };
        setAccessToken(refreshed.accessToken);
        nextSocket.connect();
      });
    };

    const handleParticipants = (payload: { roomId: string; participants: RoomParticipant[] }) => {
      if (payload.roomId === roomId) {
        setParticipants(payload.participants);
      }
    };

    nextSocket.on('connect', handleConnect);
    nextSocket.on('disconnect', handleDisconnect);
    nextSocket.io.on('reconnect_attempt', handleReconnectAttempt);
    nextSocket.on('connect_error', handleConnectError);
    nextSocket.on('room:participants', handleParticipants);

    setSocket(nextSocket);
    setConnectionStatus('connecting');

    const refreshTimer = window.setInterval(() => {
      void refreshAccessToken().then((refreshed) => {
        if (!refreshed) {
          nextSocket.disconnect();
          setAccessToken(null);
          return;
        }

        nextSocket.auth = { token: refreshed.accessToken };
        setAccessToken(refreshed.accessToken);
      });
    }, 10 * 60 * 1000);

    return () => {
      window.clearInterval(refreshTimer);
      nextSocket.off('connect', handleConnect);
      nextSocket.off('disconnect', handleDisconnect);
      nextSocket.io.off('reconnect_attempt', handleReconnectAttempt);
      nextSocket.off('connect_error', handleConnectError);
      nextSocket.off('room:participants', handleParticipants);
      nextSocket.disconnect();
      setSocket(null);
    };
  }, [roomId]);

  // const joinRoom = async () => {
  //   if (!socket) {
  //     throw new Error('Socket is not connected');
  //   }

  //   return new Promise<void>((resolve, reject) => {
  //     socket.emit('room:join', { roomId }, (response: RoomJoinResponse) => {
  //       if (!response?.success) {
  //         reject(new Error(response?.error ?? 'Failed to join room'));
  //         return;
  //       }

  //       if (response.participants) {
  //         setParticipants(response.participants);
  //       }

  //       resolve();
  //     });
  //   });
  // };

  // const leaveRoom = () => {
  //   socket?.emit('room:leave');
  //   setParticipants([]);
  // };

  useEffect(() => {
    if (!autoJoin || !socket || connectionStatus !== 'connected') {
      return;
    }

    joinRoom().catch(() => {
      // Join errors surface in page-level UI.
    });
  }, [autoJoin, connectionStatus, socket]);

  const value = useMemo(
    () => ({
      roomId,
      socket,
      connectionStatus,
      participants,
      accessToken,
      joinRoom,
      leaveRoom,
    }),
    [roomId, socket, connectionStatus, participants, accessToken]
  );

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}

export function useRoom(): RoomContextValue {
  const context = useContext(RoomContext);

  if (!context) {
    throw new Error('useRoom must be used within RoomProvider');
  }

  return context;
}
