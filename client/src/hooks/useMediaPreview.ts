'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface MediaDevicesState {
  audioInputs: MediaDeviceInfo[];
  videoInputs: MediaDeviceInfo[];
  audioOutputs: MediaDeviceInfo[];
}

interface UseMediaPreviewOptions {
  audioInputId?: string;
  videoInputId?: string;
  audioOutputId?: string;
  enabled?: boolean;
}

export function useMediaPreview({
  audioInputId,
  videoInputId,
  audioOutputId,
  enabled = true,
}: UseMediaPreviewOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDevicesState>({
    audioInputs: [],
    videoInputs: [],
    audioOutputs: [],
  });
  const [error, setError] = useState<string | null>(null);

  const refreshDevices = useCallback(async () => {
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      setDevices({
        audioInputs: allDevices.filter((device) => device.kind === 'audioinput'),
        videoInputs: allDevices.filter((device) => device.kind === 'videoinput'),
        audioOutputs: allDevices.filter((device) => device.kind === 'audiooutput'),
      });
    } catch {
      setError('Unable to enumerate media devices');
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;

    const startPreview = async () => {
      try {
        streamRef.current?.getTracks().forEach((track) => track.stop());

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: audioInputId ? { deviceId: { exact: audioInputId } } : true,
          video: videoInputId ? { deviceId: { exact: videoInputId } } : true,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }

        if (audioOutputId && 'setSinkId' in HTMLMediaElement.prototype && videoRef.current) {
          await (videoRef.current as HTMLVideoElement & { setSinkId: (id: string) => Promise<void> })
            .setSinkId(audioOutputId)
            .catch(() => undefined);
        }

        await refreshDevices();
        setError(null);
      } catch {
        setError('Camera or microphone permission denied');
      }
    };

    void startPreview();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [audioInputId, audioOutputId, enabled, refreshDevices, videoInputId]);

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
    videoRef,
    devices,
    error,
    refreshDevices,
  };
}
