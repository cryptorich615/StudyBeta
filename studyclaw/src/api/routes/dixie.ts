import { Router, Response, NextFunction } from 'express';
import { prisma } from '../../db/client.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { callOpenClaw } from '../../services/openclaw.js';

// Use process.cwd() for Docker
const AGENTS_DIR = join(process.cwd(), 'src/agents');

export const dixieRouter = Router();

// Dixie system prompt loaded from file
const getDixieSystemPrompt = () => {
  const soul = readFileSync(join(AGENTS_DIR, 'dixie/SOUL.md'), 'utf-8');
  const agents = readFileSync(join(AGENTS_DIR, 'dixie/AGENTS.md'), 'utf-8');
  return `${soul}\n\n--- DIRECTIVES ---\n${agents}`;
};

// POST /api/v1/dixie/chat - Chat with Dixie (onboarding)
dixieRouter.post('/chat', async (req, res, next) => {
  try {
    const { message, userId } = req.body;

    if (!message) {
      throw new Error('Message is required');
    }

    const systemPrompt = getDixieSystemPrompt();

    // If userId provided, get their agent info for context
    let context = '';
    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { agent: true },
      });
      if (user?.agent) {
        context = `\nCURRENT STUDENT: ${user.name}\nTHEIR AGENT: ${user.agent.name} (preset: ${user.agent.preset || 'not chosen yet'})`;
      }
    }

    const response = await callOpenClaw({
      message,
      systemPrompt: systemPrompt + context,
    });

    res.json({ success: true, data: { response } });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/dixie/status - System status (Auri/Crypto only)
dixieRouter.get('/status', async (req, res, next) => {
  try {
    // Check for admin key
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_KEY}`) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const totalUsers = await prisma.user.count();
    const activeToday = await prisma.user.count({
      where: {
        updatedAt: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
        },
      },
    });

    const presetStats = await prisma.agent.groupBy({
      by: ['preset'],
      _count: { id: true },
    });

    const stats = {
      totalUsers,
      activeToday,
      presets: {
        chillVic: presetStats.find((p) => p.preset === 'CHILL_VIC')?._count.id || 0,
        sgtStrict: presetStats.find((p) => p.preset === 'SGT_STRICT')?._count.id || 0,
        custom: presetStats.find((p) => p.preset === 'CUSTOM')?._count.id || 0,
        notChosen: presetStats.find((p) => p.preset === null)?._count.id || 0,
      },
    };

    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/dixie/health - Server health check
dixieRouter.get('/health', async (req, res, next) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    
    res.json({
      success: true,
      data: {
        status: 'healthy',
        database: 'connected',
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      data: { status: 'unhealthy', database: 'disconnected' },
    });
  }
});
