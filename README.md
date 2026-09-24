# Real-Time Collaboration Application

A real-time collaboration platform with authenticated rooms, LiveKit video calls, Socket.IO signaling, chat, file sharing, and a synchronized whiteboard.

## Features

- User registration and login with JWT access and refresh tokens
- Automatic access-token refresh while a user is active
- Create or join public rooms by room ID or slug
- Live camera and microphone controls through LiveKit
- Real-time participant presence and duplicate-session protection on refresh
- Room chat through Socket.IO
- Collaborative whiteboard with Redis-backed snapshots
- S3 presigned uploads and downloads
- PostgreSQL persistence through Prisma
- Redis-backed Socket.IO adapter and room state

## Project Structure

```text
.
├── client/          Next.js frontend
├── prisma/          Prisma schema
├── src/             Express API and Socket.IO server
├── .env.example     Backend environment template
└── package.json     Backend scripts and dependencies
```

## Prerequisites

Install or provision:

- Node.js 20 or newer
- PostgreSQL
- Redis
- A LiveKit Cloud project or self-hosted LiveKit server
- An S3-compatible bucket for file sharing

## Configuration

### Backend

Copy the environment template:

```powershell
Copy-Item .env.example .env
```

Set real values in `.env`. The important local development values are:

```env
PORT=3001
CORS_ORIGIN="http://localhost:3000"
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/DATABASE?schema=public"
REDIS_URL="redis://127.0.0.1:6379"
```

The backend also requires valid values for:

- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `LIVEKIT_URL`
- `AWS_REGION`
- `AWS_S3_BUCKET`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

Use long, unique JWT secrets outside local development. Never commit `.env` or cloud credentials.

### Frontend

Copy the client template:

```powershell
Copy-Item client\.env.example client\.env
```

Set the API URL to the backend:

```env
NEXT_PUBLIC_API_BASE_URL="http://localhost:3001"
```

The default Next.js development server runs at `http://localhost:3000`, matching the recommended backend `CORS_ORIGIN`.

## Installation

Install backend dependencies from the repository root:

```powershell
npm install
```

Install frontend dependencies:

```powershell
Push-Location client
npm install
Pop-Location
```

Generate the Prisma client and apply the schema:

```powershell
npm run db:generate
npm run db:push
```

For migration-based workflows, use:

```powershell
npm run db:migrate
```

## Running Locally

Start the backend from the repository root:

```powershell
npm run dev
```

In a second terminal, start the frontend:

```powershell
Push-Location client
npm run dev
Pop-Location
```

Open [http://localhost:3000](http://localhost:3000).

## Production Builds

Build the backend:

```powershell
npm run build
npm start
```

Build and start the frontend:

```powershell
Push-Location client
npm run build
npm start
Pop-Location
```

## Validation

Run the backend TypeScript build:

```powershell
npm run build
```

Run the client production build:

```powershell
Push-Location client
npm run build
Pop-Location
```

Check the backend health endpoint at `http://localhost:3001/health` when the server is running.

## Authentication Behavior

Access tokens are short-lived. The client automatically calls `/api/auth/refresh` using the HTTP-only refresh-token cookie, stores the rotated access token, retries failed authenticated requests, and refreshes Socket.IO credentials while a room is open. A user is signed out only when the refresh token is expired, revoked, or invalid.

## Room Refresh Behavior

A browser refresh creates a new Socket.IO connection before the old connection's heartbeat timeout may finish. The server tracks one active socket per user per room and replaces stale socket records atomically in Redis, preventing the same account from appearing multiple times.

## Notes

- Ensure PostgreSQL and Redis are running before starting the backend.
- LiveKit must be reachable from the browser for video and audio to work.
- S3 bucket CORS rules must allow browser presigned POST uploads from the frontend origin.
- The client build may warn about multiple lockfiles because the backend and frontend maintain separate dependency trees.
