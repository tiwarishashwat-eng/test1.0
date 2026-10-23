# CampusConnect — Codebase Index & Audit Baseline

Snapshot of the repository as received (2026-10-23), mapped against the upgrade specification.

## Phase 1 status (security & honesty) — done 2026-10-23

Fixed: defects 1–9, 11–14, 17, 24, 25, 28, plus two found during the work: the Vite dev server (which `npm start` used to run) served `.data/users.json` and server source over HTTP, and `dotenv` loaded after the stores read their env vars. Partially fixed: 10 (type/size validated server-side; photos still stored inline in JSON). Still open: 8 (login rate limiting), 15–16, 18–23, 26–27, 29, and all spec features from §3 onward. Baseline before changes: 64/64 tests, lint and build clean. After: 125/125 tests (new `securityAndHonesty.test.ts`), lint and build clean. Gemini tested with mocked clients only; no real API call has been made.

The sections below describe the code **as received**.

## 1. Stack & scripts

| Item | Value |
|---|---|
| Frontend | React 19 + TypeScript SPA, Tailwind v4 (`@tailwindcss/vite`), lucide-react, motion |
| Backend | Express 4 in `server.ts`, run directly with `tsx` (no compile step) |
| AI | `@google/genai` ^2.4.0, server-side only (`src/server/geminiService.ts`) |
| Persistence | Synchronous JSON files in `.data/` (`tickets.json`, `users.json`), temp-file + rename writes |
| Auth | PBKDF2 (10k iter, sha512) password hashes; random 32-byte bearer tokens stored in `users.json`; token kept in `localStorage` on client |
| `npm run dev` / `start` | `tsx server.ts` (dev mounts Vite middleware; `NODE_ENV=production` serves `dist/`) |
| `npm test` | `tsx geminiService.test.ts && tsx authAndWorkflow.test.ts` (custom `assert` harness, 63 asserts — README claims 64) |
| `npm run lint` | `tsc --noEmit` |
| `npm run build` | `vite build` (frontend only) |
| Node | v24.19.0 locally; **`node_modules` not installed**, so tests/lint/build have not been run yet |

## 2. File map

```
server.ts                          683  Express app: auth guards, all REST routes, Vite/static mount
src/shared/types.ts                293  Categories, statuses, departments, routing map, transitions, all DTOs
src/server/geminiService.ts        629  Gemini call, heuristic fallback, output sanitiser, duplicate detector
src/server/ticketStore.ts          731  TicketRepository singleton (seed data, filters, assign, status, notes, dup review, stats)
src/server/userStore.ts            357  UserStore singleton (seed accounts, hash, sessions, staff CRUD)
src/server/geminiService.test.ts   308  Heuristic classification, routing, summaries, follow-ups, duplicates, fallback
src/server/authAndWorkflow.test.ts 177  Login, IDOR, internal-note stripping, transitions, duplicate review
src/services/apiClient.ts          232  Fetch wrapper + typed endpoint methods, token in localStorage
src/context/AuthContext.tsx        111  user/token state, session restore via /api/auth/me
src/App.tsx                        131  View switch (student / track / staff / admin), health check, modals
src/components/
  auth/AuthModal.tsx               313  Login/register; one-click demo credential presets
  common/Header.tsx                208  Nav, status bar (hard-coded "Gemini 3.8 Flash Active"), user menu
  common/Footer.tsx                 97  Static footer ("Gemini 3.8 Flash Triage Engine")
  common/CategoryBadge.tsx, StatusBadge.tsx
  demo/DemoWalkthroughModal.tsx    350  Automated "7-step demo" that logs in as seeded student/staff
  student/StudentPortal.tsx        249  Hero, tab switcher, sample-scenario category cards
  student/ComplaintForm.tsx        649  Form + "Ask Gemini" + follow-ups + duplicate hints + photo
  student/TicketConfirmation.tsx   148  Post-submit receipt
  student/TicketTracker.tsx        381  Lookup by ticket ID, timeline, AI card
  student/MyComplaintsList.tsx     207  Student's own tickets with filters
  staff/StaffDashboard.tsx         434  Ticket table, filters, metrics, opens detail modal
  staff/StaffMetrics.tsx           101  Metric tiles
  staff/TicketDetailModal.tsx      619  Status change, assignment, internal notes, duplicate review
  staff/staffUtils.ts               75
  admin/AdminConsole.tsx           455  Staff list/create/suspend, departments tab, metrics tab
public/assets/aistudio/CampusConnect-integrated_*.zip   Older source snapshot, served publicly by Vite/static
.data/tickets.json, users.json     Live data: 8 users, 17 stored session tokens
```

