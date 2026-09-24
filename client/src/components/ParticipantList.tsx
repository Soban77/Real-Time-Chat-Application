'use client';

import type { RoomParticipant } from '@/types/room';

interface ParticipantListProps {
  participants: RoomParticipant[];
  currentUserId: string;
}

export function ParticipantList({ participants, currentUserId }: ParticipantListProps) {
  return (
    <div className="h-full overflow-y-auto p-3">
      {participants.length === 0 ? (
        <p className="text-sm text-slate-400">No participants yet.</p>
      ) : (
        <ul className="space-y-2">
          {participants.map((participant) => (
            <li
              key={participant.socketId}
              className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
            >
              <div>
                <div className="text-sm font-medium text-white">
                  {participant.displayName ?? participant.username}
                  {participant.userId === currentUserId ? ' (You)' : ''}
                </div>
                <div className="text-xs text-slate-400">@{participant.username}</div>
              </div>
              <span className="rounded-full bg-emerald-500/20 px-2 py-1 text-xs text-emerald-300">
                Online
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
