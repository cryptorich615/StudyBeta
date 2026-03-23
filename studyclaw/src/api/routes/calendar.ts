import { Router, Response, NextFunction } from 'express';
import { prisma } from '../../db/client.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { createError } from '../middleware/errorHandler.js';

export const calendarRouter = Router();

// GET /api/v1/calendar/events - Get upcoming events
calendarRouter.get('/events', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { start, end } = req.query;

    const events = await prisma.event.findMany({
      where: {
        userId: req.user!.id,
        ...(start && { startTime: { gte: new Date(start as string) } }),
        ...(end && { startTime: { lte: new Date(end as string) } }),
      },
      orderBy: { startTime: 'asc' },
    });

    res.json({ success: true, data: events });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/calendar/events - Create event
calendarRouter.post('/events', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { title, description, startTime, endTime, location, eventType } = req.body;

    const event = await prisma.event.create({
      data: {
        userId: req.user!.id,
        title,
        description,
        startTime: new Date(startTime),
        endTime: endTime ? new Date(endTime) : null,
        location,
        eventType: eventType || 'EVENT',
      },
    });

    res.status(201).json({ success: true, data: event });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/calendar/upcoming - Get next 7 days
calendarRouter.get('/upcoming', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const events = await prisma.event.findMany({
      where: {
        userId: req.user!.id,
        startTime: { gte: now, lte: weekLater },
      },
      orderBy: { startTime: 'asc' },
    });

    const tasks = await prisma.task.findMany({
      where: {
        userId: req.user!.id,
        dueDate: { gte: now, lte: weekLater },
        status: { not: 'COMPLETED' },
      },
      orderBy: { dueDate: 'asc' },
    });

    res.json({ success: true, data: { events, tasks } });
  } catch (error) {
    next(error);
  }
});
