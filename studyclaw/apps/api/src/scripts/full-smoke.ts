import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/db';
import { ensureAdminAgent } from '../lib/user-agent';

const apiBase = process.env.STUDYCLAW_SMOKE_API_BASE ?? 'http://127.0.0.1:4000';

type Session = {
  accessToken: string;
  user: {
    id: string;
    email: string;
    role: string;
  };
};

type JsonRecord = Record<string, any>;

async function callApi(path: string, options: RequestInit = {}, expectedStatus?: number) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (typeof expectedStatus === 'number') {
    assert.equal(
      response.status,
      expectedStatus,
      `Expected ${path} to return ${expectedStatus}, got ${response.status}: ${text}`
    );
  } else {
    assert.ok(response.ok, `${path} failed with ${response.status}: ${text}`);
  }

  return { response, payload };
}

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
  };
}

function logStep(label: string, detail?: string) {
  console.log(`\n[smoke] ${label}${detail ? `: ${detail}` : ''}`);
}

async function signup(email: string, password: string) {
  const { payload } = await callApi('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  assert.ok(payload?.accessToken, 'signup did not return accessToken');
  return payload as Session;
}

async function login(email: string, password: string) {
  const { payload } = await callApi('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  assert.ok(payload?.accessToken, 'login did not return accessToken');
  return payload as Session;
}

async function main() {
  const unique = Date.now();
  const studentEmail = `full.smoke.student.${unique}@example.com`;
  const adminEmail = `full.smoke.admin.${unique}@example.com`;
  const password = 'strongpass123';

  logStep('unauthenticated API protection');
  await callApi('/api/dashboard', {}, 401);

  logStep('signup student');
  const student = await signup(studentEmail, password);

  logStep('signup admin candidate');
  const adminCandidate = await signup(adminEmail, password);
  await db.query(`update users set role = 'admin' where id = $1`, [adminCandidate.user.id]);
  await ensureAdminAgent({ ownerUserId: adminCandidate.user.id, email: adminEmail });
  const admin = await login(adminEmail, password);

  logStep('auth me');
  const meStudent = await callApi('/api/auth/me', { headers: authHeaders(student.accessToken) });
  const meAdmin = await callApi('/api/auth/me', { headers: authHeaders(admin.accessToken) });
  assert.equal(meStudent.payload?.user?.email, studentEmail);
  assert.equal(meAdmin.payload?.user?.role, 'admin');

  logStep('profile get and save');
  await callApi('/api/user/profile', { headers: authHeaders(student.accessToken) });
  const savedProfile = await callApi('/api/user/profile', {
    method: 'POST',
    headers: authHeaders(student.accessToken),
    body: JSON.stringify({
      name: 'Full Smoke Student',
      school: 'StudyClaw High',
      graduationYear: 2027,
      major: 'STEM',
    }),
  });
  assert.equal(savedProfile.payload?.profile?.school, 'StudyClaw High');

  logStep('onboarding options, tier, model config');
  const options = await callApi('/api/onboarding/options', { headers: authHeaders(student.accessToken) });
  assert.ok(Array.isArray(options.payload?.models) && options.payload.models.length > 0, 'onboarding options missing models');
  const tierResponse = await callApi('/api/onboarding/testing-tier', {
    method: 'POST',
    headers: authHeaders(student.accessToken),
    body: JSON.stringify({ tier: 'tier_1' }),
  });
  assert.equal(tierResponse.payload?.usageProfile?.tier, 'tier_1');
  const launch = await callApi('/api/onboarding/model-config', {
    method: 'POST',
    headers: authHeaders(student.accessToken),
    body: JSON.stringify({
      modelKey: 'minimax/MiniMax-M2.7',
      agentPreset: 'quick_start_2',
      usageMode: 'managed',
    }),
  });
  assert.equal(launch.payload?.usageProfile?.billingMode, 'managed');
  const onboardingStatus = await callApi('/api/onboarding/status', { headers: authHeaders(student.accessToken) });
  assert.ok(onboardingStatus.payload?.agent, 'onboarding status missing agent profile');

  logStep('dashboard');
  const dashboard = await callApi('/api/dashboard', { headers: authHeaders(student.accessToken) });
  assert.ok(dashboard.payload?.counts, 'dashboard counts missing');
  assert.ok(Array.isArray(dashboard.payload?.quickActions), 'dashboard quick actions missing');

  logStep('google integration graceful fallback');
  const googleStatus = await callApi('/api/google', { headers: authHeaders(student.accessToken) });
  assert.ok(['connected', 'not_connected', 'reconnect_required'].includes(googleStatus.payload?.status));
  const googleCalendar = await callApi('/api/google/calendar?days=14', { headers: authHeaders(student.accessToken) }, 400);
  assert.ok(['not_connected', 'reconnect_required'].includes(googleCalendar.payload?.error));

  logStep('reminders CRUD');
  const reminderCreate = await callApi('/api/reminders', {
    method: 'POST',
    headers: authHeaders(student.accessToken),
    body: JSON.stringify({
      title: 'Study for algebra quiz',
      type: 'quiz',
      reminderAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      metadata: { source: 'full-smoke' },
    }),
  }, 201);
  const reminderId = reminderCreate.payload?.id as string;
  assert.ok(reminderId, 'reminder create missing id');
  const reminderList = await callApi('/api/reminders', { headers: authHeaders(student.accessToken) });
  assert.ok(Array.isArray(reminderList.payload) && reminderList.payload.some((row: JsonRecord) => row.id === reminderId));
  const reminderUpdate = await callApi(`/api/reminders/${reminderId}`, {
    method: 'PATCH',
    headers: authHeaders(student.accessToken),
    body: JSON.stringify({
      title: 'Study for algebra quiz hard',
      type: 'quiz',
      status: 'completed',
      reminderAt: new Date(Date.now() + 90 * 60 * 1000).toISOString(),
    }),
  });
  assert.equal(reminderUpdate.payload?.status, 'completed');

  logStep('schedule CRUD');
  const scheduleCreateOne = await callApi('/api/schedule/entries', {
    method: 'POST',
    headers: authHeaders(student.accessToken),
    body: JSON.stringify({
      className: 'Algebra',
      subject: 'Algebra',
      roomNumber: '101',
      teacherName: 'Ms. Carter',
      startTime: '09:00',
      endTime: '09:50',
      daysOfWeek: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      notes: 'Bring graph paper',
    }),
  }, 201);
  const scheduleCreateTwo = await callApi('/api/schedule/entries', {
    method: 'POST',
    headers: authHeaders(student.accessToken),
    body: JSON.stringify({
      className: 'Chemistry',
      subject: 'Chemistry',
      roomNumber: 'Lab 2',
      teacherName: 'Mr. Singh',
      startTime: '10:00',
      endTime: '10:50',
      period: '2',
      daysOfWeek: ['monday', 'wednesday', 'friday'],
      notes: 'Wear lab goggles',
    }),
  }, 201);
  const scheduleEntryId = scheduleCreateOne.payload?.entry?.id as string;
  assert.ok(scheduleEntryId, 'schedule create missing id');
  const schedulePatch = await callApi(`/api/schedule/entries/${scheduleEntryId}`, {
    method: 'PATCH',
    headers: authHeaders(student.accessToken),
    body: JSON.stringify({
      roomNumber: '102',
      notes: 'Bring graph paper and calculator',
    }),
  });
  assert.equal(schedulePatch.payload?.entry?.roomNumber ?? schedulePatch.payload?.entry?.room_number, '102');
  const scheduleSnapshot = await callApi('/api/schedule?query=What class do I have next%3F', {
    headers: authHeaders(student.accessToken),
  });
  assert.ok(Array.isArray(scheduleSnapshot.payload?.entries) && scheduleSnapshot.payload.entries.length >= 2);
  assert.ok(scheduleSnapshot.payload?.contextLines?.line);

  logStep('grades and wrong-answer review');
  const courseCreate = await callApi('/api/grades/courses', {
    method: 'POST',
    headers: authHeaders(student.accessToken),
    body: JSON.stringify({
      courseName: 'Biology',
      calculationMode: 'weighted',
      categoryWeights: { homework: 20, quiz: 20, test: 40, project: 20, participation: 0 },
      finalExamWeight: 20,
    }),
  }, 201);
  const courseId = courseCreate.payload?.course?.id as string;
  assert.ok(courseId, 'course create missing id');
  await callApi(`/api/grades/courses/${courseId}/settings`, {
    method: 'POST',
    headers: authHeaders(student.accessToken),
    body: JSON.stringify({
      calculationMode: 'weighted',
      finalExamWeight: 20,
      categoryWeights: { homework: 20, quiz: 20, test: 40, project: 20, participation: 0 },
    }),
  });
  const gradeCreate = await callApi('/api/grades/items', {
    method: 'POST',
    headers: authHeaders(student.accessToken),
    body: JSON.stringify({
      courseId,
      title: 'Cell structure quiz',
      category: 'quiz',
      pointsEarned: 18,
      pointsPossible: 25,
      date: '2026-03-30',
      notes: 'Need to review mitochondria',
    }),
  }, 201);
  const gradeItemId = gradeCreate.payload?.item?.id as string;
  assert.ok(gradeItemId, 'grade create missing item id');
  await callApi(`/api/grades/items/${gradeItemId}`, {
    method: 'PATCH',
    headers: authHeaders(student.accessToken),
    body: JSON.stringify({
      notes: 'Need to review cell transport too',
      percent: 72,
    }),
  });
  const finalTarget = await callApi('/api/grades/final-target', {
    method: 'POST',
    headers: authHeaders(student.accessToken),
    body: JSON.stringify({
      courseId,
      targetLetter: 'B',
    }),
  });
  assert.ok(
    Array.isArray(finalTarget.payload?.assumptions) || Number.isFinite(finalTarget.payload?.requiredOnFinal),
    'final target response missing assumptions/required score'
  );
  const reviewCreate = await callApi('/api/grades/reviews', {
    method: 'POST',
    headers: authHeaders(student.accessToken),
    body: JSON.stringify({
      courseId,
      sourceType: 'quiz',
      sourceTitle: 'Cell structure quiz',
      questionText: 'What does the mitochondria do?',
      studentAnswer: 'It stores water.',
      correctAnswer: 'It produces energy for the cell.',
      conceptTags: ['cell biology', 'mitochondria'],
      difficulty: 'medium',
      date: '2026-03-30',
    }),
  }, 201);
  const reviewId = reviewCreate.payload?.review?.id as string;
  assert.ok(reviewId, 'wrong-answer review missing id');
  const reviewExplain = await callApi(`/api/grades/reviews/${reviewId}/explain`, {
    method: 'POST',
    headers: authHeaders(student.accessToken),
  });
  assert.ok(reviewExplain.payload?.explanation?.correctAnswer, 'wrong-answer explanation missing');
  await callApi(`/api/grades/reviews/${reviewId}`, {
    method: 'PATCH',
    headers: authHeaders(student.accessToken),
    body: JSON.stringify({
      explanation: 'The mitochondria is the cell power source.',
      teacherNotes: 'Review organelle functions',
    }),
  });
  const gradesSnapshot = await callApi('/api/grades', { headers: authHeaders(student.accessToken) });
  assert.ok(Array.isArray(gradesSnapshot.payload?.courses) && gradesSnapshot.payload.courses.length > 0);

  logStep('Backpack / coach');
  const coachProcess = await callApi('/api/coach/process', {
    method: 'POST',
    headers: authHeaders(student.accessToken),
    body: JSON.stringify({
      title: 'Biology notes',
      text: 'Cells have organelles. The mitochondria helps release energy. Review transport, osmosis, and diffusion for Friday quiz.',
      sourceType: 'document',
      attachments: [{ name: 'bio-notes.txt', type: 'text/plain' }],
    }),
  });
  assert.ok(coachProcess.payload?.summary, 'coach summary missing');
  const coachAssetId = coachProcess.payload?.assetId as string;
  assert.ok(coachAssetId, 'coach process missing assetId');
  const coachAssets = await callApi('/api/coach/assets', { headers: authHeaders(student.accessToken) });
  assert.ok(Array.isArray(coachAssets.payload) && coachAssets.payload.some((asset: JsonRecord) => asset.id === coachAssetId));
  await callApi('/api/coach/knowledge', {
    method: 'POST',
    headers: authHeaders(student.accessToken),
    body: JSON.stringify({
      title: 'Biology weak area',
      detail: 'Need to review osmosis before Friday quiz.',
      sourceType: 'coach_note',
      metadata: { source: 'full-smoke' },
    }),
  });
  await callApi('/api/coach/knowledge', { headers: authHeaders(student.accessToken) });
  const actionItems = Array.isArray(coachProcess.payload?.actionItems) ? coachProcess.payload.actionItems : [];
  if (actionItems.length > 0) {
    await callApi(`/api/coach/assets/${coachAssetId}/action-items/reminder`, {
      method: 'POST',
      headers: authHeaders(student.accessToken),
      body: JSON.stringify({
        actionItem: actionItems[0],
        schedulePreset: 'tomorrow_evening',
      }),
    });
  }

  logStep('Study library generation and edits');
  const flashcards = await callApi('/api/study/flashcards', {
    method: 'POST',
    headers: authHeaders(student.accessToken),
    body: JSON.stringify({
      title: 'Biology organelles',
      text: 'The mitochondria produces energy. Osmosis is water movement across a membrane. Diffusion is movement from high to low concentration.',
      audienceLevel: 'High school biology',
    }),
  });
  const flashcardSetId = flashcards.payload?.flashcardSetId as string;
  assert.ok(flashcardSetId, 'flashcard generation missing set id');
  assert.ok(Array.isArray(flashcards.payload?.cards) && flashcards.payload.cards.length > 0);
  await callApi(`/api/study/flashcards/${flashcardSetId}`, {
    method: 'PATCH',
    headers: authHeaders(student.accessToken),
    body: JSON.stringify({ title: 'Biology organelles reviewed' }),
  });
  const firstCardId = flashcards.payload.cards?.[0]?.id as string | undefined;
  if (firstCardId) {
    await callApi(`/api/study/flashcards/${flashcardSetId}/cards/${firstCardId}`, {
      method: 'PATCH',
      headers: authHeaders(student.accessToken),
      body: JSON.stringify({
        front: 'What does the mitochondria do?',
        back: 'It helps the cell release usable energy.',
      }),
    });
  }
  await callApi(`/api/study/flashcards/${flashcardSetId}/review`, {
    method: 'POST',
    headers: authHeaders(student.accessToken),
    body: JSON.stringify({
      topicName: 'Biology',
      totalCards: flashcards.payload.cards?.length ?? 0,
      correctCount: Math.max(1, Math.floor((flashcards.payload.cards?.length ?? 1) / 2)),
      incorrectCount: Math.max(0, (flashcards.payload.cards?.length ?? 1) - Math.max(1, Math.floor((flashcards.payload.cards?.length ?? 1) / 2))),
      confidence: 'medium',
    }),
  });
  const quiz = await callApi('/api/study/quiz', {
    method: 'POST',
    headers: authHeaders(student.accessToken),
    body: JSON.stringify({
      title: 'Biology practice quiz',
      text: 'The mitochondria releases energy. Osmosis is water movement. Diffusion is movement from high to low concentration.',
      audienceLevel: 'High school biology',
      questionCount: 4,
    }),
  });
  const quizId = quiz.payload?.quizId as string;
  assert.ok(quizId, 'quiz generation missing quiz id');
  await callApi(`/api/study/quizzes/${quizId}`, {
    method: 'PATCH',
    headers: authHeaders(student.accessToken),
    body: JSON.stringify({ title: 'Biology practice quiz reviewed' }),
  });
  const firstQuestionId = quiz.payload?.questions?.[0]?.id as string | undefined;
  if (firstQuestionId) {
    await callApi(`/api/study/quizzes/${quizId}/questions/${firstQuestionId}`, {
      method: 'PATCH',
      headers: authHeaders(student.accessToken),
      body: JSON.stringify({
        questionText: quiz.payload.questions[0].questionText,
        explanation: 'Remember that mitochondria is linked to energy production.',
      }),
    });
  }
  await callApi(`/api/study/quizzes/${quizId}/complete`, {
    method: 'POST',
    headers: authHeaders(student.accessToken),
    body: JSON.stringify({
      topicName: 'Biology',
      scorePercent: 75,
      totalQuestions: quiz.payload.questions?.length ?? 4,
      correctCount: 3,
      incorrectCount: 1,
    }),
  });
  const library = await callApi('/api/study/library', { headers: authHeaders(student.accessToken) });
  assert.ok(Array.isArray(library.payload?.flashcardSets) && Array.isArray(library.payload?.quizzes));

  logStep('chat and agent integrations');
  const chatBasic = await callApi('/api/chat/send', {
    method: 'POST',
    headers: authHeaders(student.accessToken),
    body: JSON.stringify({
      message: 'What class do I have next?',
      studyMode: 'study_chat',
    }),
  });
  assert.ok(chatBasic.payload?.assistantMessage, 'chat basic response missing');
  const chatGrades = await callApi('/api/chat/send', {
    method: 'POST',
    headers: authHeaders(student.accessToken),
    body: JSON.stringify({
      message: 'What is my estimated grade in Biology?',
      studyMode: 'study_chat',
    }),
  });
  assert.ok(chatGrades.payload?.assistantMessage, 'chat grade response missing');
  const chatLibrary = await callApi('/api/chat/send', {
    method: 'POST',
    headers: authHeaders(student.accessToken),
    body: JSON.stringify({
      message: 'Find me a beginner biology textbook and 2 alternatives.',
      studyMode: 'library',
    }),
  });
  assert.ok(chatLibrary.payload?.assistantMessage, 'chat library response missing');
  await callApi('/api/chat/threads', { headers: authHeaders(student.accessToken) });

  logStep('admin ops surface');
  await callApi('/api/admin/overview', { headers: authHeaders(admin.accessToken) });
  const adminUsers = await callApi('/api/admin/users', { headers: authHeaders(admin.accessToken) });
  assert.ok(Array.isArray(adminUsers.payload?.users), 'admin users missing');
  await callApi(`/api/admin/users/${student.user.id}`, { headers: authHeaders(admin.accessToken) });
  await callApi(`/api/admin/users/${student.user.id}/credits`, {
    method: 'PATCH',
    headers: authHeaders(admin.accessToken),
    body: JSON.stringify({ delta: 50, reason: 'Full smoke validation' }),
  });
  await callApi(`/api/admin/users/${student.user.id}/tier`, {
    method: 'PATCH',
    headers: authHeaders(admin.accessToken),
    body: JSON.stringify({ tier: 'tier_2', resetCredits: false }),
  });
  await callApi('/api/admin/managed-usage', { headers: authHeaders(admin.accessToken) });
  await callApi('/api/admin/providers', { headers: authHeaders(admin.accessToken) });
  await callApi('/api/admin/system', { headers: authHeaders(admin.accessToken) });
  await callApi('/api/admin/content', { headers: authHeaders(admin.accessToken) });
  await callApi('/api/admin/audit?limit=50', { headers: authHeaders(admin.accessToken) });

  logStep('cleanup reminder and schedule delete');
  await callApi(`/api/reminders/${reminderId}`, {
    method: 'DELETE',
    headers: authHeaders(student.accessToken),
  });
  await callApi(`/api/schedule/entries/${scheduleCreateTwo.payload?.entry?.id}`, {
    method: 'DELETE',
    headers: authHeaders(student.accessToken),
  });

  console.log('\n[smoke] all critical flows passed');
}

main().catch((error) => {
  console.error('\n[smoke] failure:', error);
  process.exitCode = 1;
});
