import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../../lib/auth';
import { db } from '../../lib/db';

export const studyRouter = Router();
studyRouter.use(requireAuth);

// POST /api/learn/flashcard-sessions — Start a flashcard review session
studyRouter.post('/flashcard-sessions', async (req: AuthedRequest, res) => {
    const { setId } = req.body as { setId?: string };

    if (!setId) {
        return res.status(400).json({ error: 'setId is required' });
    }

    // Get the flashcard set with its cards
    const setResult = await db.query(
        `SELECT fs.*, 
            COALESCE(json_agg(json_build_object('id', f.id, 'front', f.front, 'back', f.back, 'difficulty', f.difficulty)) 
                FILTER (WHERE f.id IS NOT NULL), '[]') as cards
         FROM flashcard_sets fs
         LEFT JOIN flashcards f ON f.set_id = fs.id
         WHERE fs.id = $1 AND fs.user_id = $2
         GROUP BY fs.id`,
        [setId, req.user!.id]
    );

    if (!setResult.rows[0]) {
        return res.status(404).json({ error: 'Flashcard set not found' });
    }

    const sessionId = crypto.randomUUID();
    res.json({
        sessionId,
        set: {
            id: setResult.rows[0].id,
            title: setResult.rows[0].title,
            cards: setResult.rows[0].cards,
            totalCards: setResult.rows[0].cards.length,
        },
    });
});

// POST /api/learn/flashcard-sessions/:sessionId/review — Record card review
studyRouter.post('/flashcard-sessions/:sessionId/review', async (req: AuthedRequest, res) => {
    const { cardId, quality } = req.body as { cardId?: string; quality?: number };

    if (!cardId || quality === undefined) {
        return res.status(400).json({ error: 'cardId and quality (1-5) are required' });
    }

    // Update card difficulty based on quality (SM-2 inspired)
    // quality 1-2: again (hard), quality 3: good, quality 4-5: easy
    const difficultyMap: Record<number, string> = {
        1: 'again',
        2: 'hard',
        3: 'good',
        4: 'easy',
        5: 'perfect',
    };

    const difficulty = difficultyMap[quality] ?? 'good';

    await db.query(
        `UPDATE flashcards SET difficulty = $3 WHERE id = $1 AND set_id IN (SELECT id FROM flashcard_sets WHERE user_id = $2)`,
        [cardId, req.user!.id, difficulty]
    );

    // Log the review event
    await db.query(
        `INSERT INTO study_events (user_id, event_type, event_key, payload_json)
         VALUES ($1, 'flashcard_review', $2, $3)`,
        [
            req.user!.id,
            cardId,
            JSON.stringify({ sessionId: req.params.sessionId, quality, difficulty }),
        ]
    );

    res.json({ ok: true, difficulty });
});

// POST /api/learn/quiz-attempts — Submit a quiz attempt
studyRouter.post('/quiz-attempts', async (req: AuthedRequest, res) => {
    const { quizId, answers } = req.body as { quizId?: string; answers?: Record<string, string> };

    if (!quizId || !answers) {
        return res.status(400).json({ error: 'quizId and answers (map of questionId -> answer) are required' });
    }

    // Get the quiz with its questions
    const quizResult = await db.query(
        `SELECT q.*, 
            COALESCE(json_agg(json_build_object(
                'id', qq.id, 
                'questionText', qq.question_text, 
                'questionType', qq.question_type,
                'choices', qq.choices_json,
                'answer', qq.answer_json
            )) FILTER (WHERE qq.id IS NOT NULL), '[]') as questions
         FROM quizzes q
         LEFT JOIN quiz_questions qq ON qq.quiz_id = q.id
         WHERE q.id = $1 AND q.user_id = $2
         GROUP BY q.id`,
        [quizId, req.user!.id]
    );

    if (!quizResult.rows[0]) {
        return res.status(404).json({ error: 'Quiz not found' });
    }

    const quiz = quizResult.rows[0];
    const questions = quiz.questions;

    // Grade each answer
    const results = questions.map((q: any) => {
        const studentAnswer = answers[q.id] ?? '';
        const correctAnswer = typeof q.answer === 'string' ? q.answer : q.answer?.correct ?? '';
        const isCorrect = studentAnswer.toLowerCase().trim() === correctAnswer.toLowerCase().trim();

        return {
            questionId: q.id,
            questionText: q.questionText,
            studentAnswer,
            correctAnswer,
            isCorrect,
        };
    });

    const correctCount = results.filter((r: any) => r.isCorrect).length;
    const totalCount = results.length;
    const score = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0;

    // Store the attempt in study_events
    const eventResult = await db.query(
        `INSERT INTO study_events (user_id, event_type, event_key, payload_json)
         VALUES ($1, 'quiz_attempt', $2, $3)
         RETURNING *`,
        [
            req.user!.id,
            quizId,
            JSON.stringify({
                quizTitle: quiz.title,
                score,
                correctCount,
                totalCount,
                results,
            }),
        ]
    );

    // Log wrong answers to wrong_answer_reviews if score is low
    if (score < 70) {
        const wrongOnes = results.filter((r: any) => !r.isCorrect);
        for (const wrong of wrongOnes) {
            await db.query(
                `INSERT INTO wrong_answer_reviews 
                 (user_id, source_type, source_title, question_text, student_answer, correct_answer, concept_tags)
                 VALUES ($1, 'quiz', $2, $3, $4, $5, $6)`,
                [
                    req.user!.id,
                    quiz.title,
                    wrong.questionText,
                    wrong.studentAnswer,
                    wrong.correctAnswer,
                    [],
                ]
            );
        }
    }

    res.json({
        attemptId: eventResult.rows[0].id,
        score,
        correctCount,
        totalCount,
        results,
    });
});

