import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { createError } from '../middleware/errorHandler.js';

export const flashcardsRouter = Router();

// GET /api/v1/flashcards/decks - List decks
flashcardsRouter.get('/decks', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const decks = await prisma.flashcardDeck.findMany({
      where: { userId: req.user!.id },
      include: { _count: { select: { cards: true } } },
      orderBy: { updatedAt: 'desc' },
    });

    res.json({ success: true, data: decks });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/flashcards/decks - Create deck
flashcardsRouter.post('/decks', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { title, description, tags } = req.body;

    const deck = await prisma.flashcardDeck.create({
      data: {
        userId: req.user!.id,
        title,
        description,
        tags: tags || [],
      },
    });

    res.status(201).json({ success: true, data: deck });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/flashcards/decks/:id - Get deck with cards
flashcardsRouter.get('/decks/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const deck = await prisma.flashcardDeck.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      include: { cards: true },
    });

    if (!deck) {
      throw createError('Deck not found', 404);
    }

    res.json({ success: true, data: deck });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/flashcards/decks/:id/cards - Add card to deck
flashcardsRouter.post('/decks/:id/cards', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { front, back, type } = req.body;

    // Verify deck ownership
    const deck = await prisma.flashcardDeck.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!deck) {
      throw createError('Deck not found', 404);
    }

    const card = await prisma.flashcard.create({
      data: {
        deckId: req.params.id,
        front,
        back,
        type: type || 'BASIC',
      },
    });

    res.status(201).json({ success: true, data: card });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/flashcards/generate - AI generate flashcards
flashcardsRouter.post('/generate', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { deckId, text } = req.body;

    // Call AI to generate flashcards
    const { generateFlashcards } = await import('../../services/ai.js');
    const cards = await generateFlashcards(text);

    // Create cards in deck
    if (deckId) {
      await prisma.flashcard.createMany({
        data: cards.map((card) => ({
          deckId,
          front: card.front,
          back: card.back,
          type: card.type || 'BASIC',
        })),
      });
    }

    res.json({ success: true, data: { generated: cards.length, cards } });
  } catch (error) {
    next(error);
  }
});
