# CampusConnect — Campus Maintenance Complaints

Full-stack web app for reporting and resolving campus facility issues. Students submit and track their own complaints; facilities staff triage, assign, and update them; administrators manage staff accounts. Optional server-side Gemini suggestions help with categorisation and missing details.

> **Status:** work in progress. See `CODEBASE_INDEX.md` for what is implemented, what is missing, and known limitations.

---

## 1. Architecture

- **Frontend:** React 19 SPA, TypeScript, Tailwind CSS v4.
- **Backend:** Node.js + Express (`server.ts`), run with `tsx`.
- **AI (optional):** Gemini via `@google/genai`, called only from the server, only for student complaint intake. If Gemini is not configured or a call fails, the app says so and falls back to clearly labelled keyword-rule suggestions; students can always submit manually.
- **Auth:** PBKDF2-SHA512 password hashes (210k iterations), random bearer tokens stored server-side as SHA-256 hashes, role checks (`student`, `staff`, `admin`) on every protected route.
- **Storage:** JSON files in `CAMPUSCONNECT_DATA_DIR` (default `./.data`), written with temp-file + rename.

## 2. Roles

| Area | Who | What |
|---|---|---|
| Student Portal | signed-in students | Submit complaints, optional AI suggestions, view **only their own** tickets and status history |
| Staff Dashboard | `staff`, `admin` | Filter/search all tickets, assign department and priority, status workflow, private internal notes, duplicate review |
| Admin Console | `admin` | Create, suspend, and reassign staff; metrics from stored records |

Server-side privacy rules: students never receive internal notes or duplicate-review data (which refers to other students' complaints); a ticket that belongs to someone else returns the same 404 as a missing one; AI suggestions attached to a ticket are always the server's own result, never client-supplied.

## 3. Setup

```bash
npm install
cp .env.example .env    # then edit .env
npm run dev             # development server with Vite, http://localhost:3000
```

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | no | Server-side Gemini key. Without it, AI suggestions show as "not configured". |
| `GEMINI_MODEL` | no | Model id (default `gemini-3.8-flash`). Confirm your key can use it with `npm run check:gemini`. |
| `GEMINI_TIMEOUT_MS` | no | Abort a Gemini request after this long (default 15000). |
| `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD` | first run | Creates the first admin if no active admin exists (password ≥ 12 chars). Remove after first sign-in. |
| `CAMPUSCONNECT_DATA_DIR` | no | Where data files live (default `./.data`). Must be persistent storage. |
| `CAMPUSCONNECT_DEMO_SEED` | no | `true` seeds sample tickets and demo accounts **with published passwords** into an empty data dir. Never use with real users. |
| `PORT` | no | Default 3000. |

### Demo mode

With `CAMPUSCONNECT_DEMO_SEED=true` on an empty data directory, the server creates sample tickets and demo accounts. Their passwords are in `src/server/userStore.ts`, and the header shows a "DEMO DATA" banner. Without this flag, no accounts or tickets are created automatically.

**Existing `.data/` from the original download** already contains these demo accounts and sample tickets. For real use, start with an empty `CAMPUSCONNECT_DATA_DIR` and a bootstrap admin.

## 4. Testing

```bash
npm test               # all suites; uses a temporary data dir and mocked/absent Gemini
npm run lint           # tsc --noEmit
npm run build          # frontend production build
npm run check:gemini   # ONE REAL Gemini API call using your .env key and model
```

`npm test` never calls the real Gemini API. Only `npm run check:gemini` proves that live calls work.

## 5. Production

```bash
npm run build
npm start              # tsx server.ts --production: serves dist/, never the Vite dev server
```

- Never run `npm run dev` on a public host: the Vite dev server is for local development only.
- Keep `.env` and the data directory out of version control (both are in `.gitignore`).
- File-backed storage supports a **single server instance** with a persistent disk. On platforms with ephemeral disks (e.g. Cloud Run without a mounted volume), data is lost on restart or redeploy, and multiple instances would overwrite each other. A database is required for those deployments.
- Not yet implemented: login rate limiting, emergency alerts, notifications, SLA escalation, proof-of-fix. See `CODEBASE_INDEX.md`.
