import { randomUUID } from 'node:crypto';
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
import {
    ManagedUsageLimitError,
    finalizeManagedUsageEvent,
    reserveManagedUsageEvent,
} from '../../lib/managed-usage';
import {
    buildImprovementSummary,
    clamp,
    recordStudyEvent,
    updateTopicMastery,
    writeMemorySummary,
} from '../../lib/student-memory';
import {
    hasUsableStudySourceText,
    isRetryableGenerationError,
    prepareStudySourceText,
    normalizeGenerationErrorMessage,
    normalizeStudySourceText,
} from '../../lib/study-generation';
import {
    buildFallbackFlashcards,
    buildFallbackQuiz,
} from '../../lib/study-generation-fallback';
import { openLibrarySearchBooks } from '../../lib/openlibrary';
import {
    deleteSavedLibraryBook,
    listSavedLibraryBooks,
    markSavedLibraryBookOpened,
    upsertSavedLibraryBook,
} from '../../lib/library-workspace';

export const studyToolsRouter = Router();
studyToolsRouter.use(requireAuth);

const openclaw = new OpenClawClient();
const MIN_FLASHCARDS = 4;
const MIN_QUIZ_QUESTIONS = 3;
const GENERATION_RETRY_LIMIT = 2;

studyToolsRouter.get('/books/search', async (req: AuthedRequest, res) => {
    const q = String(req.query.q ?? '').trim();
    const title = String(req.query.title ?? '').trim();
    const author = String(req.query.author ?? '').trim();
    const subject = String(req.query.subject ?? '').trim();
    const isbn = String(req.query.isbn ?? '').trim();
    const limit = Math.min(Math.max(Number(req.query.limit ?? 8) || 8, 1), 20);

    if (!q && !title && !author && !subject && !isbn) {
        return res.status(400).json({
            error: 'Provide a search query, title, author, subject, or ISBN.',
        });
    }

    try {
        const result = await openLibrarySearchBooks({
            q: q || null,
            title: title || null,
            author: author || null,
            subject: subject || null,
            isbn: isbn || null,
            limit,
        });

        return res.json(result);
    } catch (error) {
        console.error('[study-tools] book search failed', {
            userId: req.user?.id ?? null,
            message: error instanceof Error ? error.message : 'Unknown Open Library error',
        });

        return res.status(502).json({
            error: error instanceof Error ? error.message : 'Book search failed',
        });
    }
});

studyToolsRouter.get('/library/books', async (req: AuthedRequest, res) => {
    await ensurePlatformSchema();
    const books = await listSavedLibraryBooks(req.user!.id);
    res.json(books);
});

studyToolsRouter.put('/library/books', async (req: AuthedRequest, res) => {
    await ensurePlatformSchema();
    try {
        const saved = await upsertSavedLibraryBook(req.user!.id, req.body ?? {});
        res.json(saved);
    } catch (error) {
        res.status(400).json({
            error: 'bad_request',
            message: error instanceof Error ? error.message : 'Could not save this book to your library',
        });
    }
});

studyToolsRouter.post('/library/books/:bookId/open', async (req: AuthedRequest, res) => {
    await ensurePlatformSchema();
    const bookId = decodeURIComponent(String(req.params.bookId ?? '').trim());
    if (!bookId) {
        return res.status(400).json({
            error: 'bad_request',
            message: 'Saved book id is required',
        });
    }

    const saved = await markSavedLibraryBookOpened(req.user!.id, bookId);
    if (!saved) {
        return res.status(404).json({
            error: 'not_found',
            message: 'Saved book not found',
        });
    }

    return res.json(saved);
});

studyToolsRouter.delete('/library/books/:bookId', async (req: AuthedRequest, res) => {
    await ensurePlatformSchema();
    const bookId = decodeURIComponent(String(req.params.bookId ?? '').trim());
    if (!bookId) {
        return res.status(400).json({
            error: 'bad_request',
            message: 'Saved book id is required',
        });
    }

    const removed = await deleteSavedLibraryBook(req.user!.id, bookId);
    if (!removed) {
        return res.status(404).json({
            error: 'not_found',
            message: 'Saved book not found',
        });
    }

    return res.json({ ok: true, bookId });
});

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

