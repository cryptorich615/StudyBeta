import { Router } from 'express';
import { db } from '../../lib/db';
import { requireAuth, type AuthedRequest } from '../../lib/auth';
import { ensurePlatformSchema } from '../../lib/platform-schema';
import { syncUserWorkspaceProfile } from '../../lib/user-agent';

export const userRouter = Router();
userRouter.use(requireAuth);

async function readProfile(userId: string) {
  const result = await db.query(
    `select
       u.id,
       u.email,
       u.full_name,
       sp.school_name,
       sp.grade_year,
       sp.major,
       sp.school_level,
       sp.timezone,
       sp.learning_style,
       sp.onboarding_complete
     from users u
     left join student_profiles sp on sp.user_id = u.id
     where u.id = $1`,
    [userId]
  );

  return result.rows[0] ?? null;
}

userRouter.get('/profile', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  const profile = await readProfile(req.user!.id);

  if (!profile) {
    return res.status(404).json({ error: 'not_found', message: 'User profile not found' });
  }

  res.json({
    user: {
      id: profile.id,
      email: profile.email,
      full_name: profile.full_name,
    },
    profile: {
      name: profile.full_name ?? '',
      school: profile.school_name ?? '',
      graduationYear: profile.grade_year ? Number(profile.grade_year) : null,
      major: profile.major ?? '',
      schoolLevel: profile.school_level ?? 'other',
      timezone: profile.timezone ?? 'America/New_York',
      learningStyle: profile.learning_style ?? '',
      onboardingComplete: !!profile.onboarding_complete,
    },
  });
});

userRouter.post('/profile', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  const {
    name,
    school,
    graduationYear,
    major,
  } = req.body as {
    name?: string;
    school?: string;
    graduationYear?: number | string;
    major?: string;
  };

  const trimmedName = name?.trim();
  const trimmedSchool = school?.trim();
  const normalizedYear = `${graduationYear ?? ''}`.trim();
  const trimmedMajor = major?.trim() ?? '';

  if (!trimmedName || !trimmedSchool || !normalizedYear) {
    return res.status(400).json({
      error: 'bad_request',
      message: 'name, school, and graduationYear are required',
    });
  }

  await db.query(`update users set full_name = $2 where id = $1`, [req.user!.id, trimmedName]);
  await db.query(
    `insert into student_profiles (user_id, school_name, grade_year, major, onboarding_complete)
     values ($1, $2, $3, $4, true)
     on conflict (user_id) do update set
       school_name = excluded.school_name,
       grade_year = excluded.grade_year,
       major = excluded.major,
       onboarding_complete = true`,
    [req.user!.id, trimmedSchool, normalizedYear, trimmedMajor || null]
  );

  const subjectsResult = await db.query(
    `select name
     from subjects
     where user_id = $1
     order by created_at asc
     limit 12`,
    [req.user!.id]
  );

  await syncUserWorkspaceProfile({
    userId: req.user!.id,
    email: req.user!.email ?? `${req.user!.id}@local.invalid`,
    studentName: trimmedName,
    schoolName: trimmedSchool,
    gradeYear: normalizedYear,
    subjects: subjectsResult.rows.map((row: { name: string }) => row.name),
  });

  const profile = await readProfile(req.user!.id);
  res.json({
    user: {
      id: profile.id,
      email: profile.email,
      full_name: profile.full_name,
    },
    profile: {
      name: profile.full_name ?? '',
      school: profile.school_name ?? '',
      graduationYear: profile.grade_year ? Number(profile.grade_year) : null,
      major: profile.major ?? '',
      schoolLevel: profile.school_level ?? 'other',
      timezone: profile.timezone ?? 'America/New_York',
      learningStyle: profile.learning_style ?? '',
      onboardingComplete: !!profile.onboarding_complete,
    },
  });
});
