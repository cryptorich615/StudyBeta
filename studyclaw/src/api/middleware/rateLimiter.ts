import { Request, Response, NextFunction } from 'express';

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

const store: RateLimitStore = {};

// Clean up expired entries every minute
setInterval(() => {
  const now = Date.now();
  Object.keys(store).forEach((key) => {
    if (store[key].resetTime < now) {
      delete store[key];
    }
  });
}, 60000);

export function rateLimiter(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const key = `rate:${ip}`;
  const now = Date.now();
  const windowMs = 60000; // 1 minute
  const maxRequests = 100; // per minute

  if (!store[key] || store[key].resetTime < now) {
    store[key] = {
      count: 1,
      resetTime: now + windowMs,
    };
    next();
    return;
  }

  store[key].count++;

  if (store[key].count > maxRequests) {
    res.status(429).json({
      success: false,
      error: {
        message: 'Too many requests. Please try again later.',
        retryAfter: Math.ceil((store[key].resetTime - now) / 1000),
      },
    });
    return;
  }

  next();
}
