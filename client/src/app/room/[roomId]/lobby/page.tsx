'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useRoom } from '@/context/RoomContext';
import { useMediaPreview } from '@/hooks/useMediaPreview';
import {
  ensureGuestSession,
  getGuestDisplayName,
  getStoredUser,
  setGuestDisplayName,
} from '@/lib/auth';

interface LobbyPageProps {}

export default function LobbyPage(_props: LobbyPageProps) {
  const router = useRouter();
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId;
  const { connectionStatus } = useRoom();

  const storedUser = getStoredUser();
  const [displayName, setDisplayName] = useState(
    getGuestDisplayName() ?? storedUser?.displayName ?? storedUser?.username ?? ''
  );
  const [audioInputId, setAudioInputId] = useState('');
  const [videoInputId, setVideoInputId] = useState('');
  const [audioOutputId, setAudioOutputId] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { videoRef, devices, error: previewError } = useMediaPreview({
    audioInputId: audioInputId || undefined,
    videoInputId: videoInputId || undefined,
    audioOutputId: audioOutputId || undefined,
  });

  useEffect(() => {
    if (!audioInputId && devices.audioInputs[0]) {
      setAudioInputId(devices.audioInputs[0].deviceId);
    }

    if (!videoInputId && devices.videoInputs[0]) {
      setVideoInputId(devices.videoInputs[0].deviceId);
    }

    if (!audioOutputId && devices.audioOutputs[0]) {
      setAudioOutputId(devices.audioOutputs[0].deviceId);
    }
  }, [audioInputId, audioOutputId, devices, videoInputId]);

  const handleJoin = async () => {
    const trimmedName = displayName.trim();

    if (!trimmedName) {
      setError('Please enter your name before joining');
      return;
    }

    setIsJoining(true);
    setError(null);

    try {
      setGuestDisplayName(trimmedName);
      sessionStorage.setItem('preferredAudioInputId', audioInputId);
      sessionStorage.setItem('preferredVideoInputId', videoInputId);
      sessionStorage.setItem('preferredAudioOutputId', audioOutputId);

      await ensureGuestSession(trimmedName);
      router.push(`/room/${roomId}`);
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : 'Failed to join meeting');
    } finally {
      setIsJoining(false);
    }
  };

  const statusLabel =
    connectionStatus === 'connected'
      ? 'Connected'
      : connectionStatus === 'connecting'
        ? 'Connecting'
        : connectionStatus === 'reconnecting'
          ? 'Reconnecting'
          : 'Disconnected';

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-4 py-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="text-sm uppercase tracking-wide text-slate-400">Meeting Lobby</p>
          <h1 className="text-3xl font-semibold text-white">Join Room {roomId}</h1>
          <p className="text-slate-400">Configure your devices and preview your camera before entering.</p>
        </div>

        <button
          type="button"
          onClick={() => router.push('/')}
          className="shrink-0 rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-700"
        >
          Back to Home
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-900">
          <div className="aspect-video bg-black">
            <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
          </div>
          <div className="border-t border-slate-700 px-4 py-3 text-sm text-slate-400">
            Live preview
          </div>
        </div>

        <div className="space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-5">
          <div>
            <label htmlFor="displayName" className="mb-2 block text-sm font-medium text-slate-300">
              Your Name
            </label>
            <input
              id="displayName"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Enter your name"
              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 outline-none focus:border-accent"
            />
          </div>

          <div>
            <label htmlFor="camera" className="mb-2 block text-sm font-medium text-slate-300">
              Camera
            </label>
            <select
              id="camera"
              value={videoInputId}
              onChange={(event) => setVideoInputId(event.target.value)}
              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 outline-none focus:border-accent"
            >
              {devices.videoInputs.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || 'Camera'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="microphone" className="mb-2 block text-sm font-medium text-slate-300">
              Microphone
            </label>
            <select
              id="microphone"
              value={audioInputId}
              onChange={(event) => setAudioInputId(event.target.value)}
              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 outline-none focus:border-accent"
            >
              {devices.audioInputs.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || 'Microphone'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="speaker" className="mb-2 block text-sm font-medium text-slate-300">
              Speaker Output
            </label>
            <select
              id="speaker"
              value={audioOutputId}
              onChange={(event) => setAudioOutputId(event.target.value)}
              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 outline-none focus:border-accent"
            >
              {devices.audioOutputs.length === 0 ? (
                <option value="">Default output</option>
              ) : (
                devices.audioOutputs.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || 'Speaker'}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm">
            <span className="text-slate-400">Connection</span>
            <span
              className={
                connectionStatus === 'connected'
                  ? 'text-emerald-400'
                  : connectionStatus === 'reconnecting'
                    ? 'text-amber-400'
                    : 'text-slate-300'
              }
            >
              {statusLabel}
            </span>
          </div>

          {(error || previewError) && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
              {error ?? previewError}
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              void handleJoin();
            }}
            disabled={isJoining}
            className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isJoining ? 'Joining...' : 'Join Meeting'}
          </button>
        </div>
      </div>
    </div>
  );
}
