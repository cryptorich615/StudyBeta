# Browser Access

StudyClaw now routes authenticated students to a remote browser session hosted on your AWS server. The `/browser` page opens that session inline if the provider allows embedding, or transparently falls back to a new-tab noVNC view.

## Setup

1. Configure the environment variables in your deployment (see `.env` or systemd service):

   ```
   BROWSER_BASE_URL=http://SERVER_IP:6080/vnc.html
   BROWSER_PROVIDER=novnc
   BROWSER_EMBED_ALLOWED=true
   BROWSER_TIMEOUT_MINUTES=30
   BROWSER_RESTRICTIONS_ENABLED=false
   ```

2. Ensure the remote browser endpoint supports query parameters so StudyClaw can append a per-session token (the current implementation simply adds `?user={userId}&session={sessionId}`).
3. Start or restart StudyClaw so the new migration and API route are available.

## Architecture

- `apps/api/src/lib/browser-config.ts`: environment config for providers and policies.
- `apps/api/src/lib/browser-provider.ts`: provider interface plus the noVNC default.
- `apps/api/src/lib/browser-session.ts`: session lifecycle + policy stubs (`canUserLaunchBrowser`, `buildBrowserPolicy`, `enforceBrowserPolicy`).
- `apps/api/src/modules/browser/browser.route.ts`: authenticated endpoint that returns the launch/embedded URLs plus metadata.
- `apps/web/app/browser/page.tsx`: student UI with launch button, embed iframe, fallback link, and status cards.
- `apps/web/app/components/app-chrome.tsx`: new navigation entry for the Browser page.

## TODOs

- `TODO: browser restrictions` – enforce per-user policies before granting sessions.
- `TODO: website allowlist/blocklist` – gate endpoint access to approved origins.
- `TODO: admin controls` – add admin UI for manual approvals, session resets.
- `TODO: audit logging` – capture session creation/termination events centrally.

## Future Ideas

1. Replace the simple `?user=&session=` query usage with signed URLs or a proxy service.
2. Wire the browser sessions into OpenClaw’s managed browser skills to track history.
3. Add idle timers, allowlists, and restriction UI hooks for teachers or admins.
