# CampusConnect — Campus Maintenance & Emergency Reporting

Full-stack web app for campus facility complaints and student emergency alerts. Students report maintenance issues and emergencies and track progress. Facilities staff triage, prioritise, assign, and resolve tickets with proof of fix. Medical/security responders handle emergencies. Administrators manage accounts and campus configuration.

> **Status:** feature-complete for the specification in this repository, **not yet production-verified**. External services (Gemini, notification relay) have only been tested with mocks here. See §8 for what still needs setup and `CODEBASE_INDEX.md` for the change history.

---

## 1. Architecture

- **Frontend:** React 19 + TypeScript SPA, Tailwind CSS v4.
- **Backend:** Node.js + Express (`server.ts` + `src/server/featureRoutes.ts`), run with `tsx`.
- **Storage:** JSON files in `CAMPUSCONNECT_DATA_DIR` (default `./.data`): users/profiles, tickets, emergencies, incidents, notifications, config, audit, room checks, Campus Pulse, plus private evidence photos in `evidence/`. Atomic temp-file + rename writes.
- **Scheduler:** in-process server timer (`src/server/scheduler.ts`) for emergency escalation, SLA escalation, and notification retries.
- **AI (optional):** Gemini via `@google/genai`, called **only** from student complaint intake (`POST /api/complaints/analyze`).

## 2. Roles and features

| Role | What they can do |
|---|---|
| **Student** | Profile (stored server-side, used for emergency autofill); submit complaints (5 categories incl. **Other** with required title; campus/building/floor/room; optional photo; impact questions; review before submit); optional AI suggestions with follow-up questions that refine the **same** draft; track own tickets, SLA target, staff estimate, blockers, proof-of-fix photo; report a failed repair; see verified workarounds; **Emergency** button (2 steps); anonymous **Campus Pulse** feedback. |
| **Staff** | Dashboard with search, filters (category, status, department, building, priority, date range) and sorting; shared-incident panel (automatic clusters first); ticket detail with priority explanation, impact inputs, override with reason, assignment to real staff accounts, status workflow, **proof-of-fix upload** (required before Resolved), blockers, ETA window, asset link, workarounds, internal notes, duplicate review; Insights tab (Campus X-Ray, repeat offenders, classroom readiness + room checks, waste detector, Campus Pulse signals, facility verification). |
| **Responder** (medical/security) | Sees only emergencies they were alerted to, are handling, or that are in a zone they are on duty for; acknowledge, mark responding, add updates, escalate, close with outcome; full notification/escalation history. No access to maintenance tickets. |
| **Admin** | Staff/admin/responder accounts (create, suspend, role, department, alert phone); configuration (routing, SLA hours, escalation, timezone, buildings, zones, duty shifts, assets, rooms, facilities, thresholds); notification provider status; metrics; audit history; everything a responder can see. |

All rules are enforced on the server; the UI only mirrors them.

## 3. Key rules (deterministic, no AI)

- **Priority engine** (`src/server/priorityEngine.ts`): safety +40, category urgency +5..10, people affected +0..30, accessibility +15, critical service +15, no alternative +10 (unknown +5), overdue +15. ≥60 Critical, ≥40 High, ≥20 Medium. Safety risk or cluster membership floors at High. Staff overrides require a reason and are audited.
- **SLA:** deadline = created + configured hours for category/priority (defaults Critical 4h, High 24h, Medium 72h, Low 168h). Overdue → level 1 (department staff), +50% of period → level 2 (admins). Each escalation records time, previous owner, next authority, reason, level.
- **Clustering:** ≥10 *distinct students* with related unresolved complaints (same category + building + shared concept or ≥30% word overlap) within a rolling 2 hours → shared incident at High. Repeat submissions from one student do not count. Staff can unlink/dismiss; tickets are never merged or closed. *Limitation:* keyword/synonym matching (English + common Hinglish), not semantic understanding.
- **Proof of fix:** Resolved requires a summary (≥10 chars) and a JPEG/PNG/WebP photo ≤5MB whose bytes match its type, uploaded by staff of the responsible department or an admin. A student's "repair didn't work" report reopens to Under Review and supersedes old evidence (kept in history).
- **Emergency:** incident is saved before any alert is sent; duplicate taps share one request id; a second report within the configured window asks "is this new?"; reporter details come from the server-side profile. Alert states shown to students come only from recorded provider outcomes ("accepted" ≠ "delivered").