## 3. API surface (server.ts)

| Method & path | Guard | Notes |
|---|---|---|
| POST `/api/auth/login` | none | no rate limiting |
| POST `/api/auth/register` | none | students only; min 6-char password |
| GET `/api/auth/me` | auth | |
| POST `/api/auth/logout` | none | deletes token if present |
| GET `/api/health`, `/api/storage/status` | **none** | exposes absolute storage file path and record count |
| POST `/api/complaints/analyze` | **none** | calls Gemini + scans **all** tickets for duplicates |
| POST `/api/complaints/submit` | auth | accepts client-supplied `aiAnalysis` verbatim |
| GET `/api/tickets` | auth | students scoped to own tickets; notes stripped |
| GET `/api/tickets/:id` | auth | 403 vs 404 reveals whether another student's ticket exists |
| POST `/api/tickets/:id/assign` | staff | `assignedTo` is free text, not validated against staff |
| POST `/api/tickets/:id/status` | staff | transition table enforced; no proof-of-fix |
| POST `/api/tickets/:id/notes` | staff | |
| POST `/api/tickets/:id/duplicate-review` | staff | |
| GET `/api/tickets/:id/history` | auth | does not normalise numeric IDs like `/:id` does |
| GET/POST `/api/admin/staff`, PATCH `/api/admin/staff/:id` | admin | PATCH passes `role`/`department` unvalidated and works on any user id |
| GET `/api/admin/metrics` | admin | real counts |

## 4. Defects and risks found

### Security / privacy (fix first)
1. **Hard-coded auto-login** as `alex.chen@campus.edu` when no token exists — `ComplaintForm.tsx:190`, `TicketTracker.tsx:54`. Anonymous visitors silently file and read tickets as a real seeded student.
2. **DemoWalkthroughModal** logs in as seeded student and staff from the browser (`:61`, `:93`, `:124`); **AuthModal** shows one-click credential presets (`:265-301`); **README §4** publishes all seeded passwords as "Default Verified Credentials".
3. `/api/complaints/analyze` is unauthenticated: quota abuse, and duplicate candidates leak other students' ticket IDs, titles and locations to anyone.
4. Ticket load assigns any record missing `studentId` to `user-student-1` (`ticketStore.ts:46`), giving one student other people's tickets.
5. Admin PATCH accepts any `role` string and any user id (can turn a student into admin or set an invalid role/department); no guard against an admin demoting or locking themselves out.
6. `.data/` is **not** in `.gitignore` — password hashes, salts and 17 live session tokens would be committed. Tokens are stored in plaintext (not hashed).
7. Public ZIP under `public/assets/` ships an old source snapshot to every visitor.
8. Password hash compared with `!==` (not constant time); PBKDF2 at 10k iterations is low; no login throttling.
9. Raw `err.message` returned to clients on 500s.
10. Photos stored as base64 data URIs inside `tickets.json` and returned in every list response; no server-side size check beyond the 6 MB body limit; analyze route accepts any `image/*` while submit allows only JPEG/PNG/WebP.

