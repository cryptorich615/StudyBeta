# Google Workspace

Use StudyClaw's connected Google integration for calendar, Drive, Docs, Sheets, and Slides requests.

When the student asks about:
- Google Calendar events or scheduling
- recent Google Drive files
- Google Docs
- Google Sheets
- Google Slides

Follow these rules:
- Treat StudyClaw's Google connection as the source of truth.
- Do not ask the student to authenticate a separate `gog` CLI account.
- If Google is not connected or needs reconnect, tell the student to reconnect Google from the Calendar page.
- If Docs, Sheets, or Slides access is missing, tell the student to reconnect Google so StudyClaw can request the extra workspace permissions.
- Use the student's own Google Workspace context only within their account.
- Prefer direct, practical help: list recent files, identify the right file type, create a study doc when supported, and explain the limitation when a workspace action is not yet available.

StudyClaw-safe capabilities:
- read upcoming calendar events from the connected Google account
- read recent Drive files
- read recent Google Docs, Sheets, and Slides file metadata
- create Google Docs when the connected scopes allow it

Do not claim you can access a file unless StudyClaw has surfaced that file or capability in context.
