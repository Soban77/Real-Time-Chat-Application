'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  clearSession,
  createRoom,
  getStoredUser,
  login,
  logout,
  register,
  resolveRoomId,
  type AuthUser,
} from '@/lib/auth';

type AuthMode = 'login' | 'register';

export default function HomePage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  const [roomName, setRoomName] = useState('');
  const [roomDescription, setRoomDescription] = useState('');
  const [joinRoomId, setJoinRoomId] = useState('');

  useEffect(() => {
    setUser(getStoredUser());
  }, []);

  const handleAuthSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response =
        authMode === 'login'
          ? await login(email, password)
          : await register(email, username, password, displayName || username);

      setUser(response.user);
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : 'Authentication failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setUser(null);
  };

  const handleCreateRoom = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const room = await createRoom(roomName, roomDescription);
      router.push(`/room/${room.id}/lobby`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create room');
      setIsSubmitting(false);
    }
  };

  const handleJoinRoom = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = joinRoomId.trim();

    if (!trimmed) {
      setError('Enter a room ID or slug to join');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const roomId = await resolveRoomId(trimmed);
      router.push(`/room/${roomId}/lobby`);
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : 'Failed to join room');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10">
        <header className="space-y-3">
          <p className="text-sm uppercase tracking-[0.2em] text-slate-400">Real-Time Collaboration</p>
          <h1 className="text-4xl font-semibold text-white">Video calls, whiteboard, and file sharing</h1>
          <p className="max-w-2xl text-slate-400">
            Sign in to create a room, or join an existing meeting with a room ID or slug.
          </p>
        </header>

        {error && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            {user ? (
              <div className="space-y-5">
                <div>
                  <h2 className="text-xl font-semibold text-white">Welcome back</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Signed in as {user.displayName ?? user.username} ({user.email})
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    void handleLogout();
                  }}
                  className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex gap-2">
                  {(['login', 'register'] as AuthMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setAuthMode(mode)}
                      className={`rounded-lg px-4 py-2 text-sm font-medium capitalize ${
                        authMode === mode
                          ? 'bg-accent text-white'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>

                <form onSubmit={(event) => void handleAuthSubmit(event)} className="space-y-4">
                  <div>
                    <label htmlFor="email" className="mb-2 block text-sm text-slate-300">
                      Email
                    </label>
                    <input
                      id="email"
                      type="email"
                      required
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-accent"
                    />
                  </div>

                  {authMode === 'register' && (
                    <>
                      <div>
                        <label htmlFor="username" className="mb-2 block text-sm text-slate-300">
                          Username
                        </label>
                        <input
                          id="username"
                          type="text"
                          required
                          value={username}
                          onChange={(event) => setUsername(event.target.value)}
                          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-accent"
                        />
                      </div>

                      <div>
                        <label htmlFor="displayName" className="mb-2 block text-sm text-slate-300">
                          Display Name
                        </label>
                        <input
                          id="displayName"
                          type="text"
                          value={displayName}
                          onChange={(event) => setDisplayName(event.target.value)}
                          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-accent"
                        />
                      </div>
                    </>
                  )}

                  <div>
                    <label htmlFor="password" className="mb-2 block text-sm text-slate-300">
                      Password
                    </label>
                    <input
                      id="password"
                      type="password"
                      required
                      minLength={8}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-accent"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
                  >
                    {isSubmitting ? 'Please wait...' : authMode === 'login' ? 'Sign In' : 'Create Account'}
                  </button>
                </form>
              </div>
            )}
          </section>

          <section className="space-y-6">
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
              <h2 className="text-xl font-semibold text-white">Create a room</h2>
              <p className="mt-1 text-sm text-slate-400">Start a new meeting and invite others.</p>

              <form onSubmit={(event) => void handleCreateRoom(event)} className="mt-5 space-y-4">
                <div>
                  <label htmlFor="roomName" className="mb-2 block text-sm text-slate-300">
                    Room name
                  </label>
                  <input
                    id="roomName"
                    type="text"
                    required
                    value={roomName}
                    onChange={(event) => setRoomName(event.target.value)}
                    placeholder="Team Standup"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-accent"
                  />
                </div>

                <div>
                  <label htmlFor="roomDescription" className="mb-2 block text-sm text-slate-300">
                    Description (optional)
                  </label>
                  <input
                    id="roomDescription"
                    type="text"
                    value={roomDescription}
                    onChange={(event) => setRoomDescription(event.target.value)}
                    placeholder="Daily sync for the engineering team"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-accent"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting || !user}
                  className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {user ? 'Create & Go to Lobby' : 'Sign in to create a room'}
                </button>
              </form>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
              <h2 className="text-xl font-semibold text-white">Join a room</h2>
              <p className="mt-1 text-sm text-slate-400">
                Paste a room ID or slug, then continue to the lobby.
              </p>

              <form onSubmit={(event) => void handleJoinRoom(event)} className="mt-5 space-y-4">
                <div>
                  <label htmlFor="joinRoomId" className="mb-2 block text-sm text-slate-300">
                    Room ID or slug
                  </label>
                  <input
                    id="joinRoomId"
                    type="text"
                    required
                    value={joinRoomId}
                    onChange={(event) => setJoinRoomId(event.target.value)}
                    placeholder="e.g. team-standup-a1b2c3d4"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-accent"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full rounded-lg border border-slate-600 bg-slate-800 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
                >
                  Go to Lobby
                </button>
              </form>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
