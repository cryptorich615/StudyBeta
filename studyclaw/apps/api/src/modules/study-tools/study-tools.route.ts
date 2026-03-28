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
const MIN_FLASHCARDS = 4;
const MIN_QUIZ_QUESTIONS = 3;

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
    const trimmed = String(value ?? '').trim();
    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const candidates = [
        fencedMatch?.[1]?.trim(),
        trimmed,
        extractBalancedJson(trimmed, '{', '}'),
        extractBalancedJson(trimmed, '[', ']'),
    ].filter((candidate): candidate is string => Boolean(candidate));

    for (const candidate of candidates) {
        try {
            return JSON.parse(candidate);
        } catch {
            continue;
        }
    }

    throw new Error('OpenClaw did not return valid JSON');
}

function extractBalancedJson(value: string, openChar: '{' | '[', closeChar: '}' | ']') {
    const startIndex = value.indexOf(openChar);
    if (startIndex < 0) {
        return null;
    }

    let depth = 0;
    let inString = false;
    let escaping = false;

    for (let index = startIndex; index < value.length; index += 1) {
        const char = value[index];

        if (escaping) {
            escaping = false;
            continue;
        }

        if (char === '\\') {
            escaping = true;
            continue;
        }

        if (char === '"') {
            inString = !inString;
            continue;
        }

        if (inString) {
            continue;
        }

        if (char === openChar) {
            depth += 1;
        } else if (char === closeChar) {
            depth -= 1;
            if (depth === 0) {
                return value.slice(startIndex, index + 1);
            }
        }
    }

    return null;
}

function unwrapCollection(rawValue: unknown, keys: string[]) {
    if (Array.isArray(rawValue)) {
        return rawValue;
    }

    if (rawValue && typeof rawValue === 'object') {
        for (const key of keys) {
            const nestedValue = (rawValue as Record<string, unknown>)[key];
            if (Array.isArray(nestedValue)) {
                return nestedValue;
            }
        }
    }

    return [];
}

function normalizeQuestionType(value: string | undefined) {
    const normalized = String(value ?? '').toLowerCase().replace(/[\s-]/g, '_');
    return normalized.includes('fill') ? 'fill_in_the_blank' : 'multiple_choice';
}

function sanitizeRequiredText(value: unknown) {
    return String(value ?? '').trim();
}

function clampQuestionCount(value: unknown) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return 10;
    }

    return Math.min(Math.max(Math.round(numeric), MIN_QUIZ_QUESTIONS), 12);
}

function normalizeFlashcards(rawCards: unknown) {
    return unwrapCollection(rawCards, ['cards', 'flashcards', 'items'])
        .map((card) => ({
            front: sanitizeRequiredText((card as { front?: unknown })?.front),
            back: sanitizeRequiredText((card as { back?: unknown })?.back),
        }))
        .filter((card) => card.front && card.back);
}

function normalizeQuizQuestions(rawQuestions: unknown) {
    return unwrapCollection(rawQuestions, ['questions', 'quiz', 'items'])
        .map((question) => {
            const questionType = normalizeQuestionType((question as { question_type?: string })?.question_type);
            const choices = Array.isArray((question as { choices?: unknown[] })?.choices)
                ? (question as { choices: unknown[] }).choices
                    .map((choice) => String(choice ?? '').trim())
                    .filter(Boolean)
                : [];
            const answerValue = (question as { answer?: { correct?: unknown } | unknown })?.answer;
            const correct = sanitizeRequiredText(
                answerValue && typeof answerValue === 'object'
                    ? (answerValue as { correct?: unknown }).correct ?? ''
                    : answerValue
            );
            const isMultipleChoice = questionType === 'multiple_choice' && choices.length >= 2;

            return {
                question_text: sanitizeRequiredText((question as { question_text?: unknown })?.question_text),
                question_type: isMultipleChoice ? 'multiple_choice' : 'fill_in_the_blank',
                choices: isMultipleChoice ? choices.slice(0, 4) : [],
                answer: {
                    correct,
                },
                explanation: sanitizeRequiredText((question as { explanation?: unknown })?.explanation),
            };
        })
        .filter((question) => question.question_text && question.answer.correct);
}

function parseFlashcardsFromPlainText(value: string) {
    const text = String(value ?? '').replace(/\r/g, '').trim();
    if (!text) {
        return [];
    }

    const pairPattern =
        /(?:^|\n)\s*(?:\d+[\).:-]?\s*)?(?:front|question|q|term|prompt)\s*:\s*(.+?)\n\s*(?:back|answer|a|definition|explanation|response)\s*:\s*(.+?)(?=\n\s*(?:\d+[\).:-]?\s*)?(?:front|question|q|term|prompt)\s*:|\n{2,}|$)/gis;
    const pairs = Array.from(text.matchAll(pairPattern))
        .map((match) => ({
            front: sanitizeRequiredText(match[1]),
            back: sanitizeRequiredText(match[2]),
        }))
        .filter((card) => card.front && card.back);

    if (pairs.length >= MIN_FLASHCARDS) {
        return pairs;
    }

    const colonPairs = text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.replace(/^[\-\*\d.\)\s]+/, ''))
        .map((line) => {
            const separatorIndex = line.indexOf(':');
            if (separatorIndex < 1) {
                return null;
            }

            const front = sanitizeRequiredText(line.slice(0, separatorIndex));
            const back = sanitizeRequiredText(line.slice(separatorIndex + 1));
            if (!front || !back || front.length < 2 || back.length < 2) {
                return null;
            }

            return { front, back };
        })
        .filter((card): card is { front: string; back: string } => Boolean(card));

    return colonPairs;
}

