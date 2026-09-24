import dotenv from 'dotenv';

dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

const isProduction = process.env.NODE_ENV === 'production';

export const config = {
  isProduction,
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  port: parseInt(process.env.PORT ?? '3000', 10),
  database: {
    url: requireEnv('DATABASE_URL'),
  },
  redis: {
    url: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  },
  jwt: {
    accessSecret: requireEnv('JWT_ACCESS_SECRET'),
    refreshSecret: requireEnv('JWT_REFRESH_SECRET'),
    accessExpiresIn: '15m' as const,
    refreshExpiresIn: '7d' as const,
    accessTtlSeconds: 15 * 60,
    refreshTtlSeconds: 7 * 24 * 60 * 60,
    refreshCookieMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
  },
  livekit: {
    apiKey: requireEnv('LIVEKIT_API_KEY'),
    apiSecret: requireEnv('LIVEKIT_API_SECRET'),
    url: requireEnv('LIVEKIT_URL'),
    tokenTtlSeconds: parseInt(process.env.LIVEKIT_TOKEN_TTL_SECONDS ?? '3600', 10),
  },
  s3: {
    region: requireEnv('AWS_REGION'),
    bucket: requireEnv('AWS_S3_BUCKET'),
    accessKeyId: requireEnv('AWS_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('AWS_SECRET_ACCESS_KEY'),
  },
};
