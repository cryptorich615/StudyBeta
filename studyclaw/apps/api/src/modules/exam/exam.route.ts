import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../../lib/auth';
import { OpenClawClient } from '../../integrations/openclaw/openclaw.client';
import { db } from '../../lib/db';
import {
    buildStudyContext,
    buildStudyInstructions,
    loadAgentProfile,
} from '../../lib/study-context';

export const examRouter = Router();
examRouter.use(requireAuth);

const openclaw = new OpenClawClient();

function daysUntil(date: string | Date): number {
    const diff = new Date(date).getTime() - Date.now();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function generateSchedule(examDate: string, topics: string[], priorityTags: string[]) {
    const days = daysUntil(examDate);
    if (days <= 0) return [];

    const schedule = [];
    const topicsPerDay = Math.ceil(topics.length / days);

    for (let i = 0; i < days; i++) {
        const studyDate = new Date(Date.now() + i * 24 * 60 * 60 * 1000);
        const dayIndex = i;
        const isLast3Days = days - i <= 3;
        const isFirstHalf = i < days / 2;

        // Distribute topics across days
        const start = i * topicsPerDay;
        const end = Math.min(start + topicsPerDay, topics.length);
        const dayTopics = topics.slice(start, end);

        // More intensive studying as exam approaches
        const intensity = isLast3Days ? 'cram' : isFirstHalf ? 'review' : 'practice';

        schedule.push({
            day: i + 1,
            date: studyDate.toISOString().split('T')[0],
            topics: dayTopics,
            focus: intensity,
            description: isLast3Days
                ? `Cram day — review all topics, practice questions`
                : isFirstHalf
                ? `Deep review — focus on understanding concepts`
                : `Practice — apply what you've learned`,
        });
    }

    return schedule;
}

// POST /api/exam/plans — Create an exam prep plan
examRouter.post('/plans', async (req: AuthedRequest, res) => {
    const { examDate, subject, title, topics, daysOfReview } = req.body as {
        examDate?: string;
        subject?: string;
        title?: string;
        topics?: string[];
        daysOfReview?: number;
    };

    if (!examDate || !title) {
        return res.status(400).json({ error: 'examDate and title are required' });
    }

    const days = daysUntil(examDate);
    if (days <= 0) {
        return res.status(400).json({ error: 'Exam date must be in the future' });
    }

    // Get weak concept tags from wrong answers to prioritize
    const weakResult = await db.query(
        `SELECT unnest(concept_tags) as tag, count(*)::int as count
         FROM wrong_answer_reviews
         WHERE user_id = $1 AND created_at > NOW() - INTERVAL '90 days'
         GROUP BY tag
         ORDER BY count DESC
         LIMIT 10`,
        [req.user!.id]
    );

    const priorityTags = weakResult.rows.map((r) => r.tag as string);

    // Generate study schedule
    const schedule = generateSchedule(examDate, topics ?? [], priorityTags);

    const result = await db.query(
        `INSERT INTO exam_plans (user_id, exam_date, subject, title, topics, schedule_json, priority_tags)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
            req.user!.id,
            examDate,
            subject ?? null,
            title,
            topics ?? [],
            JSON.stringify(schedule),
            priorityTags,
        ]
    );

    const plan = result.rows[0];

    res.json({
        planId: plan.id,
        title: plan.title,
        examDate: plan.exam_date,
        daysRemaining: days,
        schedule,
        priorityTags,
        message: days <= 7
            ? `${days} days left — this is a cram situation. Focus on weakest areas first.`
            : `${days} days to prepare. Review phase first, then practice.`,
    });
});

// GET /api/exam/plans — List all exam plans
examRouter.get('/plans', async (req: AuthedRequest, res) => {
    const result = await db.query(
        `SELECT * FROM exam_plans WHERE user_id = $1 ORDER BY exam_date ASC`,
        [req.user!.id]
    );

    const plans = result.rows.map((p) => ({
        id: p.id,
        title: p.title,
        subject: p.subject,
        examDate: p.exam_date,
        daysRemaining: daysUntil(p.exam_date),
        topicCount: p.topics?.length ?? 0,
        status: p.status,
    }));

    res.json({ plans });
});

// GET /api/exam/plans/:id — Get exam plan details
examRouter.get('/plans/:id', async (req: AuthedRequest, res) => {
    const { id } = req.params;

    const result = await db.query(
        `SELECT * FROM exam_plans WHERE id = $1 AND user_id = $2`,
        [id, req.user!.id]
    );

    if (!result.rows[0]) {
        return res.status(404).json({ error: 'Exam plan not found' });
    }

    const plan = result.rows[0];
    const days = daysUntil(plan.exam_date);

    // Today's study block
    const todayBlock = (plan.schedule_json as any[]).find(
        (b) => b.date === new Date().toISOString().split('T')[0]
    );

    res.json({
        id: plan.id,
        title: plan.title,
        subject: plan.subject,
        examDate: plan.exam_date,
        daysRemaining: days,
        topics: plan.topics,
        schedule: plan.schedule_json,
        priorityTags: plan.priority_tags,
        todayBlock,
        status: plan.status,
    });
});

// GET /api/exam/plans/:id/today — Get today's study task
examRouter.get('/plans/:id/today', async (req: AuthedRequest, res) => {
    const { id } = req.params;

    const result = await db.query(
        `SELECT * FROM exam_plans WHERE id = $1 AND user_id = $2`,
        [id, req.user!.id]
    );

    if (!result.rows[0]) {
        return res.status(404).json({ error: 'Exam plan not found' });
    }

    const plan = result.rows[0];
    const days = daysUntil(plan.exam_date);
    const todayBlock = (plan.schedule_json as any[]).find(
        (b) => b.date === new Date().toISOString().split('T')[0]
    );

    if (!todayBlock) {
        return res.json({
            message: days <= 0
                ? 'Exam day! Good luck!'
                : 'No more scheduled study blocks for this plan.',
            daysRemaining: days,
        });
    }

    // Find weak areas in today's topics from wrong answers
    const topicWrongAnswers = await db.query(
        `SELECT * FROM wrong_answer_reviews
         WHERE user_id = $1
           AND created_at > NOW() - INTERVAL '90 days'
           AND ($2::text[] && concept_tags)
         ORDER BY created_at DESC
         LIMIT 10`,
        [req.user!.id, todayBlock.topics]
    );

    res.json({
        day: todayBlock.day,
        date: todayBlock.date,
        focus: todayBlock.focus,
        description: todayBlock.description,
        topics: todayBlock.topics,
        weakAreas: topicWrongAnswers.rows.map((wa) => ({
            question: wa.question_text,
            correctAnswer: wa.correct_answer,
            tags: wa.concept_tags,
        })),
        daysRemaining: days,
        priorityTags: plan.priority_tags,
    });
});

// POST /api/exam/plans/:id/generate-reminders — Create study reminders from plan
examRouter.post('/plans/:id/generate-reminders', async (req: AuthedRequest, res) => {
    const { id } = req.params;

    const result = await db.query(
        `SELECT * FROM exam_plans WHERE id = $1 AND user_id = $2`,
        [id, req.user!.id]
    );

    if (!result.rows[0]) {
        return res.status(404).json({ error: 'Exam plan not found' });
    }

    const plan = result.rows[0];
    const schedule = plan.schedule_json as any[];

    const created: string[] = [];
    for (const block of schedule) {
        // Create a reminder for each study day at 9am
        const reminderTime = new Date(block.date + 'T09:00:00Z');
        if (reminderTime <= new Date()) continue;

        await db.query(
            `INSERT INTO reminders (user_id, type, title, reminder_at, metadata_json)
             VALUES ($1, 'study', $2, $3, $4)`,
            [
                req.user!.id,
                `📚 ${plan.title} — Day ${block.day}: ${block.focus}`,
                reminderTime.toISOString(),
                JSON.stringify({
                    examPlanId: plan.id,
                    topics: block.topics,
                    focus: block.focus,
                }),
            ]
        );
        created.push(block.date);
    }

    res.json({ ok: true, createdReminders: created.length, dates: created });
});

// PATCH /api/exam/plans/:id — Update exam plan status
examRouter.patch('/plans/:id', async (req: AuthedRequest, res) => {
    const { id } = req.params;
    const { status } = req.body as { status?: string };

    const validStatuses = ['active', 'completed', 'cancelled'];
    if (status && !validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    const result = await db.query(
        `UPDATE exam_plans SET status = COALESCE($3, status), updated_at = now()
         WHERE id = $1 AND user_id = $2
         RETURNING *`,
        [id, req.user!.id, status]
    );

    if (!result.rows[0]) {
        return res.status(404).json({ error: 'Exam plan not found' });
    }

    res.json({ ok: true });
});

// DELETE /api/exam/plans/:id — Delete exam plan
examRouter.delete('/plans/:id', async (req: AuthedRequest, res) => {
    const { id } = req.params;

    const result = await db.query(
        `DELETE FROM exam_plans WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, req.user!.id]
    );

    if (!result.rows[0]) {
        return res.status(404).json({ error: 'Exam plan not found' });
    }

    res.json({ ok: true });
});

// GET /api/exam/next — Get the nearest upcoming exam
examRouter.get('/next', async (req: AuthedRequest, res) => {
    const result = await db.query(
        `SELECT * FROM exam_plans
         WHERE user_id = $1 AND exam_date > NOW() AND status = 'active'
         ORDER BY exam_date ASC
         LIMIT 1`,
        [req.user!.id]
    );

    if (!result.rows[0]) {
        return res.json({ exam: null });
    }

    const plan = result.rows[0];
    res.json({
        exam: {
            id: plan.id,
            title: plan.title,
            subject: plan.subject,
            examDate: plan.exam_date,
            daysRemaining: daysUntil(plan.exam_date),
        },
    });
});