## 4. Setup

```bash
npm install
cp .env.example .env    # then edit .env
npm run dev             # development (Vite) at http://localhost:3000
```

### Environment variables

| Variable | Needed for |
|---|---|
| `GEMINI_API_KEY`, `GEMINI_MODEL` (default `gemini-3.8-flash`), `GEMINI_TIMEOUT_MS` | Optional AI suggestions. Without a key the app says "AI not configured" and uses labelled keyword rules. |
| `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD` | Creating the first admin (password ≥ 12 chars). |
| `NOTIFY_WEBHOOK_URL`, `NOTIFY_WEBHOOK_SECRET`, `NOTIFY_RECEIPT_SECRET` | Sending emergency/SLA alerts through your relay, and confirming delivery. See `.env.example` for the payload and signature format. |
| `CAMPUS_EMERGENCY_CONTACT` | Emergency number shown in the footer (leave empty if not verified). |
| `CAMPUSCONNECT_DATA_DIR` | Persistent data location. |
| `SCHEDULER_INTERVAL_MS` | Scheduler period (default 30 s). |
| `CAMPUSCONNECT_DEMO_SEED` | `true` seeds demo accounts/tickets with published passwords (never for real users). |
| `PORT` | Default 3000. |

### First-time campus configuration (Admin Console → Configuration)

Without this data the related features show an explicit "not configured/unavailable" state instead of invented values:

1. **Zones** → **Buildings** (optionally with latitude/longitude) — building list, Campus Pulse, emergency zone routing.
2. **Responder accounts** (Staff Management, role *Responder*, with alert phone) → **Shifts** (days, times in the configured timezone, zones, backup flag).
3. **Routing**, **SLA hours**, **acknowledgement timeout**.
4. **Assets** → **Rooms** (for repeat-offender detection and classroom readiness), **Facilities** (for workarounds; staff then verify availability).

## 5. Testing

```bash
npm test               # 4 suites, mocked Gemini + mocked notification provider, temp data dir
npm run lint           # tsc --noEmit
npm run build          # production frontend build
npm run check:gemini   # ONE real Gemini call with your .env key/model
```

`npm test` never contacts Gemini or a notification provider and never touches `.data/`. Only `npm run check:gemini` exercises the real Gemini API; the notification relay must be tested against your own endpoint.

## 6. Production

```bash
npm run build
npm start              # tsx server.ts --production (serves dist/, starts the scheduler)
```

Never run `npm run dev` on a public host.

## 7. Privacy

- Students see only their own tickets, emergencies, and evidence. Internal notes, duplicate data, cluster links, priority-override reasons, and SLA escalation details are removed from student responses.
- Emergency details are visible only to the reporting student, alerted/on-duty responders, and admins — never to maintenance staff or other students.
- Evidence photos are stored outside the web root and served only through authenticated, ownership-checked requests with `Cache-Control: no-store`.
- Campus Pulse stores topic, building, optional message, and the hour; no account or IP address. Aggregates hide groups smaller than the configured minimum (default 5); messages are admin-only. A message can still identify its author if they write identifying details.

## 8. Known limitations and production blockers

- **Not tested against real external services here:** Gemini (mocked only) and the notification relay (mocked only). Run `npm run check:gemini` and send a test alert through your relay before relying on them.
- **No SMS/voice provider is built in.** Alerts go to your HTTPS relay; delivery is confirmed only by signed receipts.
- **File-backed storage:** single server instance on a persistent disk only. Ephemeral disks (e.g. Cloud Run without a volume) lose data; multiple instances overwrite each other. A database migration is required for scaled or serverless hosting.
- **Scheduler runs in-process:** if the server is down, escalations are delayed until it restarts. For multi-instance hosting, run `runSchedulerTick` from a single cron job instead.
- **Failed notification retries** are held in memory; after a restart, failed sends are not retried automatically (they remain visible as failed).
- **No login rate limiting** yet.
- **Campus X-Ray** is a list; there is no map rendering even when coordinates are configured.
- **Accessible-route recommendations** are not offered (no verified route data source).
- **Clustering and waste detection** use keyword rules, not semantic analysis.
- **Accessibility** was improved (labels, focus ring, reduced motion, alert roles, text labels for status) but not audited with assistive technology.
