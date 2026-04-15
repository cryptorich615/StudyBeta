import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../../lib/auth';
import { ensurePlatformSchema } from '../../lib/platform-schema';
import {
  buildGradeTrackerContext,
  calculateRequiredFinalExamScore,
  createGradeItem,
  createWrongAnswerReview,
  deleteGradeItem,
  deleteWrongAnswerReview,
  getCourseGradeSummary,
  getWrongAnswerReview,
  listGradeDashboard,
  resolveCourseSummaryByName,
  storeWrongAnswerExplanation,
  updateGradeItem,
  updateWrongAnswerReview,
  upsertGradeCourseSettings,
} from '../../lib/grade-tracker';
import { buildStudyContext, buildStudyInstructions, loadAgentProfile } from '../../lib/study-context';
import { OpenClawClient } from '../../integrations/openclaw/openclaw.client';

export const gradesRouter = Router();
gradesRouter.use(requireAuth);

const openclaw = new OpenClawClient();

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function requireParam(value: string | string[] | undefined, name: string) {
  const resolved = getParam(value);
  if (!resolved) {
    throw new Error(`Missing route param: ${name}`);
  }
  return resolved;
}

gradesRouter.get('/', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  const snapshot = await listGradeDashboard(req.user!.id);
  res.json({
    ...snapshot,
    reviews: snapshot.wrongAnswers ?? [],
  });
});

gradesRouter.post('/courses', async (req: AuthedRequest, res) => {
  try {
    await ensurePlatformSchema();
    const {
      courseName,
      name,
      calculationMode,
      usesWeightedCategories,
      categoryWeights,
      finalExamWeight,
    } = req.body as any;
    const result = await upsertGradeCourseSettings({
      userId: req.user!.id,
      courseName: typeof courseName === 'string' && courseName.trim() ? courseName : name,
      calculationMode:
        calculationMode
        ?? (usesWeightedCategories ? 'weighted' : undefined),
      categoryWeights,
      finalExamWeight,
    });
    const summary = await getCourseGradeSummary(req.user!.id, result.course.id);
    res.status(201).json({ course: result.course, summary });
  } catch (error) {
    res.status(400).json({ error: 'course_settings_failed', message: error instanceof Error ? error.message : 'Failed to save course settings' });
  }
});

gradesRouter.post('/courses/:courseId/settings', async (req: AuthedRequest, res) => {
  try {
    await ensurePlatformSchema();
    const courseId = requireParam(req.params.courseId, 'courseId');
    await upsertGradeCourseSettings({
      userId: req.user!.id,
      courseId,
      calculationMode:
        req.body?.calculationMode
        ?? (req.body?.usesWeightedCategories ? 'weighted' : undefined),
      categoryWeights: req.body?.categoryWeights,
      finalExamWeight: req.body?.finalExamWeight,
    });
    const summary = await getCourseGradeSummary(req.user!.id, courseId);
    res.json({ summary });
  } catch (error) {
    res.status(400).json({ error: 'course_settings_failed', message: error instanceof Error ? error.message : 'Failed to save course settings' });
  }
});

gradesRouter.post('/items', async (req: AuthedRequest, res) => {
  try {
    const result = await createGradeItem(req.user!.id, req.body);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: 'grade_item_failed', message: error instanceof Error ? error.message : 'Failed to save grade item' });
  }
});

gradesRouter.patch('/items/:itemId', async (req: AuthedRequest, res) => {
  try {
    const result = await updateGradeItem(req.user!.id, requireParam(req.params.itemId, 'itemId'), req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: 'grade_item_failed', message: error instanceof Error ? error.message : 'Failed to update grade item' });
  }
});

gradesRouter.delete('/items/:itemId', async (req: AuthedRequest, res) => {
  try {
    const summary = await deleteGradeItem(req.user!.id, requireParam(req.params.itemId, 'itemId'));
    res.json({ ok: true, summary });
  } catch (error) {
    res.status(404).json({ error: 'grade_item_failed', message: error instanceof Error ? error.message : 'Failed to delete grade item' });
  }
});

gradesRouter.post('/reviews', async (req: AuthedRequest, res) => {
  try {
    const review = await createWrongAnswerReview(req.user!.id, req.body);
    res.status(201).json({ review });
  } catch (error) {
    res.status(400).json({ error: 'wrong_answer_failed', message: error instanceof Error ? error.message : 'Failed to save wrong-answer review' });
  }
});

gradesRouter.patch('/reviews/:reviewId', async (req: AuthedRequest, res) => {
  try {
    const review = await updateWrongAnswerReview(req.user!.id, requireParam(req.params.reviewId, 'reviewId'), req.body);
    res.json({ review });
  } catch (error) {
    res.status(400).json({ error: 'wrong_answer_failed', message: error instanceof Error ? error.message : 'Failed to update wrong-answer review' });
  }
});

gradesRouter.delete('/reviews/:reviewId', async (req: AuthedRequest, res) => {
  try {
    await deleteWrongAnswerReview(req.user!.id, requireParam(req.params.reviewId, 'reviewId'));
    res.json({ ok: true });
  } catch (error) {
    res.status(404).json({ error: 'wrong_answer_failed', message: error instanceof Error ? error.message : 'Failed to delete wrong-answer review' });
  }
});