async function loadStudySourceAsset(userId: string, sourceAssetId: unknown) {
    const normalizedId = String(sourceAssetId ?? '').trim();
    if (!normalizedId) {
        return null;
    }

    const result = await db.query(
        `select id, title, processed_text, original_text
         from study_assets
         where id = $1
           and user_id = $2
         limit 1`,
        [normalizedId, userId]
    );

    return result.rows[0] ?? null;
}

async function requestOpenClawGeneration(input: {
    userId: string;
    agentId: string;
    modelKey: string;
    instructions: string;
    prompt: string;
    metadata: Record<string, unknown>;
    kind: 'flashcards' | 'quiz';
}) {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= GENERATION_RETRY_LIMIT; attempt += 1) {
        try {
            if (attempt > 1) {
                console.warn('[study-tools] retrying OpenClaw generation', {
                    kind: input.kind,
                    userId: input.userId,
                    attempt,
                });
            }

            return await openclaw.sendMessage({
                agentId: input.agentId,
                instructions: input.instructions,
                message: input.prompt,
                model: input.modelKey,
                metadata: {
                    ...input.metadata,
                    attempt,
                },
                userId: input.userId,
            });
        } catch (error) {
            lastError = error;
            if (attempt >= GENERATION_RETRY_LIMIT || !isRetryableGenerationError(error)) {
                throw error;
            }
        }
    }

    throw lastError instanceof Error ? lastError : new Error('Study generation failed');
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

function getProviderKeyFromModelKey(modelKey: string) {
    return String(modelKey ?? '').split('/')[0] || 'unknown';
}

