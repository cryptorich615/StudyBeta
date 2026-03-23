import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../../lib/auth';
import { OpenClawClient } from '../../integrations/openclaw/openclaw.client';
import { db } from '../../lib/db';
import {
    buildStudyContext,
    buildStudyInstructions,
    loadAgentProfile,
} from '../../lib/study-context';
import { ensurePlatformSchema } from '../../lib/platform-schema';

export const studyToolsRouter = Router();
studyToolsRouter.use(requireAuth);

const openclaw = new OpenClawClient();

async function getStudentAgentRecord(userId: string) {
    const result = await db.query(`select id, name from agents where user_id = $1`, [userId]);
    return result.rows[0] ?? null;
}

async function logAgentAction(agentId: string, actionType: string, summary: string, payload: Record<string, unknown>) {
    await db.query(
        `insert into agent_actions (agent_id, action_type, summary, payload)
         values ($1, $2, $3, $4)`,
        [agentId, actionType, summary, JSON.stringify(payload)]
    );
}

function extractJsonPayload(value: string) {
    const cleaned = value
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();

    try {
        return JSON.parse(cleaned);
    } catch {
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
        }

        throw new Error('OpenClaw did not return valid JSON');
    }
}

function normalizeQuestionType(value: string | undefined) {
    const normalized = String(value ?? '').toLowerCase().replace(/[\s-]/g, '_');
    return normalized.includes('fill') ? 'fill_in_the_blank' : 'multiple_choice';
}

studyToolsRouter.get('/library', async (req: AuthedRequest, res) => {
    const [setsResult, cardsResult, quizzesResult, questionsResult] = await Promise.all([
        db.query(
            `select id, title, subject_id, source_asset_id, created_at
             from flashcard_sets
             where user_id = $1
             order by created_at desc`,
            [req.user!.id]
        ),
        db.query(
            `select id, set_id, front, back, difficulty
             from flashcards
             where set_id in (select id from flashcard_sets where user_id = $1)
             order by id asc`,
            [req.user!.id]
        ),
        db.query(
            `select id, title, mode, subject_id, source_asset_id, created_at
             from quizzes
             where user_id = $1
             order by created_at desc`,
            [req.user!.id]
        ),
        db.query(
            `select id, quiz_id, question_text, question_type, choices_json, answer_json, explanation
             from quiz_questions
             where quiz_id in (select id from quizzes where user_id = $1)
             order by id asc`,
            [req.user!.id]
        ),
    ]);

    const cardsBySet = new Map<string, any[]>();
    for (const card of cardsResult.rows) {
        const existing = cardsBySet.get(card.set_id) ?? [];
        existing.push(card);
        cardsBySet.set(card.set_id, existing);
    }

    const questionsByQuiz = new Map<string, any[]>();
    for (const question of questionsResult.rows) {
        const existing = questionsByQuiz.get(question.quiz_id) ?? [];
        existing.push({
            ...question,
            choices: question.choices_json ?? [],
            answer: question.answer_json ?? {},
        });
        questionsByQuiz.set(question.quiz_id, existing);
    }

    res.json({
        flashcardSets: setsResult.rows.map((set) => ({
            ...set,
            cards: cardsBySet.get(set.id) ?? [],
        })),
        quizzes: quizzesResult.rows.map((quiz) => ({
            ...quiz,
            questions: questionsByQuiz.get(quiz.id) ?? [],
        })),
    });
});

