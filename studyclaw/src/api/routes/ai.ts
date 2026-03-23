import { Router, Response, NextFunction } from 'express';
import { prisma } from '../../db/client.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { createError } from '../middleware/errorHandler.js';

export const aiRouter = Router();

// POST /api/v1/ai/explain - Explain a concept
aiRouter.post('/explain', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { topic, level } = req.body;

    // Call AI service
    const { explainConcept } = await import('../../services/ai.js');
    const result = await explainConcept(topic, level || 'college');

    // Log request
    await prisma.aiRequest.create({
      data: {
        userId: req.user!.id,
        requestType: 'explain',
        prompt: topic,
        response: result,
      },
    });

    res.json({ success: true, data: { explanation: result } });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/ai/quiz - Generate quiz
aiRouter.post('/quiz', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { topic, difficulty, count } = req.body;

    const { generateQuiz } = await import('../../services/ai.js');
    const quiz = await generateQuiz(topic, difficulty || 'medium', count || 5);

    await prisma.aiRequest.create({
      data: {
        userId: req.user!.id,
        requestType: 'quiz',
        prompt: topic,
        response: JSON.stringify(quiz),
      },
    });

    res.json({ success: true, data: quiz });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/ai/study-plan - Generate study plan
aiRouter.post('/study-plan', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { topic, daysUntilTest, hoursPerDay } = req.body;

    const { generateStudyPlan } = await import('../../services/ai.js');
    const plan = await generateStudyPlan(topic, daysUntilTest || 7, hoursPerDay || 2);

    res.json({ success: true, data: plan });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/ai/usage - Check AI usage
aiRouter.get('/usage', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { aiQueriesUsed: true, aiQueriesLimit: true, plan: true },
    });

    res.json({
      success: true,
      data: {
        used: user?.aiQueriesUsed || 0,
        limit: user?.aiQueriesLimit || 10,
        plan: user?.plan || 'FREE',
      },
    });
  } catch (error) {
    next(error);
  }
});