gradesRouter.post('/reviews/:reviewId/explain', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  const review = await getWrongAnswerReview(req.user!.id, requireParam(req.params.reviewId, 'reviewId'));
  if (!review) {
    return res.status(404).json({ error: 'not_found', message: 'Wrong-answer review not found' });
  }

  const agent = await loadAgentProfile(req.user!.id);
  if (!agent) {
    return res.status(400).json({ error: 'missing_agent', message: 'Complete onboarding first' });
  }

  const context = await buildStudyContext(req.user!.id, { query: `${review.source_title} ${review.question_text}` });
  const gradeContext = await buildGradeTrackerContext(req.user!.id, review.course_name ?? review.source_title);

  const prompt = [
    'Explain this missed question for the student.',
    '',
    `Course: ${review.course_name ?? 'Unsorted'}`,
    `Source: ${review.source_type} - ${review.source_title}`,
    `Question: ${review.question_text}`,
    `Student answer: ${review.student_answer ?? 'Not provided'}`,
    `Correct answer: ${review.correct_answer}`,
    `Teacher notes: ${review.teacher_notes ?? 'None'}`,
    `Concept tags: ${(review.concept_tags ?? []).join(', ') || 'None'}`,
    '',
    'Return plain JSON with keys:',
    '{"correctAnswer":"...","whyWrong":"...","howToSolve":"...","reviewConcept":"...","beginnerExplanation":"...","practiceQuestions":["..."]}',
  ].join('\n');

  try {
    const reply = await openclaw.sendMessage({
      agentId: agent.openclaw_agent_id,
      instructions: `${buildStudyInstructions(agent.system_prompt, context)}\n${gradeContext.line}\n${gradeContext.conceptLine}`,
      message: prompt,
      model: agent.model_key,
      metadata: {
        feature: 'wrong-answer-explain',
        reviewId: review.id,
      },
      userId: req.user!.id,
      timeoutMs: 30_000,
    });

    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(reply.text);
    } catch {
      parsed = {
        correctAnswer: review.correct_answer,
        whyWrong: reply.text,
        howToSolve: '',
        reviewConcept: (review.concept_tags ?? [])[0] ?? review.source_title,
        beginnerExplanation: '',
        practiceQuestions: [],
      };
    }

    await storeWrongAnswerExplanation(req.user!.id, review.id, parsed ?? {});
    res.json({ explanation: parsed });
  } catch (error) {
    const fallback = {
      correctAnswer: review.correct_answer,
      whyWrong:
        review.student_answer
          ? `Your answer focused on ${review.student_answer}, but the key idea was ${review.correct_answer}.`
          : `The missed idea was ${review.correct_answer}.`,
      howToSolve:
        review.explanation
        || `Start by identifying what the question is really asking, then connect it to ${review.correct_answer}.`,
      reviewConcept: (review.concept_tags ?? [])[0] ?? review.source_title,
      beginnerExplanation:
        review.explanation
        || `In simple terms, ${review.correct_answer}.`,
      practiceQuestions: [
        `Explain ${((review.concept_tags ?? [])[0] ?? 'the main concept')} in one sentence.`,
        `How would you spot a similar question next time?`,
      ],
      fallback: true,
    };

    await storeWrongAnswerExplanation(req.user!.id, review.id, fallback);
    res.json({
      explanation: fallback,
      warning: error instanceof Error ? error.message : 'Fell back to stored explanation.',
    });
  }
});

gradesRouter.post('/final-target', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  const courseName = typeof req.body?.courseName === 'string' ? req.body.courseName.trim() : '';
  const courseId = typeof req.body?.courseId === 'string' ? req.body.courseId.trim() : '';
  const targetPercentInput = Number(req.body?.targetPercent);
  const targetLetterInput = typeof req.body?.targetLetter === 'string' ? req.body.targetLetter.trim().toUpperCase() : '';
  if ((!courseName && !courseId) || (!Number.isFinite(targetPercentInput) && !targetLetterInput)) {
    return res.status(400).json({ error: 'bad_request', message: 'courseName or courseId and targetPercent or targetLetter are required' });
  }

  const summary = courseId
    ? await getCourseGradeSummary(req.user!.id, courseId).catch(() => null)
    : await resolveCourseSummaryByName(req.user!.id, courseName);
  if (!summary) {
    return res.status(404).json({ error: 'not_found', message: 'Course not found' });
  }

  const targetPercent = Number.isFinite(targetPercentInput)
    ? targetPercentInput
    : ({
        A: 90,
        B: 80,
        C: 70,
        D: 60,
        F: 0,
      } as Record<string, number>)[targetLetterInput];
  if (!Number.isFinite(targetPercent)) {
    return res.status(400).json({ error: 'bad_request', message: 'Unsupported target letter grade.' });
  }

  const usedCategoryWeight = summary.categoryBreakdown.reduce((sum, item) => sum + (item.weight ?? 0), 0);
  const result = calculateRequiredFinalExamScore({
    currentPercent: summary.estimatedPercent,
    targetPercent,
    finalWeightPercent: summary.finalExamWeight,
    remainingWeightPercent: summary.finalExamWeight === null && summary.weighted ? Math.max(0, 100 - usedCategoryWeight) : null,
  });

  res.json({
    course: summary.courseName,
    currentLetter: summary.letterGrade,
    ...result,
  });
});
