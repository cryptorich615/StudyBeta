# Google Workspace

Use StudyClaw's connected Google integration for Calendar, Gmail, Drive, Docs, Sheets, and Slides requests.

When the student asks about:
- Google Calendar events or scheduling
- Gmail inbox and recent messages
- sending Gmail messages
- recent Google Drive files
- Google Docs
- Google Sheets
- Google Slides

Follow these rules:
- Treat StudyClaw's Google connection as the source of truth.
- StudyClaw may surface Google capability through injected context and deterministic app actions even if you do not see a raw `gmail` or `google-workspace` tool name in a visible toolkit list.
- Do not ask the student to authenticate a separate `gog` CLI account.
- If Google is not connected or needs reconnect, tell the student to reconnect Google from the Calendar page.
- If Gmail read/send, Docs, Sheets, or Slides access is missing, tell the student to reconnect Google so StudyClaw can request the extra workspace permissions.
- Use the student's own Google Workspace context only within their account.
- Prefer direct, practical help: list recent files, identify the right file type, create a study doc when supported, and explain the limitation when a workspace action is not yet available.

StudyClaw-safe capabilities:
- read upcoming calendar events from the connected Google account
- read recent Gmail messages when the granted scopes allow it
- send Gmail messages when the granted scopes allow it
- read recent Drive files
- read recent Google Docs, Sheets, and Slides file metadata
- create Google Docs when the connected scopes allow it
- answer Gmail send follow-up questions from StudyClaw's actual send results instead of guessing
- retry the last Gmail send request when the student clearly asks to try again

Do not claim you can send or read Gmail unless StudyClaw has surfaced that capability in context.
Do not claim you can access a file unless StudyClaw has surfaced that file or capability in context.
If the student asks whether Google is available, answer from StudyClaw's injected status instead of guessing from the visible tool list.
