'use client';

import { FormEvent, useState } from 'react';
import type { ChatMessage } from '@/types/room';

interface ChatPanelProps {
  messages: ChatMessage[];
  currentUserId: string;
  onSendMessage: (text: string) => void;
}

export function ChatPanel({ messages, currentUserId, onSendMessage }: ChatPanelProps) {
  const [draft, setDraft] = useState('');

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();

    if (!text) {
      return;
    }

    onSendMessage(text);
    setDraft('');
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 ? (
          <p className="text-sm text-slate-400">No messages yet. Say hello.</p>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`rounded-lg px-3 py-2 text-sm ${
                message.userId === currentUserId
                  ? 'ml-8 bg-accent/20 text-slate-100'
                  : 'mr-8 bg-slate-800 text-slate-200'
              }`}
            >
              <div className="mb-1 text-xs font-medium text-slate-400">{message.displayName}</div>
              <div>{message.text}</div>
            </div>
          ))
        )}
      </div>

      <form onSubmit={handleSubmit} className="border-t border-slate-700 p-3">
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Type a message"
            className="flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <button
            type="submit"
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
