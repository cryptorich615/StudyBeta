import { Router, Response, NextFunction } from 'express';
import { prisma } from '../../db/client.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { createError } from '../middleware/errorHandler.js';

export const tasksRouter = Router();

// GET /api/v1/tasks - List tasks
tasksRouter.get('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status, priority, category } = req.query;

    const tasks = await prisma.task.findMany({
      where: {
        userId: req.user!.id,
        ...(status && { status: status as any }),
        ...(priority && { priority: priority as any }),
        ...(category && { category: category as string }),
      },
      orderBy: [
        { dueDate: 'asc' },
        { priority: 'desc' },
      ],
    });

    res.json({ success: true, data: tasks });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/tasks - Create task
tasksRouter.post('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { title, description, dueDate, priority, category, estimatedMinutes } = req.body;

    const task = await prisma.task.create({
      data: {
        userId: req.user!.id,
        title,
        description,
        dueDate: dueDate ? new Date(dueDate) : null,
        priority: priority || 'MEDIUM',
        category,
        estimatedMinutes,
      },
    });

    res.status(201).json({ success: true, data: task });
  } catch (error) {
    next(error);
  }
});

// PUT /api/v1/tasks/:id - Update task
tasksRouter.put('/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const task = await prisma.task.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!task) {
      throw createError('Task not found', 404);
    }

    const updated = await prisma.task.update({
      where: { id: req.params.id },
      data: req.body,
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});

// PUT /api/v1/tasks/:id/complete - Mark complete
tasksRouter.put('/:id/complete', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const task = await prisma.task.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!task) {
      throw createError('Task not found', 404);
    }

    const updated = await prisma.task.update({
      where: { id: req.params.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/v1/tasks/:id - Delete task
tasksRouter.delete('/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const task = await prisma.task.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!task) {
      throw createError('Task not found', 404);
    }

    await prisma.task.delete({ where: { id: req.params.id } });

    res.json({ success: true, data: { deleted: true } });
  } catch (error) {
    next(error);
  }
});
