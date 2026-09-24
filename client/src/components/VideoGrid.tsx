'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Track } from 'livekit-client';
import type { RemoteParticipantTracks } from '@/hooks/useWebRTC';

interface VideoTileProps {
  name: string;
  videoTrack?: Track;
  isCameraEnabled: boolean;
  isLocal?: boolean;
}

function VideoTile({ name, videoTrack, isCameraEnabled, isLocal }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = videoRef.current;
    if (!element || !videoTrack) {
      return;
    }

    videoTrack.attach(element);

    return () => {
      videoTrack.detach(element);
    };
  }, [isCameraEnabled, videoTrack]);

  return (
    <div className="relative aspect-video overflow-hidden rounded-xl border border-slate-700 bg-slate-900">
      {videoTrack && isCameraEnabled ? (
        <video ref={videoRef} autoPlay playsInline muted={isLocal} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-slate-800">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-700 text-xl font-semibold text-white">
            {name.charAt(0).toUpperCase()}
          </div>
        </div>
      )}

      <div className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-xs text-white">
        {name}
        {isLocal ? ' (You)' : ''}
      </div>
    </div>
  );
}

interface VideoGridProps {
  localName: string;
  localVideoTrack?: Track;
  isCameraEnabled: boolean;
  remoteTracks: RemoteParticipantTracks[];
}

export function VideoGrid({
  localName,
  localVideoTrack,
  isCameraEnabled,
  remoteTracks,
}: VideoGridProps) {
  const totalTiles = 1 + remoteTracks.length;
  const gridClass =
    totalTiles === 1
      ? 'grid-cols-1'
      : totalTiles <= 2
        ? 'grid-cols-1 md:grid-cols-2'
        : totalTiles <= 4
          ? 'grid-cols-2'
          : 'grid-cols-2 xl:grid-cols-3';

  return (
    <div className={`grid h-full gap-3 ${gridClass}`}>
      <VideoTile
        name={localName}
        videoTrack={localVideoTrack}
        isCameraEnabled={isCameraEnabled}
        isLocal
      />

      {remoteTracks.map((participant) => (
        <VideoTile
          key={participant.participantSid}
          name={participant.name}
          videoTrack={participant.videoTrack}
          isCameraEnabled={participant.isCameraEnabled}
        />
      ))}
    </div>
  );
}
