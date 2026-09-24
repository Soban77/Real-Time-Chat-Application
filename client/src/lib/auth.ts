const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
}

export interface AuthResponse {
  user: AuthUser;
  accessToken: string;
  expiresIn: string;
}

export function getApiBaseUrl(): string {
  return API_BASE_URL;
}

export function getStoredAccessToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return localStorage.getItem('accessToken');
}

export function setStoredAccessToken(token: string): void {
  localStorage.setItem('accessToken', token);
}

export function getStoredUser(): AuthUser | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = localStorage.getItem('authUser');
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function setStoredUser(user: AuthUser): void {
  localStorage.setItem('authUser', JSON.stringify(user));
}

export function getGuestDisplayName(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return sessionStorage.getItem('guestDisplayName');
}

export function setGuestDisplayName(name: string): void {
  sessionStorage.setItem('guestDisplayName', name);
}

export function clearSession(): void {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('authUser');
  sessionStorage.removeItem('guestDisplayName');
}

let refreshRequest: Promise<AuthResponse | null> | null = null;

export async function refreshAccessToken(): Promise<AuthResponse | null> {
  if (refreshRequest) {
    return refreshRequest;
  }

  refreshRequest = fetch(`${API_BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  })
    .then(async (response) => {
      if (!response.ok) {
        clearSession();
        return null;
      }

      return persistAuth((await response.json()) as AuthResponse);
    })
    .catch(() => null)
    .finally(() => {
      refreshRequest = null;
    });

  return refreshRequest;
}

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getStoredAccessToken();

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let response = await fetch(input, { ...init, headers, credentials: 'include' });
  if (response.status !== 401) {
    return response;
  }

  const refreshed = await refreshAccessToken();
  if (!refreshed) {
    return response;
  }

  headers.set('Authorization', `Bearer ${refreshed.accessToken}`);
  response = await fetch(input, { ...init, headers, credentials: 'include' });
  return response;
}

function persistAuth(data: AuthResponse): AuthResponse {
  setStoredAccessToken(data.accessToken);
  setStoredUser(data.user);
  return data;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? 'Login failed');
  }

  return persistAuth((await response.json()) as AuthResponse);
}

export async function register(
  email: string,
  username: string,
  password: string,
  displayName?: string
): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, username, password, displayName }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? 'Registration failed');
  }

  return persistAuth((await response.json()) as AuthResponse);
}

export async function logout(): Promise<void> {
  const token = getStoredAccessToken();

  if (token) {
    await authenticatedFetch(`${API_BASE_URL}/api/auth/logout`, {
      method: 'POST',
    }).catch(() => undefined);
  }

  clearSession();
}

export interface CreatedRoom {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isPublic: boolean;
  maxCapacity: number;
  createdAt: string;
}

export async function createRoom(name: string, description?: string): Promise<CreatedRoom> {
  if (!getStoredAccessToken()) {
    throw new Error('You must be signed in to create a room');
  }

  const response = await authenticatedFetch(`${API_BASE_URL}/api/rooms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, description, isPublic: true }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? 'Failed to create room');
  }

  const data = (await response.json()) as { room: CreatedRoom };
  return data.room;
}

export async function resolveRoomId(roomIdOrSlug: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/rooms/${encodeURIComponent(roomIdOrSlug)}`);

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? 'Room not found');
  }

  const data = (await response.json()) as { room: CreatedRoom };
  return data.room.id;
}

export async function ensureGuestSession(displayName: string): Promise<AuthResponse> {
  const existingToken = getStoredAccessToken();
  const existingUser = getStoredUser();

  if (existingToken && existingUser) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return refreshed;
    }
  }

  const suffix = Math.random().toString(36).slice(2, 8);
  const username = `guest_${suffix}`;
  const email = `${username}@guest.local`;
  const password = `Guest!${suffix}${Date.now()}`;

  const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      email,
      username,
      password,
      displayName: displayName.trim() || username,
    }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? 'Failed to create guest session');
  }

  const data = (await response.json()) as AuthResponse;
  setStoredAccessToken(data.accessToken);
  setStoredUser(data.user);
  return data;
}
