'use client';

interface CallControlsProps {
  isCameraEnabled: boolean;
  isMicrophoneEnabled: boolean;
  mainStageView: 'video' | 'whiteboard';
  onToggleCamera: () => void;
  onToggleMicrophone: () => void;
  onToggleStageView: () => void;
  onLeave: () => void;
  onToggleSidebar?: () => void;
  isSidebarOpen?: boolean;
}

export function CallControls({
  isCameraEnabled,
  isMicrophoneEnabled,
  mainStageView,
  onToggleCamera,
  onToggleMicrophone,
  onToggleStageView,
  onLeave,
  onToggleSidebar,
  isSidebarOpen,
}: CallControlsProps) {
  const buttonClass =
    'flex h-11 min-w-11 items-center justify-center rounded-full px-4 text-sm font-medium transition';

  return (
    <div className="flex flex-wrap items-center justify-center gap-3 rounded-2xl border border-slate-700 bg-slate-900/90 px-4 py-3 shadow-xl backdrop-blur">
      <button
        type="button"
        onClick={onToggleMicrophone}
        className={`${buttonClass} ${
          isMicrophoneEnabled ? 'bg-slate-700 text-white hover:bg-slate-600' : 'bg-rose-600 text-white hover:bg-rose-500'
        }`}
      >
        {isMicrophoneEnabled ? 'Mic On' : 'Mic Off'}
      </button>

      <button
        type="button"
        onClick={onToggleCamera}
        className={`${buttonClass} ${
          isCameraEnabled ? 'bg-slate-700 text-white hover:bg-slate-600' : 'bg-rose-600 text-white hover:bg-rose-500'
        }`}
      >
        {isCameraEnabled ? 'Camera On' : 'Camera Off'}
      </button>

      <button
        type="button"
        onClick={onToggleStageView}
        className={`${buttonClass} bg-slate-700 text-white hover:bg-slate-600`}
      >
        {mainStageView === 'video' ? 'Whiteboard' : 'Video'}
      </button>

      {onToggleSidebar && (
        <button
          type="button"
          onClick={onToggleSidebar}
          className={`${buttonClass} bg-slate-700 text-white hover:bg-slate-600`}
        >
          {isSidebarOpen ? 'Hide Panel' : 'Show Panel'}
        </button>
      )}

      <button
        type="button"
        onClick={onLeave}
        className={`${buttonClass} bg-rose-700 text-white hover:bg-rose-600`}
      >
        Leave
      </button>
    </div>
  );
}
