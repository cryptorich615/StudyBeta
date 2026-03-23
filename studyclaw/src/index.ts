import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { authRouter } from './api/routes/auth.js';
import { agentRouter } from './api/routes/agent.js';
import { calendarRouter } from './api/routes/calendar.js';
import { flashcardsRouter } from './api/routes/flashcards.js';
import { tasksRouter } from './api/routes/tasks.js';
import { aiRouter } from './api/routes/ai.js';
import { dixieRouter } from './api/routes/dixie.js';
import { errorHandler } from './api/middleware/errorHandler.js';
import { rateLimiter } from './api/middleware/rateLimiter.js';
import { prisma } from './db/client.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(rateLimiter);

// Health check
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', error: 'Database unavailable' });
  }
});

// API Routes
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/agent', agentRouter);
app.use('/api/v1/calendar', calendarRouter);
app.use('/api/v1/flashcards', flashcardsRouter);
app.use('/api/v1/tasks', tasksRouter);
app.use('/api/v1/ai', aiRouter);
app.use('/api/v1/dixie', dixieRouter);

// Error handling
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`StudyClaw API running on port ${PORT}`);
});

export default app;
