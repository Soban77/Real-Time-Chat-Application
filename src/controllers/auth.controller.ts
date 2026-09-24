import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { Prisma, PrismaClient } from '@prisma/client';
import { config } from '../config';
import { redisService } from '../services/redis.service';
import { TokenPayload } from '../types/auth';

const prisma = new PrismaClient();

const REFRESH_COOKIE_NAME = 'refreshToken';
const SALT_ROUNDS = 12;

interface RegisterBody {
  email: string;
  username: string;
  password: string;
  displayName?: string;
}

interface LoginBody {
  email: string;
  password: string;
}

function generateAccessToken(userId: string): { token: string; jti: string } {
  const jti = uuidv4();
  const token = jwt.sign(
    { sub: userId, type: 'access', jti } satisfies TokenPayload,
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessExpiresIn }
  );
  return { token, jti };
}

function generateRefreshToken(userId: string): { token: string; jti: string } {
  const jti = uuidv4();
  const token = jwt.sign(
    { sub: userId, type: 'refresh', jti } satisfies TokenPayload,
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpiresIn }
  );
  return { token, jti };
}

function setRefreshTokenCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'strict',
    maxAge: config.jwt.refreshCookieMaxAgeMs,
    path: '/api/auth',
  });
}

function clearRefreshTokenCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'strict',
    path: '/api/auth',
  });
}

function getClientIp(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress;
}

async function createAuditLog(
  userId: string | null,
  action: string,
  req: Request,
  metadata?: Prisma.InputJsonValue
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId,
      action,
      entityType: 'user',
      entityId: userId ?? undefined,
      metadata: metadata ?? undefined,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent']?.slice(0, 500),
    },
  });
}

export async function register(req: Request, res: Response): Promise<void> {
  try {
    const { email, username, password, displayName } = req.body as RegisterBody;

    if (!email || !username || !password) {
      res.status(400).json({ error: 'Email, username, and password are required' });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({ error: 'Invalid email format' });
      return;
    }

    const usernameRegex = /^[a-zA-Z0-9_]{3,50}$/;
    if (!usernameRegex.test(username)) {
      res.status(400).json({ error: 'Username must be 3-50 alphanumeric characters or underscores' });
      return;
    }

    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email: email.toLowerCase() }, { username: username.toLowerCase() }] },
    });

    if (existingUser) {
      const field = existingUser.email === email.toLowerCase() ? 'email' : 'username';
      res.status(409).json({ error: `A user with this ${field} already exists` });
      return;
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        username: username.toLowerCase(),
        passwordHash,
        displayName: displayName ?? username,
      },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        createdAt: true,
      },
    });

    const { token: accessToken } = generateAccessToken(user.id);
    const { token: refreshToken, jti: refreshJti } = generateRefreshToken(user.id);

    await redisService.storeRefreshToken(
      user.id,
      refreshJti,
      config.jwt.refreshTtlSeconds
    );

    setRefreshTokenCookie(res, refreshToken);
    await createAuditLog(user.id, 'USER_REGISTERED', req);

    res.status(201).json({
      user,
      accessToken,
      expiresIn: config.jwt.accessExpiresIn,
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
}

export async function login(req: Request, res: Response): Promise<void> {
  try {
    const { email, password } = req.body as LoginBody;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user || !user.isActive) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      await createAuditLog(user.id, 'LOGIN_FAILED', req, { reason: 'invalid_password' });
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const { token: accessToken } = generateAccessToken(user.id);
    const { token: refreshToken, jti: refreshJti } = generateRefreshToken(user.id);

    await redisService.storeRefreshToken(
      user.id,
      refreshJti,
      config.jwt.refreshTtlSeconds
    );

    setRefreshTokenCookie(res, refreshToken);
    await createAuditLog(user.id, 'USER_LOGGED_IN', req);

    res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
      },
      accessToken,
      expiresIn: config.jwt.accessExpiresIn,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
}

export async function refresh(req: Request, res: Response): Promise<void> {
  try {
    const refreshToken = req.cookies[REFRESH_COOKIE_NAME] as string | undefined;

    if (!refreshToken) {
      res.status(401).json({ error: 'Refresh token required' });
      return;
    }

    let decoded: TokenPayload;
    try {
      decoded = jwt.verify(refreshToken, config.jwt.refreshSecret) as TokenPayload;
    } catch {
      clearRefreshTokenCookie(res);
      res.status(401).json({ error: 'Invalid or expired refresh token' });
      return;
    }

    if (decoded.type !== 'refresh') {
      clearRefreshTokenCookie(res);
      res.status(401).json({ error: 'Invalid token type' });
      return;
    }

    const isBlacklisted = await redisService.isTokenBlacklisted(decoded.jti);
    if (isBlacklisted) {
      clearRefreshTokenCookie(res);
      res.status(401).json({ error: 'Refresh token has been revoked' });
      return;
    }

    const isValid = await redisService.isRefreshTokenValid(decoded.sub, decoded.jti);
    if (!isValid) {
      clearRefreshTokenCookie(res);
      res.status(401).json({ error: 'Refresh token not found or expired' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      select: { id: true, email: true, username: true, displayName: true, isActive: true },
    });

    if (!user || !user.isActive) {
      clearRefreshTokenCookie(res);
      res.status(401).json({ error: 'User account is inactive' });
      return;
    }

    await redisService.revokeRefreshToken(decoded.sub, decoded.jti);
    await redisService.blacklistToken(decoded.jti, config.jwt.refreshTtlSeconds);

    const { token: newAccessToken } = generateAccessToken(user.id);
    const { token: newRefreshToken, jti: newRefreshJti } = generateRefreshToken(user.id);

    await redisService.storeRefreshToken(
      user.id,
      newRefreshJti,
      config.jwt.refreshTtlSeconds
    );

    setRefreshTokenCookie(res, newRefreshToken);
    await createAuditLog(user.id, 'TOKEN_REFRESHED', req);

    res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
      },
      accessToken: newAccessToken,
      expiresIn: config.jwt.accessExpiresIn,
    });
  } catch (error) {
    console.error('Refresh error:', error);
    res.status(500).json({ error: 'Token refresh failed' });
  }
}

export async function logout(req: Request, res: Response): Promise<void> {
  try {
    const refreshToken = req.cookies[REFRESH_COOKIE_NAME] as string | undefined;
    const authHeader = req.headers.authorization;
    let userId: string | null = null;

    if (authHeader?.startsWith('Bearer ')) {
      try {
        const accessDecoded = jwt.verify(
          authHeader.slice(7),
          config.jwt.accessSecret
        ) as TokenPayload;
        userId = accessDecoded.sub;
        const remainingTtl = accessDecoded.exp
          ? accessDecoded.exp - Math.floor(Date.now() / 1000)
          : config.jwt.accessTtlSeconds;
        if (remainingTtl > 0) {
          await redisService.blacklistToken(accessDecoded.jti, remainingTtl);
        }
      } catch {
        // Access token may already be expired; continue logout flow
      }
    }

    if (refreshToken) {
      try {
        const refreshDecoded = jwt.verify(
          refreshToken,
          config.jwt.refreshSecret
        ) as TokenPayload;
        userId = refreshDecoded.sub;
        await redisService.revokeRefreshToken(refreshDecoded.sub, refreshDecoded.jti);
        await redisService.blacklistToken(refreshDecoded.jti, config.jwt.refreshTtlSeconds);
      } catch {
        // Refresh token may already be expired
      }
    }

    clearRefreshTokenCookie(res);
    if (userId) {
      await createAuditLog(userId, 'USER_LOGGED_OUT', req);
    }

    res.status(200).json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
}
