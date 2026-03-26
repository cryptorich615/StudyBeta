# HOW

This file explains exactly how StudyClaw loads a chosen personality like `Dixie` or `Willow` into the correct user account.

## High-Level Flow

1. The user signs up or logs in.
2. The frontend sends the user to onboarding if they do not already have an agent preset.
3. The user picks `Dixie` or `Willow`.
4. The frontend sends that preset to the backend with the selected model.
5. The backend creates or updates a dedicated OpenClaw agent for that specific user.
6. The backend stores the locked persona config in PostgreSQL.
7. The backend writes identity files into that user’s OpenClaw workspace so the agent knows who it is.
8. The frontend refreshes onboarding status and marks the account as ready.
9. Future chats and dashboard loads use that saved agent profile for that same user.

## Step 1: User Reaches Onboarding

The onboarding page lives here:

- [onboarding/page.tsx](/home/ubuntu/StudyBeta/studyclaw/apps/web/app/onboarding/page.tsx)

Important behavior:

- The page loads the session from `localStorage`.
- If the session already has an agent type, it redirects to `/dashboard`.
- If not, it loads model options from `GET /api/onboarding/options`.

The agent choices shown in the UI are hardcoded as:

- `quick_start_1` = `Dixie`
- `quick_start_2` = `Willow`

## Step 2: User Chooses Dixie or Willow

When the user clicks a persona card, the frontend stores the selected preset in local state:

- `selectedAgent = 'quick_start_1'` for Dixie
- `selectedAgent = 'quick_start_2'` for Willow

When the user clicks launch, the frontend posts this payload:

- `modelKey`
- `apiKey`
- `agentPreset`

to:

- `POST /api/onboarding/model-config`

That route lives here:

- [onboarding.route.ts](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/modules/onboarding/onboarding.route.ts)

## Step 3: Backend Enforces the Persona

The backend does not trust the frontend blindly. In `POST /model-config`, it only allows:

- `quick_start_1`
- `quick_start_2`

Anything else is rejected for this flow.

The locked persona templates are defined here:

- [agent-config.ts](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/lib/agent-config.ts)

Those templates map to:

- `quick_start_1` -> `Dixie`
- `quick_start_2` -> `Willow`

Each preset carries locked values like:

- `personaName`
- `tone`
- `verbosity`
- `teachingStyle`
- `reminderStyle`

So when the user chooses Dixie, the backend turns that into the Dixie personality config. Same for Willow.

## Step 4: The User Gets a Dedicated OpenClaw Agent

The backend creates one OpenClaw agent per user here:

- [user-agent.ts](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/lib/user-agent.ts)

The user-specific agent ID is built from the user UUID:

- `student_${userId-without-dashes-sliced}`

Example shape:

- `student_40cbf88695ea`

That is how the system knows which OpenClaw agent belongs to which StudyClaw account.

The backend creates or reuses that agent with:

- `openclaw agents add <agentId> --workspace <workspacePath> --agent-dir <agentStateDir> --model <model>`

Important result:

- one StudyClaw user
- one OpenClaw agent ID
- one OpenClaw workspace
- one OpenClaw state directory

This is the core account-to-agent binding.

## Step 5: The Persona Is Saved in PostgreSQL

After creating the user’s OpenClaw agent, the backend saves the selected persona into PostgreSQL in two places:

1. `agent_profiles`
2. `agents`

This happens in `ensureAgentProfile()` here:

- [onboarding.route.ts](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/modules/onboarding/onboarding.route.ts)

What gets stored:

- `user_id`
- `openclaw_agent_id`
- `model_key`
- `system_prompt`
- `persona_name`
- `tone`
- `verbosity`
- `teaching_style`
- `reminder_style`
- `preset_key`

This is what makes the persona persistent for that account.

## Step 6: The Persona Is Written Into the User’s OpenClaw Workspace

After the DB save, the backend calls:

- `syncUserWorkspaceIdentity(...)`

That writes identity files into the specific user workspace:

- `IDENTITY.md`
- `BOOTSTRAP.md`
- `USER.md`
- `CORE_TRAITS.md`

This logic is in:

- [user-agent.ts](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/lib/user-agent.ts)

For `Willow`, the identity file is written with:

- Name: `Willow`
- Creature: `calm study guide`
- Vibe: `calm, thoughtful, and steady`

For `Dixie`, the identity file is written with:

- Name: `Dixie`
- Creature: `sprint study coach`
- Vibe: `energetic, direct, and motivating`

This is the part that makes the agent "know" who it is when loaded later.

## Step 7: Model Credentials Are Bound To That Same User Agent

The backend also stores the model provider credentials for the same user in:

- `user_model_credentials`

Then it writes provider auth into that user’s OpenClaw agent state:

- `auth-profiles.json`
- `models.json`

That binding happens through:

- `bindUserAgentCredential(...)`

in:

- [user-agent.ts](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/lib/user-agent.ts)

This matters because the selected persona is not enough by itself. The same user agent also needs model access.

## Step 8: The Frontend Marks Onboarding Complete

After `/api/onboarding/model-config` succeeds, the frontend calls:

- `GET /api/onboarding/status`

Then it writes back into the stored session and adds:

- `agent_type`
- `onboarding_complete`

That logic is here:

- [onboarding/page.tsx](/home/ubuntu/StudyBeta/studyclaw/apps/web/app/onboarding/page.tsx)
- [session.ts](/home/ubuntu/StudyBeta/studyclaw/apps/web/lib/session.ts)

From that point on, the user account is treated as already configured and gets sent to the dashboard instead of onboarding.

## Step 9: Bootstrap Chat Uses the Saved Persona

When bootstrap chat starts, the backend loads the saved `agent_profiles` row and picks an intro based on `preset_key`.

Examples:

- Dixie intro for `quick_start_1`
- Willow intro for `quick_start_2`

It also builds the bootstrap prompt using:

- `personaName`
- `tone`
- `teachingStyle`

That happens here:

- [onboarding.route.ts](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/modules/onboarding/onboarding.route.ts)
- [bootstrap.ts](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/lib/bootstrap.ts)

So the first assistant message already reflects the chosen persona.

## Why The Persona Loads Into The Correct Account

The binding is correct because everything keys off the same `user_id`.

The same `user_id` is used to:

- create the OpenClaw agent ID
- create the workspace path
- create the agent state directory
- store the persona row in `agent_profiles`
- store the visible agent row in `agents`
- store the model credentials in `user_model_credentials`

That means Dixie chosen by User A cannot accidentally become Willow for User B unless the DB rows or workspace paths are manually corrupted.

## Exact Files Responsible

- [onboarding/page.tsx](/home/ubuntu/StudyBeta/studyclaw/apps/web/app/onboarding/page.tsx)
- [onboarding.route.ts](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/modules/onboarding/onboarding.route.ts)
- [agent-config.ts](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/lib/agent-config.ts)
- [user-agent.ts](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/lib/user-agent.ts)
- [bootstrap.ts](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/lib/bootstrap.ts)
- [session.ts](/home/ubuntu/StudyBeta/studyclaw/apps/web/lib/session.ts)

## Short Version

When the user chooses `Dixie` or `Willow`, StudyClaw:

1. saves that preset against the user’s `user_id`
2. creates or reuses a dedicated OpenClaw agent for that same `user_id`
3. writes persona identity files into that user’s workspace
4. stores the locked system prompt and persona fields in the database
5. reuses those saved records whenever the account loads again

That is how the chosen personality is loaded into the correct user account properly.