function formatProviderLabel(providerKey: string) {
    const normalized = String(providerKey ?? '').trim().toLowerCase();
    const aliases: Record<string, string> = {
        openrouter: 'OpenRouter',
        minimax: 'MiniMax',
        ollama: 'Ollama',
        openai: 'OpenAI',
        'openai-codex': 'OpenAI Codex',
        anthropic: 'Anthropic',
        google: 'Google',
    };

    if (aliases[normalized]) {
        return aliases[normalized];
    }

    return providerKey
        .split(/[_-]/g)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
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
    const sourceAsset = await loadStudySourceAsset(req.user!.id, sourceAssetId);
    if (String(sourceAssetId ?? '').trim() && !sourceAsset) {
        return res.status(404).json({
            error: 'source_asset_not_found',
            message: 'The source note for this flashcard request could not be found.',
        });
    }

    const normalizedTitle = sanitizeRequiredText(title) || sanitizeRequiredText(sourceAsset?.title) || 'Study flashcards';
    const requestText = normalizeStudySourceText(text);
    const assetText =
        normalizeStudySourceText(sourceAsset?.processed_text) ||
        normalizeStudySourceText(sourceAsset?.original_text);
    const normalizedText =
        hasUsableStudySourceText(requestText)
            ? requestText
            : assetText || requestText;
    const preparedSource = prepareStudySourceText(normalizedText);

    if (!normalizedTitle) {
        return res.status(400).json({
            error: 'bad_request',
            message: 'A title is required before flashcards can be generated.',
        });
    }

    if (!hasUsableStudySourceText(normalizedText)) {
        return res.status(400).json({
            error: 'insufficient_source_text',
            message: 'Add more note text before generating flashcards. StudyClaw needs a little more source material to work from.',
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

    const context = await buildStudyContext(req.user!.id, { query: `${normalizedTitle}\n\n${preparedSource.text.slice(0, 600)}` });
    const learnerLevel = audienceLevel || context.profile?.grade_year || context.profile?.school_level || 'current student level';
    const instructions = buildStudyInstructions(agent.system_prompt, context);
    const usageReservation = await reserveManagedUsageEvent({
        userId: req.user!.id,
        feature: 'flashcards',
        modelKey: agent.model_key,
        eventKey: `flashcards:${sourceAssetId ?? 'ad-hoc'}:${randomUUID()}`,
        metadata: {
            title: normalizedTitle,
            sourceAssetId: sourceAssetId ?? null,
            subjectId: subjectId ?? null,
        },
    });
    const usageEventId = usageReservation.eventId;

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
${preparedSource.text}
`;
    let reply;
    let usedLocalFallback = false;
    try {
        reply = await requestOpenClawGeneration({
            userId: req.user!.id,
            agentId: agent.openclaw_agent_id,
            modelKey: agent.model_key,
            instructions,
            prompt,
            metadata: {
                feature: 'flashcards',
                sourceAssetId,
                subjectId,
                sourceLength: preparedSource.originalLength,
                sourceTruncated: preparedSource.wasTruncated,
            },
            kind: 'flashcards',
        });
    } catch (error) {
        const message = normalizeGenerationErrorMessage({
            error,
            kind: 'flashcards',
        });
        if (error instanceof ManagedUsageLimitError) {
            await finalizeManagedUsageEvent({
                eventId: usageEventId,
                success: false,
                metadata: {
                    error: error.message,
                    normalizedMessage: message,
                },
            });
            return res.status(error.statusCode).json({
                error: error.code,
                message: error.message,
                detail: error.detail,
            });
        }
        console.warn('[study-tools] falling back to local flashcard generation', {
            userId: req.user!.id,
            sourceAssetId: sourceAssetId ?? null,
            message: error instanceof Error ? error.message : String(error ?? 'Unknown flashcard generation error'),
        });
        usedLocalFallback = true;
    }

    let cards: { front: string; back: string }[] = [];

    if (reply) {
        try {
            const parsed = extractJsonPayload(reply.text);
            cards = normalizeFlashcards(parsed);
        } catch (_err) {
            cards = parseFlashcardsFromPlainText(reply.text);
        }
    }

    if (reply && cards.length < MIN_FLASHCARDS) {
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
        cards = buildFallbackFlashcards({
            title: normalizedTitle,
            text: preparedSource.text,
            desiredCount: 8,
        });
        usedLocalFallback = true;
    }

    if (cards.length < MIN_FLASHCARDS) {
        await finalizeManagedUsageEvent({
            eventId: usageEventId,
            success: false,
            metadata: {
                outcome: 'validation_failed',
                validatedCards: cards.length,
            },
        });
        return res.status(422).json({
            error: 'generation_failed',
            message: `StudyClaw could only validate ${cards.length} flashcards from that material. Try cleaner notes or add more source text.`,
        });
    }

    const client = await db.connect();
    let createdSet: any;

    try {
        await client.query('begin');
        const set = await client.query(
            `insert into flashcard_sets (user_id, subject_id, source_asset_id, title)
             values ($1, $2, $3, $4)
             returning *`,
            [req.user!.id, subjectId ?? null, sourceAssetId ?? null, normalizedTitle]
        );
        createdSet = set.rows[0];

        for (const card of cards) {
            await client.query(
                `insert into flashcards (set_id, front, back, difficulty)
                 values ($1, $2, $3, $4)`,
                [createdSet.id, card.front, card.back, 2]
            );
        }
        await client.query('commit');
    } catch (error) {
        await client.query('rollback');
        console.error('[study-tools] failed to persist flashcards', {
            userId: req.user!.id,
            sourceAssetId: sourceAssetId ?? null,
            message: error instanceof Error ? error.message : 'Unknown flashcard persistence error',
        });
        return res.status(500).json({
            error: 'flashcard_save_failed',
            message: 'Flashcards were generated but could not be saved. Please try again.',
        });
    } finally {
        client.release();
    }

    await logAgentAction(studentAgent.id, 'flashcards_generated', `Created ${cards.length} flashcards for ${normalizedTitle}.`, {
        flashcardSetId: createdSet.id,
        sourceAssetId: sourceAssetId ?? null,
        subjectId: subjectId ?? null,
    });
    const flashcardEvent = await recordStudyEvent({
        userId: req.user!.id,
        eventKey: `flashcards:${createdSet.id}:generated`,
        eventType: 'flashcards_generated',
        sourceType: 'flashcard_set',
        sourceId: createdSet.id,
        courseId: subjectId ?? null,
        payload: {
            title: normalizedTitle,
            cardCount: cards.length,
            sourceAssetId: sourceAssetId ?? null,
        },
    });
    await updateTopicMastery({
        userId: req.user!.id,
        topicName: normalizedTitle,
        courseId: subjectId ?? null,
        delta: 0.03,
        sourceEventId: flashcardEvent.id,
        notes: 'Generated flashcards from study material',
    });
    await writeMemorySummary({
        userId: req.user!.id,
        summaryType: 'flashcards_generated',
        summary: `Student generated ${cards.length} flashcards for ${normalizedTitle}.`,
        courseId: subjectId ?? null,
        sourceEventId: flashcardEvent.id,
        summaryKey: `flashcards:${createdSet.id}:generated`,
        importance: 3,
    });
    await finalizeManagedUsageEvent({
        eventId: usageEventId,
        success: true,
        metadata: {
            outcome: usedLocalFallback ? 'flashcards_generated_fallback' : 'flashcards_generated',
            flashcardSetId: createdSet.id,
            cardCount: cards.length,
            provider: usedLocalFallback ? 'local_fallback' : getProviderKeyFromModelKey(agent.model_key),
        },
    });

    res.json({
        flashcardSetId: createdSet.id,
        cards,
        generation: {
            kind: 'flashcards',
            modelKey: usedLocalFallback ? 'local-study-fallback' : agent.model_key,
            providerKey: usedLocalFallback ? 'local_fallback' : getProviderKeyFromModelKey(agent.model_key),
            providerLabel: usedLocalFallback ? 'StudyClaw Fallback' : formatProviderLabel(getProviderKeyFromModelKey(agent.model_key)),
            itemCount: cards.length,
            createdAt: new Date().toISOString(),
            fallbackUsed: usedLocalFallback,
        },
    });
});

studyToolsRouter.post('/quiz', async (req: AuthedRequest, res) => {
    await ensurePlatformSchema();
    const { title, text, sourceAssetId, subjectId, questionCount = 10, mode = 'practice', audienceLevel } = req.body as any;
    const sourceAsset = await loadStudySourceAsset(req.user!.id, sourceAssetId);
    if (String(sourceAssetId ?? '').trim() && !sourceAsset) {
        return res.status(404).json({
            error: 'source_asset_not_found',
            message: 'The source note for this quiz request could not be found.',
        });
    }

    const normalizedTitle = sanitizeRequiredText(title) || `${sanitizeRequiredText(sourceAsset?.title) || 'Study'} Quiz`;
    const requestText = normalizeStudySourceText(text);
    const assetText =
        normalizeStudySourceText(sourceAsset?.processed_text) ||
        normalizeStudySourceText(sourceAsset?.original_text);
    const normalizedText =
        hasUsableStudySourceText(requestText)
            ? requestText
            : assetText || requestText;
    const preparedSource = prepareStudySourceText(normalizedText);
    const normalizedQuestionCount = clampQuestionCount(questionCount);

    if (!normalizedTitle) {
        return res.status(400).json({
            error: 'bad_request',
            message: 'A title is required before a quiz can be generated.',
        });
    }

    if (!hasUsableStudySourceText(normalizedText)) {
        return res.status(400).json({
            error: 'insufficient_source_text',
            message: 'Add more note text before generating a quiz. StudyClaw needs a little more source material to work from.',
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

    const context = await buildStudyContext(req.user!.id, { query: `${normalizedTitle}\n\n${preparedSource.text.slice(0, 600)}` });
    const learnerLevel = audienceLevel || context.profile?.grade_year || context.profile?.school_level || 'current student level';
    const instructions = buildStudyInstructions(agent.system_prompt, context);
    const usageReservation = await reserveManagedUsageEvent({
        userId: req.user!.id,
        feature: 'quiz',
        modelKey: agent.model_key,
        eventKey: `quiz:${sourceAssetId ?? 'ad-hoc'}:${randomUUID()}`,
        metadata: {
            title: normalizedTitle,
            sourceAssetId: sourceAssetId ?? null,
            subjectId: subjectId ?? null,
            questionCount: normalizedQuestionCount,
        },
    });
    const usageEventId = usageReservation.eventId;

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
${preparedSource.text}
`;
    let reply;
    let usedLocalFallback = false;
    try {
        reply = await requestOpenClawGeneration({
            userId: req.user!.id,
            agentId: agent.openclaw_agent_id,
            modelKey: agent.model_key,
            instructions,
            prompt,
            metadata: {
                feature: 'quiz',
                sourceAssetId,
                subjectId,
                questionCount: normalizedQuestionCount,
                mode,
                sourceLength: preparedSource.originalLength,
                sourceTruncated: preparedSource.wasTruncated,
            },
            kind: 'quiz',
        });
    } catch (error) {
        const message = normalizeGenerationErrorMessage({
            error,
            kind: 'quiz',
        });
        if (error instanceof ManagedUsageLimitError) {
            await finalizeManagedUsageEvent({
                eventId: usageEventId,
                success: false,
                metadata: {
                    error: error.message,
                    normalizedMessage: message,
                },
            });
            return res.status(error.statusCode).json({
                error: error.code,
                message: error.message,
                detail: error.detail,
            });
        }
        console.warn('[study-tools] falling back to local quiz generation', {
            userId: req.user!.id,
            sourceAssetId: sourceAssetId ?? null,
            message: error instanceof Error ? error.message : String(error ?? 'Unknown quiz generation error'),
        });
        usedLocalFallback = true;
    }

    let questions: {
        question_text: string;
        question_type: string;
        choices: string[];
        answer: { correct: string };
        explanation: string;
    }[] = [];

    if (reply) {
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
                usedLocalFallback = true;
            }
        }
    }

    if (questions.length < MIN_QUIZ_QUESTIONS) {
        questions = buildFallbackQuiz({
            title: normalizedTitle,
            text: preparedSource.text,
            questionCount: normalizedQuestionCount,
        });
        usedLocalFallback = true;
    }

    if (questions.length < MIN_QUIZ_QUESTIONS) {
        await finalizeManagedUsageEvent({
            eventId: usageEventId,
            success: false,
            metadata: {
                outcome: 'validation_failed',
                validatedQuestions: questions.length,
            },
        });
        return res.status(422).json({
            error: 'generation_failed',
            message: `StudyClaw could only validate ${questions.length} quiz questions from that material. Try cleaner notes or add more source text.`,
        });
    }

    const client = await db.connect();
    let createdQuiz: any;

    try {
        await client.query('begin');
        const quiz = await client.query(
            `insert into quizzes (user_id, subject_id, source_asset_id, title, mode)
             values ($1, $2, $3, $4, $5)
             returning *`,
            [req.user!.id, subjectId ?? null, sourceAssetId ?? null, normalizedTitle, mode]
        );
        createdQuiz = quiz.rows[0];

        for (const q of questions) {
            await client.query(
                `insert into quiz_questions
                 (quiz_id, question_text, question_type, choices_json, answer_json, explanation)
                 values ($1, $2, $3, $4, $5, $6)`,
                [
                    createdQuiz.id,
                    q.question_text,
                    q.question_type ?? 'multiple_choice',
                    JSON.stringify(q.choices ?? []),
                    JSON.stringify(q.answer ?? {}),
                    q.explanation ?? '',
                ]
            );
        }
        await client.query('commit');
    } catch (error) {
        await client.query('rollback');
        console.error('[study-tools] failed to persist quiz', {
            userId: req.user!.id,
            sourceAssetId: sourceAssetId ?? null,
            message: error instanceof Error ? error.message : 'Unknown quiz persistence error',
        });
        return res.status(500).json({
            error: 'quiz_save_failed',
            message: 'The quiz was generated but could not be saved. Please try again.',
        });
    } finally {
        client.release();
    }

    await logAgentAction(studentAgent.id, 'quiz_generated', `Created ${questions.length} quiz questions for ${normalizedTitle}.`, {
        quizId: createdQuiz.id,
        sourceAssetId: sourceAssetId ?? null,
        subjectId: subjectId ?? null,
        mode,
    });
    const quizEvent = await recordStudyEvent({
        userId: req.user!.id,
        eventKey: `quiz:${createdQuiz.id}:generated`,
        eventType: 'quiz_generated',
        sourceType: 'quiz',
        sourceId: createdQuiz.id,
        courseId: subjectId ?? null,
        payload: {
            title: normalizedTitle,
            questionCount: questions.length,
            mode,
            sourceAssetId: sourceAssetId ?? null,
        },
    });
    await updateTopicMastery({
        userId: req.user!.id,
        topicName: normalizedTitle,
        courseId: subjectId ?? null,
        delta: 0.04,
        sourceEventId: quizEvent.id,
        notes: 'Generated quiz from study material',
    });
    await writeMemorySummary({
        userId: req.user!.id,
        summaryType: 'quiz_generated',
        summary: `Student generated ${questions.length} quiz questions for ${normalizedTitle}.`,
        courseId: subjectId ?? null,
        sourceEventId: quizEvent.id,
        summaryKey: `quiz:${createdQuiz.id}:generated`,
        importance: 3,
    });
    await finalizeManagedUsageEvent({
        eventId: usageEventId,
        success: true,
        metadata: {
            outcome: usedLocalFallback ? 'quiz_generated_fallback' : 'quiz_generated',
            quizId: createdQuiz.id,
            questionCount: questions.length,
            provider: usedLocalFallback ? 'local_fallback' : getProviderKeyFromModelKey(agent.model_key),
        },
    });

    res.json({
        quizId: createdQuiz.id,
        questions,
        generation: {
            kind: 'quiz',
            modelKey: usedLocalFallback ? 'local-study-fallback' : agent.model_key,
            providerKey: usedLocalFallback ? 'local_fallback' : getProviderKeyFromModelKey(agent.model_key),
            providerLabel: usedLocalFallback ? 'StudyClaw Fallback' : formatProviderLabel(getProviderKeyFromModelKey(agent.model_key)),
            itemCount: questions.length,
            createdAt: new Date().toISOString(),
            fallbackUsed: usedLocalFallback,
        },
    });
});