studyToolsRouter.post('/flashcards', async (req: AuthedRequest, res) => {
    await ensurePlatformSchema();
    const { title, text, sourceAssetId, subjectId, audienceLevel } = req.body as any;

    if (!title || !text) {
        return res.status(400).json({
            error: 'bad_request',
            message: 'title and text are required',
        });
    }

    const agent = await loadAgentProfile(req.user!.id);
    const studentAgent = await getStudentAgentRecord(req.user!.id);

    if (!agent || !studentAgent) {
        return res.status(400).json({
            error: 'missing_agent',
            message: 'Complete onboarding first',
        });
    }

    const context = await buildStudyContext(req.user!.id);
    const learnerLevel = audienceLevel || context.profile?.grade_year || context.profile?.school_level || 'current student level';

    const prompt = `
You are a study assistant.
Turn the following notes into flashcards.
Target the explanations to this learner level: ${learnerLevel}.

Return valid JSON only in this format:
{
  "cards": [
    { "front": "question", "back": "answer" }
  ]
}

Create 8 to 12 useful flashcards.
Mix the card direction so the learner sees both:
- term or question -> answer
- definition, clue, or description -> term
Do not make every card use the same direction.
Do not include any text outside the JSON.

Notes:
${text}
`;
    const reply = await openclaw.sendMessage({
        agentId: agent.openclaw_agent_id,
        instructions: buildStudyInstructions(agent.system_prompt, context),
        message: prompt,
        model: agent.model_key,
        metadata: {
            feature: 'flashcards',
            sourceAssetId,
            subjectId,
        },
        userId: req.user!.id,
    });

    let cards: { front: string; back: string }[] = [];

    try {
        const parsed = extractJsonPayload(reply.text);
        cards = (parsed.cards ?? [])
            .filter((card: any) => card?.front && card?.back)
            .map((card: any) => ({
                front: String(card.front).trim(),
                back: String(card.back).trim(),
            }));
    } catch (_err) {
        return res.status(500).json({
            error: 'parse_error',
            message: 'OpenClaw did not return valid JSON',
            raw: reply.text,
        });
    }

    const set = await db.query(
        `insert into flashcard_sets (user_id, subject_id, source_asset_id, title)
     values ($1, $2, $3, $4)
     returning *`,
        [req.user!.id, subjectId ?? null, sourceAssetId ?? null, title]
    );

    for (const card of cards) {
        await db.query(
            `insert into flashcards (set_id, front, back, difficulty)
       values ($1, $2, $3, $4)`,
            [set.rows[0].id, card.front, card.back, 2]
        );
    }

    await logAgentAction(studentAgent.id, 'flashcards_generated', `Created ${cards.length} flashcards for ${title}.`, {
        flashcardSetId: set.rows[0].id,
        sourceAssetId: sourceAssetId ?? null,
        subjectId: subjectId ?? null,
    });

    res.json({
        flashcardSetId: set.rows[0].id,
        cards,
    });
});

studyToolsRouter.post('/quiz', async (req: AuthedRequest, res) => {
    await ensurePlatformSchema();
    const { title, text, sourceAssetId, subjectId, questionCount = 10, mode = 'practice', audienceLevel } = req.body as any;

    if (!title || !text) {
        return res.status(400).json({
            error: 'bad_request',
            message: 'title and text are required',
        });
    }

    const agent = await loadAgentProfile(req.user!.id);
    const studentAgent = await getStudentAgentRecord(req.user!.id);

    if (!agent || !studentAgent) {
        return res.status(400).json({
            error: 'missing_agent',
            message: 'Complete onboarding first',
        });
    }

    const context = await buildStudyContext(req.user!.id);
    const learnerLevel = audienceLevel || context.profile?.grade_year || context.profile?.school_level || 'current student level';

    const prompt = `
You are a study assistant.
Turn the following notes into a quiz for this learner level: ${learnerLevel}.

Return valid JSON only in this format:
{
  "questions": [
    {
      "question_text": "question here",
      "question_type": "multiple_choice or fill_in_the_blank",
      "choices": ["A", "B", "C", "D"],
      "answer": { "correct": "A" },
      "explanation": "why this is correct"
    }
  ]
}

Create exactly ${questionCount} questions.
Make it a mix of multiple choice and fill in the blank.
For fill in the blank questions:
- set "question_type" to "fill_in_the_blank"
- return "choices" as []
- put the correct answer in answer.correct
For multiple choice questions:
- set "question_type" to "multiple_choice"
- return 4 answer choices
Keep the difficulty appropriate for ${learnerLevel}.
Do not include any text outside the JSON.

Notes:
${text}
`;
    const reply = await openclaw.sendMessage({
        agentId: agent.openclaw_agent_id,
        instructions: buildStudyInstructions(agent.system_prompt, context),
        message: prompt,
        model: agent.model_key,
        metadata: {
            feature: 'quiz',
            sourceAssetId,
            subjectId,
            questionCount,
            mode,
        },
        userId: req.user!.id,
    });

    let questions: {
        question_text: string;
        question_type: string;
        choices: string[];
        answer: { correct: string };
        explanation: string;
    }[] = [];

    try {
        const parsed = extractJsonPayload(reply.text);
        questions = (parsed.questions ?? [])
            .filter((question: any) => question?.question_text)
            .map((question: any) => {
                const questionType = normalizeQuestionType(question.question_type);
                return {
                    question_text: String(question.question_text).trim(),
                    question_type: questionType,
                    choices: questionType === 'multiple_choice'
                        ? (Array.isArray(question.choices) ? question.choices.map((choice: unknown) => String(choice)) : [])
                        : [],
                    answer: {
                        correct: String(question?.answer?.correct ?? question?.answer ?? '').trim(),
                    },
                    explanation: String(question.explanation ?? '').trim(),
                };
            });
    } catch (_err) {
        return res.status(500).json({
            error: 'parse_error',
            message: 'OpenClaw did not return valid JSON',
            raw: reply.text,
        });
    }

    const quiz = await db.query(
        `insert into quizzes (user_id, subject_id, source_asset_id, title, mode)
         values ($1, $2, $3, $4, $5)
         returning *`,
        [req.user!.id, subjectId ?? null, sourceAssetId ?? null, title, mode]
    );

    for (const q of questions) {
        await db.query(
            `insert into quiz_questions
             (quiz_id, question_text, question_type, choices_json, answer_json, explanation)
             values ($1, $2, $3, $4, $5, $6)`,
            [
                quiz.rows[0].id,
                q.question_text,
                q.question_type ?? 'multiple_choice',
                JSON.stringify(q.choices ?? []),
                JSON.stringify(q.answer ?? {}),
                q.explanation ?? '',
            ]
        );
    }

    await logAgentAction(studentAgent.id, 'quiz_generated', `Created ${questions.length} quiz questions for ${title}.`, {
        quizId: quiz.rows[0].id,
        sourceAssetId: sourceAssetId ?? null,
        subjectId: subjectId ?? null,
        mode,
    });

    res.json({
        quizId: quiz.rows[0].id,
        questions,
    });
});