### Gemini / honesty
11. Model is hard-coded to `gemini-3.8-flash` (unverified); README, Header, Footer, StudentPortal and ComplaintForm all repeat it.
12. Header shows a pulsing **"Gemini 3.8 Flash Active"** regardless of `/api/health.geminiConfigured`.
13. Every failure (no key, quota, 429, timeout, bad JSON) is silently converted into heuristic output; the `fallbackReason` argument is discarded, so the UI cannot say *why* AI is unavailable. No request timeout.
14. Sanitiser maps unknown categories to Plumbing by default; client can forge `aiAnalysis` (including `isAiFallback: false`) on submit.
15. Heuristic is English-only; no Hindi/Hinglish handling. Prompt does not mention multilingual input.
16. Follow-up answers are concatenated into `description`, so `rawStudentInput` is not actually the original text.
17. `User-Agent: aistudio-build` header is an AI Studio leftover.

### Data model / workflow gaps
18. No **Other** category or custom Problem Title; UI text says "Exactly 4 supported campus categories".
19. Location is two free-text fields (building, location); no campus/site, floor, structured room.
20. `Emergency` exists only as a maintenance *priority*; there is no emergency incident, responder role, notification provider, escalation, or GPS.
21. No proof-of-fix: `Under Review → Resolved` is allowed directly with no summary/photo; students cannot dispute a repair.
22. No SLA rules, scheduler, overdue escalation, priority engine, clustering, asset tracking, readiness, workaround, incident linking, aggregate reporting, map, or waste detection.
23. Routing is a compile-time constant (`CATEGORY_DEPARTMENT_ROUTING`); not admin-configurable.
24. Seed tickets/users are always created on first start (no demo/real separation).
25. `TicketTracker` pre-fills "recent lookups" with seeded IDs CC-1001..1004 (fake history for every user).
26. Sample-scenario category cards in StudentPortal prefill fabricated complaints.
27. Header shows "Facilities Desk: ext. 4444" — unverified contact number.

### Persistence / tests
28. Both stores are module-level singletons bound to `process.cwd()/.data`; **tests write into the real data files** (they create tickets and sessions on every run).
29. Whole-file synchronous rewrite on every change; adequate for one process, unsafe for multiple instances or ephemeral Cloud Run disks (data is lost on redeploy).
30. Tests only exercise the heuristic path; no mocked Gemini client, no HTTP-level tests of the Express routes.

## 5. Spec coverage summary

| Spec § | Status in received code |
|---|---|
| 2 Gemini intake | Partial — single service exists; model, error reporting, multilingual, auth, and honesty need work |
| 3 Student portal | Partial — no Other/custom title, structured location, draft preservation, or proof view |
| 4–5 Emergency + responders | Missing |
| 6 Staff dashboard | Mostly present; needs assignment validation, priority/date filters, clusters, proof gate |
| 7 Admin console | Partial — staff CRUD only; no routing/SLA/zones/schedules/notification config/audit |
| 8 Priority engine | Missing (manual priority only) |
| 9 Clustering (10 in 2 h) | Missing |
| 10 Repeat offender | Missing (no asset identity in data) |
| 11 Readiness score | Missing (no equipment-check data; must show "unavailable") |
| 12 Proof of fix | Missing |
| 13 ETA/blockers | Missing |
| 14 Workarounds | Missing (no verified facility data) |
| 15 Incident linking | Missing |
| 16 Privacy-safe aggregates | Missing |
| 17 Campus X-Ray | Missing (no coordinates) |
| 18 Waste detector | Missing |
| 19 Accessibility | Partial — some labels; many `<label>`s not bound to inputs, colour-only status cues |
| 20 Auth/persistence | Partial — see defects 1–10, 28–29 |
| 21 Notifications/SLA | Missing — no provider configured |
| 22 Misleading UI/docs | Many issues — defects 2, 11, 12, 25–27 |
| 23 Tests | Partial — 63 asserts, heuristic-only |
| 24 Deployment | `.env.example` lists only `GEMINI_API_KEY`, `APP_URL` (AI Studio wording) |
