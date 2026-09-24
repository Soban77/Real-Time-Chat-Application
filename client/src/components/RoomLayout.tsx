'use client';

import { RoomProvider } from '@/context/RoomContext';
import { ToastViewport } from '@/components/ToastProvider';

interface RoomLayoutProps {
  roomId: string;
  children: React.ReactNode;
  autoJoin?: boolean;
}

export function RoomLayout({ roomId, children, autoJoin = false }: RoomLayoutProps) {
  return (
    <RoomProvider roomId={roomId} autoJoin={autoJoin}>
      <div className="min-h-screen bg-slate-950 text-slate-100">
        {children}
        <ToastViewport />
      </div>
    </RoomProvider>
  );
}
