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

type NativeStudyFileRow = {
    id: string;
    name: string;
    file_type: 'doc' | 'spreadsheet' | 'note';
    content: string;
    metadata_json?: Record<string, unknown> | null;
};

function normalizeLine(value: unknown) {
    return String(value ?? '').trim();
}

function buildTextFromDocumentBlocks(metadata: Record<string, unknown>) {
    const blocks = Array.isArray(metadata.documentBlocks) ? metadata.documentBlocks : [];
    if (!blocks.length) {
        return '';
    }

    return blocks
        .map((block) => {
            if (!block || typeof block !== 'object') {
                return '';
            }

            const entry = block as Record<string, unknown>;
            const type = String(entry.type ?? 'paragraph');
            const text = normalizeLine(entry.text);
            if (!text) {
                return '';
            }

            if (type === 'heading') return `# ${text}`;
            if (type === 'subheading') return `## ${text}`;
            if (type === 'checklist') return `- [${entry.checked ? 'x' : ' '}] ${text}`;
            if (type === 'bullet') return `- ${text}`;
            if (type === 'quote') return `> ${text}`;
            return text;
        })
        .filter(Boolean)
        .join('\n');
}

function buildTextFromSpreadsheet(file: NativeStudyFileRow) {
    const metadata = (file.metadata_json && typeof file.metadata_json === 'object' && !Array.isArray(file.metadata_json))
        ? file.metadata_json
        : {};
    const headers = Array.isArray((metadata as any).sheetColumns)
        ? (metadata as any).sheetColumns.map((value: unknown, index: number) => normalizeLine(value) || `Column ${index + 1}`)
        : [];

    try {
        const parsed = JSON.parse(file.content || '[]');
        if (!Array.isArray(parsed)) {
            return file.content || '';
        }

        const rows = parsed
            .filter((row) => Array.isArray(row))
            .map((row) => (row as unknown[]).map((cell) => String(cell ?? '').trim()));

        const lines: string[] = [];
        if (headers.length) {
            lines.push(headers.join('\t'));
        }
        for (const row of rows) {
            if (row.some(Boolean)) {
                lines.push(row.join('\t'));
            }
        }
        return lines.join('\n');
    } catch {
        return file.content || '';
    }
}

function buildStudyTextFromNativeFile(file: NativeStudyFileRow) {
    const metadata = (file.metadata_json && typeof file.metadata_json === 'object' && !Array.isArray(file.metadata_json))
        ? file.metadata_json
        : {};

    if (file.file_type === 'spreadsheet') {
        return buildTextFromSpreadsheet(file);
    }

    const structured = buildTextFromDocumentBlocks(metadata);
    return structured || file.content || '';
}

async function resolveNativeStudySource(userId: string, sourceFileId: unknown) {
    if (typeof sourceFileId !== 'string' || !sourceFileId.trim()) {
        return null;
    }

    const result = await db.query(
        `select id, name, file_type, content, metadata_json
         from studyclaw_files
         where id = $1 and user_id = $2
         limit 1`,
        [sourceFileId.trim(), userId]
    );

    return (result.rows[0] as NativeStudyFileRow | undefined) ?? null;
}

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

async function listFlashcardSets(userId: string) {
    const result = await db.query(
        `select
            fs.id,
            fs.title,
            fs.metadata_json,
            fs.created_at,
            count(f.id)::int as card_count
         from flashcard_sets fs
         left join flashcards f on f.set_id = fs.id
         where fs.user_id = $1
         group by fs.id
         order by fs.created_at desc`,
        [userId]
    );

    return result.rows;
}

async function listQuizzes(userId: string) {
    const result = await db.query(
        `select
            q.id,
            q.title,
            q.created_at,
            q.metadata_json,
            count(qq.id)::int as question_count
         from quizzes q
         left join quiz_questions qq on qq.quiz_id = q.id
         where q.user_id = $1
         group by q.id
         order by q.created_at desc`,
        [userId]
    );

    return result.rows;
}

studyToolsRouter.get('/flashcard-sets', async (req: AuthedRequest, res) => {
    const sets = await listFlashcardSets(req.user!.id);
    res.json({ sets });
});

studyToolsRouter.get('/quizzes', async (req: AuthedRequest, res) => {
    const quizzes = await listQuizzes(req.user!.id);
    res.json({ quizzes });
});

studyToolsRouter.get('/library', async (req: AuthedRequest, res) => {
    const [setsResult, cardsResult, quizzesResult, questionsResult] = await Promise.all([
        db.query(
            `select id, title, subject_id, source_asset_id, metadata_json, created_at
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
            `select id, title, mode, subject_id, source_asset_id, metadata_json, created_at
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
            metadata: set.metadata_json ?? {},
            cards: cardsBySet.get(set.id) ?? [],
        })),
        quizzes: quizzesResult.rows.map((quiz) => ({
            ...quiz,
            metadata: quiz.metadata_json ?? {},
            questions: questionsByQuiz.get(quiz.id) ?? [],
        })),
    });
});