// GET /api/learn/stats — Get study stats
studyRouter.get('/stats', async (req: AuthedRequest, res) => {
    const { days = 30 } = req.query as { days?: string };
    const dayCount = parseInt(days as string) || 30;

    // Study streak — consecutive days with study events
    const streakResult = await db.query(
        `WITH daily AS (
            SELECT DISTINCT DATE(occurred_at) as day
            FROM study_events
            WHERE user_id = $1 
              AND event_type IN ('study_session', 'flashcard_review', 'quiz_attempt')
              AND occurred_at > NOW() - INTERVAL '${dayCount} days'
            ORDER BY day DESC
        )
        SELECT COUNT(*) as streak FROM daily`,
        [req.user!.id]
    );

    // Total cards reviewed
    const cardsResult = await db.query(
        `SELECT COUNT(*)::int as total
         FROM study_events
         WHERE user_id = $1 AND event_type = 'flashcard_review'
           AND occurred_at > NOW() - INTERVAL '${dayCount} days'`,
        [req.user!.id]
    );

    // Quizzes taken
    const quizzesResult = await db.query(
        `SELECT COUNT(*)::int as total
         FROM study_events
         WHERE user_id = $1 AND event_type = 'quiz_attempt'
           AND occurred_at > NOW() - INTERVAL '${dayCount} days'`,
        [req.user!.id]
    );

    // Average quiz score
    const avgResult = await db.query(
        `SELECT AVG((payload_json->>'score')::numeric)::int as avg_score
         FROM study_events
         WHERE user_id = $1 AND event_type = 'quiz_attempt'
           AND occurred_at > NOW() - INTERVAL '${dayCount} days'`,
        [req.user!.id]
    );

    // Weakest concept tags (from wrong answers)
    const weakResult = await db.query(
        `SELECT unnest(concept_tags) as tag, count(*)::int as count
         FROM wrong_answer_reviews
         WHERE user_id = $1
           AND created_at > NOW() - INTERVAL '${dayCount} days'
         GROUP BY tag
         ORDER BY count DESC
         LIMIT 5`,
        [req.user!.id]
    );

    // Total study minutes
    const minsResult = await db.query(
        `SELECT SUM((payload_json->>'duration')::int)::int as total_mins
         FROM study_events
         WHERE user_id = $1 AND event_type = 'study_session'
           AND occurred_at > NOW() - INTERVAL '${dayCount} days'`,
        [req.user!.id]
    );

    res.json({
        streak: parseInt(streakResult.rows[0]?.streak ?? '0'),
        cardsReviewed: cardsResult.rows[0]?.total ?? 0,
        quizzesTaken: quizzesResult.rows[0]?.total ?? 0,
        averageScore: parseInt(avgResult.rows[0]?.avg_score ?? '0'),
        weakestTags: weakResult.rows,
        totalStudyMinutes: minsResult.rows[0]?.total_mins ?? 0,
    });
});

// GET /api/learn/quiz-attempts — Get quiz attempt history
studyRouter.get('/quiz-attempts', async (req: AuthedRequest, res) => {
    const { limit = 10 } = req.query as { limit?: string };

    const result = await db.query(
        `SELECT * FROM study_events
         WHERE user_id = $1 AND event_type = 'quiz_attempt'
         ORDER BY occurred_at DESC
         LIMIT ${parseInt(limit as string) || 10}`,
        [req.user!.id]
    );

    const attempts = result.rows.map((r) => ({
        id: r.id,
        quizTitle: r.payload_json?.quizTitle,
        score: r.payload_json?.score,
        correctCount: r.payload_json?.correctCount,
        totalCount: r.payload_json?.totalCount,
        occurredAt: r.occurred_at,
    }));

    res.json({ attempts });
});