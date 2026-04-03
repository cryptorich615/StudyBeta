# Open Library Feature

StudyClaw uses Open Library APIs to help students find textbooks, books by subject, edition details, cover images, and book-based research leads without scraping website pages.

## Where it lives

- Open Library client and normalization:
  - `apps/api/src/lib/openlibrary.ts`
- OpenClaw plugin source:
  - `../openclaw-home/extensions/openlibrary-student-tools`
- OpenClaw skill source:
  - `../openclaw-home/skills/study-library`

## Environment

Optional `.env` values:

```env
OPENLIBRARY_CONTACT_EMAIL=you@example.com
OPENLIBRARY_USER_AGENT_NAME=StudyClaw
OPENLIBRARY_TIMEOUT_MS=7500
OPENLIBRARY_ENABLE_SEARCH_INSIDE=false
```

## How students trigger it

In Chat:
- switch to `Books` mode
- use `/library`
- use the starter action `Find a textbook`

The agent is instructed to use Open Library tools first for textbooks, books by subject, edition comparison, reading lists, and book-based research.

## Tool set

- `openlibrary_search_books`
- `openlibrary_get_subject_books`
- `openlibrary_get_book_details`
- `openlibrary_get_cover_url`
- `openlibrary_search_inside_book`

## Known limitations

- Search Inside is experimental in Open Library and is disabled by default.
- Open Library metadata quality varies by title and edition.
- The agent should not claim a book is fully readable unless Open Library clearly marks that access level.

## Example prompts

- `Find me a beginner-friendly algebra textbook.`
- `Compare two good AP Biology textbooks and tell me which is easier to study from.`
- `Find a history book about the Renaissance and give me two easier alternatives.`
- `Look up ISBN 9780134093413 and tell me if this edition is a good fit for a college intro course.`
