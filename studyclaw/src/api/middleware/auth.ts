import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { createError } from '../middleware/errorHandler.js';
import { prisma } from '../../db/client.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    plan: string;
  };
}

export async function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw createError('No token provided', 401);
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, plan: true },
    });

    if (!user) {
      throw createError('User not found', 401);
    }

    req.user = user;
    next();
  } catch (error) {
    next(createError('Invalid token', 401));
  }
}

export function generateToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
}
