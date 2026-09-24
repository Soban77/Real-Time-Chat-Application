import express from 'express';
import { createServer } from 'http';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import authRoutes from './routes/auth.routes';
import roomsRoutes from './routes/rooms.routes';
import filesRoutes from './routes/files.routes';
import { redisService } from './services/redis.service';
import { createSocketServer } from './socket/socket.server';
import { config } from './config';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

app.use(cors({
  origin: config.corsOrigin,
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api/rooms', roomsRoutes);
app.use('/api/files', filesRoutes);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

async function start(): Promise<void> {
  await redisService.connect();

  const httpServer = createServer(app);
  await createSocketServer(httpServer);

  const port = process.env.PORT ?? 3000;
  httpServer.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log('Socket.io signaling server ready');
  });
}

start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

export default app;