studyToolsRouter.post('/flashcards/:setId/review', async (req: AuthedRequest, res) => {
    await ensurePlatformSchema();
    const {
        topicName,
        reviewedCount,
        correctCount,
        score,
    } = req.body as {
        topicName?: string;
        reviewedCount?: number;
        correctCount?: number;
        score?: number;
    };

    const setResult = await db.query(
        `select id, title, subject_id
         from flashcard_sets
         where id = $1
           and user_id = $2
         limit 1`,
        [req.params.setId, req.user!.id]
    );

    const set = setResult.rows[0];
    if (!set) {
        return res.status(404).json({ error: 'not_found', message: 'Flashcard set not found' });
    }

    const reviewed = Math.max(Number(reviewedCount ?? 0), 0);
    const correct = Math.max(Number(correctCount ?? 0), 0);
    const derivedScore =
        typeof score === 'number' && Number.isFinite(score)
            ? Math.min(Math.max(score, 0), 1)
            : reviewed > 0
              ? Math.min(Math.max(correct / reviewed, 0), 1)
              : 0.7;

    const event = await recordStudyEvent({
        userId: req.user!.id,
        eventKey: `flashcards:${set.id}:review:${reviewed}:${correct}:${Number(derivedScore).toFixed(3)}`,
        eventType: 'flashcard_review_completed',
        sourceType: 'flashcard_set',
        sourceId: set.id,
        courseId: set.subject_id ?? null,
        score: derivedScore,
        payload: {
            reviewedCount: reviewed,
            correctCount: correct,
        },
    });
    const previousTopic = await db.query(
        `select mastery_score
         from topics
         where user_id = $1
           and coalesce(course_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce($2, '00000000-0000-0000-0000-000000000000'::uuid)
           and lower(name) = lower($3)
         limit 1`,
        [req.user!.id, set.subject_id ?? null, (topicName?.trim() || set.title)]
    );
    const previousScore = Number(previousTopic.rows[0]?.mastery_score ?? 0.5);
    const nextTopic = await updateTopicMastery({
        userId: req.user!.id,
        topicName: topicName?.trim() || set.title,
        courseId: set.subject_id ?? null,
        masteryScore: clamp(previousScore * 0.55 + derivedScore * 0.45),
        sourceEventId: event.id,
        notes: 'Recorded flashcard review outcome',
    });
    await writeMemorySummary({
        userId: req.user!.id,
        summaryType: 'flashcard_review',
        summary: buildImprovementSummary({
            topicName: nextTopic?.name ?? (topicName?.trim() || set.title),
            previousScore,
            nextScore: Number(nextTopic?.mastery_score ?? derivedScore),
        }),
        courseId: set.subject_id ?? null,
        topicId: nextTopic?.id ?? null,
        sourceEventId: event.id,
        summaryKey: `flashcards:${set.id}:review`,
        importance: 4,
    });
    if (derivedScore <= 0.45 || derivedScore >= 0.85) {
        await writeMemorySummary({
            userId: req.user!.id,
            summaryType: derivedScore <= 0.45 ? 'weak_area' : 'strong_area',
            summary:
                derivedScore <= 0.45
                    ? `Student is still struggling with ${nextTopic?.name ?? (topicName?.trim() || set.title)} during flashcard review.`
                    : `Student is showing strong recall in ${nextTopic?.name ?? (topicName?.trim() || set.title)} during flashcard review.`,
            courseId: set.subject_id ?? null,
            topicId: nextTopic?.id ?? null,
            sourceEventId: event.id,
            summaryKey: `flashcards:${set.id}:${derivedScore <= 0.45 ? 'weak' : 'strong'}`,
            importance: 4,
        });
    }

    res.json({
        ok: true,
        review: {
            flashcardSetId: set.id,
            score: derivedScore,
            reviewedCount: reviewed,
            correctCount: correct,
            topicId: nextTopic?.id ?? null,
            topicName: nextTopic?.name ?? (topicName?.trim() || set.title),
            masteryScore: Number(nextTopic?.mastery_score ?? derivedScore),
        },
    });
});