async function repairStructuredReply(
    userId: string,
    agentId: string,
    model: string,
    instructions: string,
    replyText: string,
    kind: 'flashcards' | 'quiz'
) {
    const format =
        kind === 'flashcards'
            ? '{ "cards": [{ "front": "question", "back": "answer" }] }'
            : '{ "questions": [{ "question_text": "question", "question_type": "multiple_choice or fill_in_the_blank", "choices": ["A", "B", "C", "D"], "answer": { "correct": "A" }, "explanation": "why this is correct" }] }';

    const repairPrompt = `
Convert the following study material into valid JSON only.
Do not add commentary, markdown fences, or any text before or after the JSON.

Required format:
${format}

Content to convert:
${replyText}
`;

    const repaired = await openclaw.sendMessage({
        agentId,
        instructions,
        message: repairPrompt,
        model,
        metadata: {
            feature: `${kind}-repair`,
        },
        userId,
    });

    return repaired.text;
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
    const normalizedTitle = sanitizeRequiredText(title);
    const normalizedText = sanitizeRequiredText(text);

    if (!normalizedTitle || !normalizedText) {
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
    const instructions = buildStudyInstructions(agent.system_prompt, context);

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
${normalizedText}
`;
    let reply;
    try {
        reply = await openclaw.sendMessage({
            agentId: agent.openclaw_agent_id,
            instructions,
            message: prompt,
            model: agent.model_key,
            metadata: {
                feature: 'flashcards',
                sourceAssetId,
                subjectId,
            },
            userId: req.user!.id,
        });
    } catch (error) {
        return res.status(502).json({
            error: 'openclaw_error',
            message: error instanceof Error ? error.message : 'Flashcard generation failed',
        });
    }

    let cards: { front: string; back: string }[] = [];

    try {
        const parsed = extractJsonPayload(reply.text);
        cards = normalizeFlashcards(parsed);
    } catch (_err) {
        cards = parseFlashcardsFromPlainText(reply.text);
    }

    if (cards.length < MIN_FLASHCARDS) {
        try {
            const repairedText = await repairStructuredReply(
                req.user!.id,
                agent.openclaw_agent_id,
                agent.model_key,
                instructions,
                reply.text,
                'flashcards'
            );

            try {
                const repairedParsed = extractJsonPayload(repairedText);
                cards = normalizeFlashcards(repairedParsed);
            } catch {
                cards = parseFlashcardsFromPlainText(repairedText);
            }
        } catch {
            // Preserve the original validation path below.
        }
    }

    if (cards.length < MIN_FLASHCARDS) {
        return res.status(422).json({
            error: 'generation_failed',
            message: `StudyClaw could only validate ${cards.length} flashcards. Try cleaner notes or generate again.`,
            raw: reply.text,
        });
    }

    const set = await db.query(
        `insert into flashcard_sets (user_id, subject_id, source_asset_id, title)
     values ($1, $2, $3, $4)
     returning *`,
        [req.user!.id, subjectId ?? null, sourceAssetId ?? null, normalizedTitle]
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
    const normalizedTitle = sanitizeRequiredText(title);
    const normalizedText = sanitizeRequiredText(text);
    const normalizedQuestionCount = clampQuestionCount(questionCount);

    if (!normalizedTitle || !normalizedText) {
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
    const instructions = buildStudyInstructions(agent.system_prompt, context);

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

Create exactly ${normalizedQuestionCount} questions.
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
${normalizedText}
`;
    let reply;
    try {
        reply = await openclaw.sendMessage({
            agentId: agent.openclaw_agent_id,
            instructions,
            message: prompt,
            model: agent.model_key,
            metadata: {
                feature: 'quiz',
                sourceAssetId,
                subjectId,
                questionCount: normalizedQuestionCount,
                mode,
            },
            userId: req.user!.id,
        });
    } catch (error) {
        return res.status(502).json({
            error: 'openclaw_error',
            message: error instanceof Error ? error.message : 'Quiz generation failed',
        });
    }

    let questions: {
        question_text: string;
        question_type: string;
        choices: string[];
        answer: { correct: string };
        explanation: string;
    }[] = [];

    try {
        const parsed = extractJsonPayload(reply.text);
        questions = normalizeQuizQuestions(parsed);
    } catch (_err) {
        try {
            const repairedText = await repairStructuredReply(
                req.user!.id,
                agent.openclaw_agent_id,
                agent.model_key,
                instructions,
                reply.text,
                'quiz'
            );
            const repairedParsed = extractJsonPayload(repairedText);
            questions = normalizeQuizQuestions(repairedParsed);
        } catch {
            return res.status(500).json({
                error: 'parse_error',
                message: 'OpenClaw did not return valid JSON',
                raw: reply.text,
            });
        }
    }

    if (questions.length < MIN_QUIZ_QUESTIONS) {
        return res.status(422).json({
            error: 'generation_failed',
            message: `StudyClaw could only validate ${questions.length} quiz questions. Try cleaner notes or generate again.`,
        });
    }

    const quiz = await db.query(
        `insert into quizzes (user_id, subject_id, source_asset_id, title, mode)
         values ($1, $2, $3, $4, $5)
         returning *`,
        [req.user!.id, subjectId ?? null, sourceAssetId ?? null, normalizedTitle, mode]
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
