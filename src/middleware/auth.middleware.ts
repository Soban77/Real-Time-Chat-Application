import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { redisService } from '../services/redis.service';
import { TokenPayload } from '../types/auth';

export interface AuthenticatedRequest extends Request {
  userId: string;
  tokenJti: string;
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Access token required' });
      return;
    }

    const token = authHeader.slice(7);

    let decoded: TokenPayload;
    try {
      decoded = jwt.verify(token, config.jwt.accessSecret) as TokenPayload;
    } catch {
      res.status(401).json({ error: 'Invalid or expired access token' });
      return;
    }

    if (decoded.type !== 'access') {
      res.status(401).json({ error: 'Invalid token type' });
      return;
    }

    const isBlacklisted = await redisService.isTokenBlacklisted(decoded.jti);
    if (isBlacklisted) {
      res.status(401).json({ error: 'Token has been revoked' });
      return;
    }

    (req as AuthenticatedRequest).userId = decoded.sub;
    (req as AuthenticatedRequest).tokenJti = decoded.jti;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

export function optionalAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next();
    return;
  }

  authMiddleware(req, res, next).catch(next);
}
