import * as crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

type JwtPayload = {
  sub: string;
  email: string;
  full_name?: string;
  role?: string;
  iat: number;
  exp: number;
};

export interface AuthedRequest extends Request {
  user?: { id: string; email?: string; full_name?: string; role?: string };
}

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('Missing JWT_SECRET');
  }
  return secret;
}

function base64UrlEncode(value: string | Buffer) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8');
}

function signHmac(value: string, secret: string) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derivedKey}`;
}

export function verifyPassword(password: string, passwordHash: string) {
  const [salt, storedKey] = passwordHash.split(':');
  if (!salt || !storedKey) {
    return false;
  }

  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(derivedKey, 'hex'), Buffer.from(storedKey, 'hex'));
}

export function issueAccessToken(user: { id: string; email: string; full_name?: string | null; role?: string | null }) {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    sub: user.id,
    email: user.email,
    full_name: user.full_name ?? undefined,
    role: user.role ?? 'student',
    iat: now,
    exp: now + 60 * 60 * 24 * 7,
  };
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signHmac(`${encodedHeader}.${encodedPayload}`, getJwtSecret());
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export function verifyAccessToken(token: string): JwtPayload {
  const [encodedHeader, encodedPayload, signature] = token.split('.');
  if (!encodedHeader || !encodedPayload || !signature) {
    throw new Error('Malformed token');
  }

  const expectedSignature = signHmac(`${encodedHeader}.${encodedPayload}`, getJwtSecret());
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    throw new Error('Invalid token signature');
  }

  const payload = JSON.parse(base64UrlDecode(encodedPayload)) as JwtPayload;
  const now = Math.floor(Date.now() / 1000);
  if (!payload.sub || !payload.email || payload.exp <= now) {
    throw new Error('Token expired or invalid');
  }

  return payload;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.header('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'unauthorized', message: 'Missing bearer token.' });
  }

  try {
    const payload = verifyAccessToken(authHeader.slice('Bearer '.length).trim());
    req.user = {
      id: payload.sub,
      email: payload.email,
      full_name: payload.full_name,
      role: payload.role ?? 'student',
    };
    next();
  } catch (error) {
    return res.status(401).json({
      error: 'unauthorized',
      message: error instanceof Error ? error.message : 'Invalid token',
    });
  }
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({
        error: 'forbidden',
        message: 'Admin access is required.',
      });
    }

    return next();
  });
}
