# TradeSimple Intel public beta deployment

This is a **separate public research beta**, not a replacement for the owner-operated installation. Never copy an existing owner's research database or session credentials onto the public beta server.

## Architecture

- **Vercel:** Vite/React frontend, HTTPS, and \`api/relay.mjs\` forwarding same-origin \`/api/*\` and \`/geo/*\` requests to the backend.
- **Dedicated VPS:** existing Node server, persistent SQLite storage, jobs, and licensed data-source credentials. Caddy terminates HTTPS.
- **Authentication:** an owner password still protects administrative and saved-research operations. Unauthenticated clients can call only routes in \`server/lib/publicBeta.mjs\`. Anonymous research is transient; it **does not** create user accounts, protect per-user notebooks, or offer multi-user storage.
- **Compute limits:** explicit anonymous route/tool allowlists; per-visitor and global rate caps; a positive monthly AI budget with a hard stop. Set a separate billing cap at the AI provider as a second safeguard.

**Important:** the frontend currently contains controls for private workflows. Those controls may return "not available in the public beta." Multi-user accounts, saved research, notifications, scheduled tasks, and persistent individual watchlists are **not** public beta features.

## Prepare the VPS

Provision a **new** Ubuntu VPS (at least 2 vCPU and 4 GB RAM is a sensible starting point) with a domain such as \`api-intel.example.com\`. Do not deploy the owner's local database. Use the existing \`deploy/bootstrap.sh\` setup instructions in \`docs/REFERENCE.md\`. Enable TLS and verify \`https://api-intel.example.com/healthz\` replies \`ok\`. The provided bootstrap config is for the owner installation and remains password-protected until explicitly enabled.

Set backend variables in the root-owned \`/etc/tradesimple/env\`:

\`\`\`dotenv
PUBLIC_ORIGIN=https://api-intel.example.com
INTEL_PUBLIC_BETA=on
INTEL_PROXY_SECRET=<a unique cryptographically random 32+-character secret>
INTEL_PASSWORD_HASH=<generated with npm run auth:hash>
INTEL_SESSION_SECRET=<generated with npm run auth:hash>
ASK_PROVIDER=openrouter
OPENROUTER_API_KEY=<private provider key>
ASK_MODEL=<tested and budgeted model ID>
ASK_MONTHLY_BUDGET_USD=20
ASK_BUDGET_HARD_STOP=1
TASKS_SCHEDULER=off
\`\`\`

Add only the source keys you actually need (\`CONGRESS_API_KEY\`, \`FEC_API_KEY\`, \`LDA_API_KEY\`, and optionally \`SEC_CONTACT\`). Set a **provider-side** spending limit and keep all secret variables in the VPS environment, not the Vercel build or the browser. Use a random independent proxy secret that is **not** an API key or session secret. Never commit these values, print them into CI logs, or paste them into a chat.

The owner's sign-in is at the **backend** domain, not the Vercel domain. Keep the backend private research database empty and don't share owner login credentials with beta visitors.

## Prepare Vercel

Connect \`Jhsiehm/Tradesimple-intel\` to a **new** Vercel Vite project on the \`main\` branch **after the code review and PR merge**. The checked-in \`vercel.json\` sets the frontend build and API relay. Set these two **encrypted runtime variables** on Vercel (preview and production when appropriate):

\`\`\`dotenv
INTEL_BACKEND_ORIGIN=https://api-intel.example.com
INTEL_PROXY_SECRET=<exact same independent random secret as the VPS>
\`\`\`

Do **not** add \`OPENROUTER_API_KEY\`, Congress/FEC/LDA credentials, or the owner session hash to Vercel. The server-to-server relay supplies a signed visitor identifier to backend rate limiting and intentionally strips browser Authorization and Cookie headers. The Vercel domain is therefore **public beta only**; visit the backend domain directly for owner-only operations.

For previews, use a **separate sandbox backend** or keep deployments protected. Don't route unreviewed PRs into production data/services. Treat the Vercel deployment as unready until \`/api/ask\`, \`/api/backtest\`, and several feeds work through its own domain. Streaming requests also need verification under real Vercel function limits.

## Acceptance checks before announcing publicly

1. CI passes: \`npm run format:check\`, \`npm test\`, \`npm run build\`, and the GitHub Actions checks.
2. Production Vercel URL serves a working Vite terminal and \`GET /api/health\` succeeds through the relay.
3. \`GET /api/congress/feed\`, \`GET /api/tickers/NVDA\`, and a supported backtest actually return data.
4. A normal AI question returns streaming tokens and source citations; changing model/context parameters cannot select private saved records or owner-only tools.
5. Unauthenticated \`/api/research/experiments\`, \`/api/tasks\`, \`/api/notify\`, and \`/api/live/stream\` are rejected even when the **backend domain** is called directly.
6. POSTing a backtest or asking AI respects per-visitor and global caps; crossing the AI hard budget returns a safe error. Confirm source provider quotas.
7. Confirm all data sources and backtests label dates, limitations, and missing coverage, and that a stranger cannot access the owner dashboard.
8. Load-test realistic traffic, verify memory/CPU/disk capacity, backups for any public server data, HTTPS renewal, error logs, rate limits, and rollback.
9. Verify the mobile layout and remove or clearly disable unsupported public-user controls before broad outreach.

## Release/rollback

Keep this beta on a feature branch until CI, endpoint tests, security review, and the dedicated VPS pass. Merge only after testing. If the public beta behaves unexpectedly, turn off \`INTEL_PUBLIC_BETA\` and restart the backend to restore owner-only authentication; disable the Vercel production project or point it at an explanatory maintenance page. Rotate the relay secret if it was disclosed.

The application is for educational research, not trading advice. Public records may arrive late; backtests are hypothetical, not evidence of a reliable investment strategy.