studyToolsRouter.post('/flashcards', async (req: AuthedRequest, res) => {
    await ensurePlatformSchema();
    const { sourceAssetId, subjectId, audienceLevel, sourceFileId, sourceKind } = req.body as any;
    const nativeSource = await resolveNativeStudySource(req.user!.id, sourceFileId);
    const title = String(req.body?.title ?? nativeSource?.name ?? '').trim();
    const text = String(req.body?.text ?? '').trim() || (nativeSource ? buildStudyTextFromNativeFile(nativeSource) : '');

    if (!title || !text) {
        return res.status(400).json({
            error: 'bad_request',
            message: 'title and text are required, or provide a valid sourceFileId',
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
    const generationMetadata = {
        feature: 'flashcards',
        ...(sourceAssetId ? { sourceAssetId } : {}),
        ...(nativeSource?.id ? { sourceFileId: nativeSource.id } : {}),
        ...(nativeSource?.file_type ? { sourceFileType: nativeSource.file_type } : {}),
        ...(sourceKind ?? (nativeSource ? 'native-file' : null) ? { sourceKind: sourceKind ?? 'native-file' } : {}),
        ...(subjectId ? { subjectId } : {}),
        googleConnected: context.workspace.googleConnected,
        workspaceCalendarBackend: context.workspace.calendarBackend,
        workspaceDocumentBackend: context.workspace.documentBackend,
        nativeCalendarEvents: context.workspace.nativeCalendarEvents,
        nativeFiles: context.workspace.nativeFiles,
    };

    const reply = await openclaw.sendMessage({
        agentId: agent.openclaw_agent_id,
        instructions: buildStudyInstructions(agent.system_prompt, context),
        message: prompt,
        model: agent.model_key,
        metadata: generationMetadata,
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
        `insert into flashcard_sets (user_id, subject_id, source_asset_id, title, metadata_json)
     values ($1, $2, $3, $4, $5)
     returning *`,
        [req.user!.id, subjectId ?? null, sourceAssetId ?? null, title, JSON.stringify({
            sourceKind: sourceKind ?? (nativeSource ? 'native-file' : sourceAssetId ? 'asset' : 'manual'),
            sourceFileId: nativeSource?.id ?? null,
            sourceFileType: nativeSource?.file_type ?? null,
            sourceAssetId: sourceAssetId ?? null,
            sourceTitle: nativeSource?.name ?? title,
        })]
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
        sourceFileId: nativeSource?.id ?? null,
        source: set.rows[0].metadata_json ?? {},
        cards,
    });
});

studyToolsRouter.post('/quiz', async (req: AuthedRequest, res) => {
    await ensurePlatformSchema();
    const { sourceAssetId, subjectId, questionCount = 10, mode = 'practice', audienceLevel, sourceFileId, sourceKind } = req.body as any;
    const nativeSource = await resolveNativeStudySource(req.user!.id, sourceFileId);
    const title = String(req.body?.title ?? nativeSource?.name ?? '').trim();
    const text = String(req.body?.text ?? '').trim() || (nativeSource ? buildStudyTextFromNativeFile(nativeSource) : '');

    if (!title || !text) {
        return res.status(400).json({
            error: 'bad_request',
            message: 'title and text are required, or provide a valid sourceFileId',
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
    const generationMetadata = {
        feature: 'quiz',
        ...(sourceAssetId ? { sourceAssetId } : {}),
        ...(nativeSource?.id ? { sourceFileId: nativeSource.id } : {}),
        ...(nativeSource?.file_type ? { sourceFileType: nativeSource.file_type } : {}),
        ...(sourceKind ?? (nativeSource ? 'native-file' : null) ? { sourceKind: sourceKind ?? 'native-file' } : {}),
        ...(subjectId ? { subjectId } : {}),
        questionCount,
        mode,
        googleConnected: context.workspace.googleConnected,
        workspaceCalendarBackend: context.workspace.calendarBackend,
        workspaceDocumentBackend: context.workspace.documentBackend,
        nativeCalendarEvents: context.workspace.nativeCalendarEvents,
        nativeFiles: context.workspace.nativeFiles,
    };

    const reply = await openclaw.sendMessage({
        agentId: agent.openclaw_agent_id,
        instructions: buildStudyInstructions(agent.system_prompt, context),
        message: prompt,
        model: agent.model_key,
        metadata: generationMetadata,
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
        `insert into quizzes (user_id, subject_id, source_asset_id, title, mode, metadata_json)
         values ($1, $2, $3, $4, $5, $6)
         returning *`,
        [req.user!.id, subjectId ?? null, sourceAssetId ?? null, title, mode, JSON.stringify({
            sourceKind: sourceKind ?? (nativeSource ? 'native-file' : sourceAssetId ? 'asset' : 'manual'),
            sourceFileId: nativeSource?.id ?? null,
            sourceFileType: nativeSource?.file_type ?? null,
            sourceAssetId: sourceAssetId ?? null,
            sourceTitle: nativeSource?.name ?? title,
        })]
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
        sourceFileId: nativeSource?.id ?? null,
        source: quiz.rows[0].metadata_json ?? {},
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