studyToolsRouter.post('/quizzes/:quizId/complete', async (req: AuthedRequest, res) => {
    await ensurePlatformSchema();
    const {
        topicName,
        score,
        correctCount,
        totalQuestions,
    } = req.body as {
        topicName?: string;
        score?: number;
        correctCount?: number;
        totalQuestions?: number;
    };

    const quizResult = await db.query(
        `select id, title, subject_id
         from quizzes
         where id = $1
           and user_id = $2
         limit 1`,
        [req.params.quizId, req.user!.id]
    );
    const quiz = quizResult.rows[0];
    if (!quiz) {
        return res.status(404).json({ error: 'not_found', message: 'Quiz not found' });
    }

    const correct = Math.max(Number(correctCount ?? 0), 0);
    const total = Math.max(Number(totalQuestions ?? 0), 0);
    const derivedScore =
        typeof score === 'number' && Number.isFinite(score)
            ? Math.min(Math.max(score, 0), 1)
            : total > 0
              ? Math.min(Math.max(correct / total, 0), 1)
              : 0.7;

    const event = await recordStudyEvent({
        userId: req.user!.id,
        eventKey: `quiz:${quiz.id}:complete:${correct}:${total}:${Number(derivedScore).toFixed(3)}`,
        eventType: 'quiz_completed',
        sourceType: 'quiz',
        sourceId: quiz.id,
        courseId: quiz.subject_id ?? null,
        score: derivedScore,
        payload: {
            correctCount: correct,
            totalQuestions: total,
        },
    });
    const previousTopic = await db.query(
        `select mastery_score
         from topics
         where user_id = $1
           and coalesce(course_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce($2, '00000000-0000-0000-0000-000000000000'::uuid)
           and lower(name) = lower($3)
         limit 1`,
        [req.user!.id, quiz.subject_id ?? null, (topicName?.trim() || quiz.title)]
    );
    const previousScore = Number(previousTopic.rows[0]?.mastery_score ?? 0.5);
    const nextTopic = await updateTopicMastery({
        userId: req.user!.id,
        topicName: topicName?.trim() || quiz.title,
        courseId: quiz.subject_id ?? null,
        masteryScore: clamp(previousScore * 0.4 + derivedScore * 0.6),
        sourceEventId: event.id,
        notes: 'Recorded quiz completion outcome',
    });
    await writeMemorySummary({
        userId: req.user!.id,
        summaryType: 'quiz_completion',
        summary: buildImprovementSummary({
            topicName: nextTopic?.name ?? (topicName?.trim() || quiz.title),
            previousScore,
            nextScore: Number(nextTopic?.mastery_score ?? derivedScore),
        }),
        courseId: quiz.subject_id ?? null,
        topicId: nextTopic?.id ?? null,
        sourceEventId: event.id,
        summaryKey: `quiz:${quiz.id}:complete`,
        importance: 5,
    });
    if (derivedScore <= 0.45 || derivedScore >= 0.85) {
        await writeMemorySummary({
            userId: req.user!.id,
            summaryType: derivedScore <= 0.45 ? 'weak_area' : 'strong_area',
            summary:
                derivedScore <= 0.45
                    ? `Student is still struggling with ${nextTopic?.name ?? (topicName?.trim() || quiz.title)} after the latest quiz.`
                    : `Student is consistently strong in ${nextTopic?.name ?? (topicName?.trim() || quiz.title)} after the latest quiz.`,
            courseId: quiz.subject_id ?? null,
            topicId: nextTopic?.id ?? null,
            sourceEventId: event.id,
            summaryKey: `quiz:${quiz.id}:${derivedScore <= 0.45 ? 'weak' : 'strong'}`,
            importance: 5,
        });
    }

    res.json({
        ok: true,
        result: {
            quizId: quiz.id,
            score: derivedScore,
            correctCount: correct,
            totalQuestions: total,
            topicId: nextTopic?.id ?? null,
            topicName: nextTopic?.name ?? (topicName?.trim() || quiz.title),
            masteryScore: Number(nextTopic?.mastery_score ?? derivedScore),
        },
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