studyToolsRouter.patch('/flashcards/:setId', async (req: AuthedRequest, res) => {
    const { title } = req.body as { title?: string };
    if (!title?.trim()) {
        return res.status(400).json({ error: 'bad_request', message: 'title is required' });
    }

    const result = await db.query(
        `update flashcard_sets
         set title = $3
         where id = $1 and user_id = $2
         returning id, title`,
        [req.params.setId, req.user!.id, title.trim()]
    );

    if (!result.rows[0]) {
        return res.status(404).json({ error: 'not_found', message: 'Flashcard set not found' });
    }

    res.json(result.rows[0]);
});

studyToolsRouter.patch('/flashcards/:setId/cards/:cardId', async (req: AuthedRequest, res) => {
    const { front, back } = req.body as { front?: string; back?: string };
    if (!front?.trim() || !back?.trim()) {
        return res.status(400).json({ error: 'bad_request', message: 'front and back are required' });
    }

    const result = await db.query(
        `update flashcards
         set front = $3, back = $4
         where id = $1
           and set_id = $2
           and set_id in (select id from flashcard_sets where user_id = $5)
         returning id, set_id, front, back, difficulty`,
        [req.params.cardId, req.params.setId, front.trim(), back.trim(), req.user!.id]
    );

    if (!result.rows[0]) {
        return res.status(404).json({ error: 'not_found', message: 'Flashcard not found' });
    }

    res.json(result.rows[0]);
});

studyToolsRouter.patch('/quizzes/:quizId', async (req: AuthedRequest, res) => {
    const { title } = req.body as { title?: string };
    if (!title?.trim()) {
        return res.status(400).json({ error: 'bad_request', message: 'title is required' });
    }

    const result = await db.query(
        `update quizzes
         set title = $3
         where id = $1 and user_id = $2
         returning id, title`,
        [req.params.quizId, req.user!.id, title.trim()]
    );

    if (!result.rows[0]) {
        return res.status(404).json({ error: 'not_found', message: 'Quiz not found' });
    }

    res.json(result.rows[0]);
});

studyToolsRouter.patch('/quizzes/:quizId/questions/:questionId', async (req: AuthedRequest, res) => {
    const { questionText, explanation } = req.body as { questionText?: string; explanation?: string };
    if (!questionText?.trim() || !explanation?.trim()) {
        return res.status(400).json({ error: 'bad_request', message: 'questionText and explanation are required' });
    }

    const result = await db.query(
        `update quiz_questions
         set question_text = $3, explanation = $4
         where id = $1
           and quiz_id = $2
           and quiz_id in (select id from quizzes where user_id = $5)
         returning id, quiz_id, question_text, explanation`,
        [req.params.questionId, req.params.quizId, questionText.trim(), explanation.trim(), req.user!.id]
    );

    if (!result.rows[0]) {
        return res.status(404).json({ error: 'not_found', message: 'Quiz question not found' });
    }

    res.json(result.rows[0]);
});
