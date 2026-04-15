# Smart Internal Marks Management System (SIMMS) — Full Stack

Production-style app: **Vanilla JS** frontend, **Express** API, **MongoDB** (Mongoose), **JWT** auth, **bcrypt** passwords, aggregates for analytics, CSV import/export, activity logs, remedial tracking, 80/20 final calculation, risk & anomaly flags, and **admin-configurable marks deadline** (faculty lock after deadline; admin override).

## Prerequisites

- **Node.js 18+**
- **MongoDB** (local or Atlas)

## Setup

1. Copy environment file:

```bash
copy .env.example .env
```

Edit `.env` and set at least:

- `MONGODB_URI` — e.g. `mongodb://127.0.0.1:27017/simms`
- `JWT_SECRET` — long random string

2. Install dependencies:

```bash
npm install
```

3. Start MongoDB, then run the server (serves API + static client):

```bash
npm run dev
```

Open **http://localhost:5000** (or your `PORT`).

On first boot, seed creates:

| Role    | Username | Password   |
|---------|----------|------------|
| Admin   | `admin`  | `admin123` |
| Faculty | `faculty`| `faculty123` |
| Student | `student`| `student123` |

> [!IMPORTANT]
> **Dynamic Student Sync**: Adding a student via the **Enrollment** page automatically creates a corresponding **Institutional User** account.
> - **Username**: Student's full name, lowercase, no spaces (e.g., `janesmith`).
> - **Password**: Default is `student123` (can be changed in Settings by Admin).

### Troubleshooting

- **`EADDRINUSE` / port 5000**: Another process (often a previous `node` server) is using the port. Stop it (Ctrl+C in the terminal where it runs) or find it in Task Manager / `Get-NetTCPConnection -LocalPort 5000`. Alternatively set `PORT=5001` in `.env` and open that URL.

## Client (browser)

- **Live API (default)** — The UI talks to `/api` on the same origin as the static files (single `npm run dev` process). Ensure MongoDB is running and `.env` is valid.
- **Mock / offline demo** — No database: set `localStorage.setItem('simms_use_mock', '1')` in DevTools, or open any URL with `?mock=1`. Data is simulated in the browser (not the real seed).
- **Theme** — Use **Light** / **Dark** in the top bar (logged-in pages) or on the login landing nav. Preference is stored as `simms_theme` in `localStorage`.
- **Mobile** — Below ~1025px width, the sidebar becomes a drawer; open/close with the menu control in the top bar. Tap the dimmed overlay, press **Escape**, or follow a nav link to close.

## Project layout

```
server/
  server.js              # Express app, static /client
  config/db.js
  models/                # User, Student, Marks, AppSettings, RemedialSession, ActivityLog
  controllers/
  routes/
  middleware/            # auth, roles, marks deadline guard, errors
  utils/                 # 80/20 calc, CSV parse, student risk insights, activity helper
  seed.js
client/
  index.html             # Login
  pages/                 # dashboard, marks, analytics, students, settings
  css/style.css
  js/                    # api.js, auth.js, app.js, pages/*.js
```

## API highlights

- `POST /api/auth/login` — JWT
- `GET /api/auth/me`
- `GET|PATCH /api/settings` — deadline, thresholds, **`defaultTerm`** (PATCH **admin**)
- `GET|POST|PATCH|DELETE /api/students` — student roster (**admin** and **faculty** manage students). **POST** automatically creates a linked **User** account; **DELETE** removes it.
- `GET|POST|PATCH|DELETE /api/marks` — marks; **computed final** on server; request body uses **`student`** (Mongo ObjectId string) plus **`subject`**; legacy **`studentId`** is still accepted. `POST /api/marks/bulk` — JSON `{ "marks": [ { student, subject, term?, mid1?, mid2?, assignment?, lab? }, ... ] }` (max 200 rows; upserts like CSV). `POST /api/marks/import/csv` (multipart `file`; CSV must include **Name** + **Subject** columns — see `server/utils/csvParse.js`; optional **`?atomic=1`** or form field **`atomic=1`** — see **Strict CSV import** below)
- `GET /api/students/:id/academic-report` — full academic report for one student: **`years[]` → `semesters[]` → `subjects[]`** (marks with **`internalTotal`**, **`internalAtRisk`**), plus **`internalRiskSubjects`** (Internal-1 or Internal-2 &lt; 9) and **`remedials`**. **Student** role may only call this for their own `:id`; **admin** / **faculty** for any student.
- `GET /api/marks/meta/terms` — distinct **`term`** values in DB (+ **`defaultTerm`** from settings); scoped to the logged-in student for **student** role  
- `GET /api/marks` — optional **`?term=`**: omit or use current **`defaultTerm`** from settings; **`term=all`** = all academic terms  
- `GET /api/marks/export/csv`
- `GET /api/analytics/summary` — same **`term`** query as marks; MongoDB aggregates + chart data; includes **`studentRiskInsights`** and **`predictedHighRiskCount`** (predictive / multi-subject risk — see below)
- `GET|POST /api/remedials` — when marks are saved (or when staff **GET** the list), the server ensures one **`RemedialSession`** per qualifying marks row if none exists: **Internal-1 &lt; 9**, **Internal-2 &lt; 9**, or **final &lt; 16** (aligned with the student dashboard). Trivial all-zero rows are skipped. **`GET /api/remedials`** and **`GET /api/marks`** (faculty/admin) both run the same **sync** so the Intervention Log stays current even if you only use the Marks page. Faculty can add follow-up remedials from the Marks page after an intervention.
- `GET /api/activity` — faculty/admin; `GET /api/activity/export/csv` — **admin**
- `GET|POST|PATCH|DELETE /api/users` — **admin**

## 80/20 rule (server)

- Internal-1 = Mid-1 + Assignment  
- Internal-2 = Mid-2 + Lab / Assignment-2  
- `final = 0.8 * max(i1, i2) + 0.2 * min(i1, i2)`  
- For your college rule, each internal is out of **25**: usually **Mid = 20** and **Assignment / Practical = 5**.  
- **Marks `atRisk` flag** (marks table, filters, dashboard count): **`final < 16`** or **`internal1 < 9`** or **`internal2 < 9`** when marks are entered. Final below 16 is treated as a fail condition. Settings **`riskThreshold`** (default 40) is **not** used for this flag — it is for **analytics / predictive insights** and pass-style views only. Staff **GET /marks** reconciles stored `atRisk` against this rule.  
- **Anomaly** if internal gap spike or large jump vs prior final (see `server/utils/calcMarks.js`).

## Academic terms (historical / per-period marks)

Each marks document is unique on **`student` + `subject` + `term`** (`term` is a short string you define, e.g. `2025-T1`). That gives **one row per student per subject per period**, so past terms stay queryable without overwriting.

- **Settings → Default academic term**: used when creating marks without a **`term`** body field, as the default for **`GET /api/marks`** / analytics when **`?term`** is omitted (`2025-T1` if unset).
- **CSV import**: optional **`Term`** column (aliases **`academicterm`**, **`semester`**, **`period`** in the header). If omitted, rows use **`defaultTerm`** from settings.
- **Exports**: include a **Term** column.
- **Upgrades**: on server start, existing marks without **`term`** are backfilled from **`defaultTerm`**, then indexes are synced. If **`syncIndexes`** fails (e.g. old Mongo index name), drop the legacy **`student_1_subject_1`** unique index manually and restart.

## Predictive risk (multi-subject)

Single-mark **at-risk** flags use the threshold on one row. **Predictive risk** aggregates all marks per student and surfaces broader signals for faculty/admin dashboards and **`GET /api/analytics/summary`**:

- **Course average** vs the configured risk threshold (including borderline band).
- **Breadth**: several subjects below threshold, or one weak subject when the student has multiple courses.
- **History**: where **`priorFinal`** is stored, a recorded **drop** vs the previous final contributes to the score.
- **Pass mark**: very low minimum subject final across their courses.
- **Consistency**: unusually large gaps between the two internals in more than one subject.

Each affected student gets a **`riskScore`** (0–100), **`riskBand`** (`high` / `elevated` / `watch`), human-readable **`factors[]`**, plus **`courseAvg`**, **`subjectsTracked`**, and **`minFinal`**. Mock/offline mode mirrors the same logic in `client/js/mock-data.js`. The UI shows this on **Dashboard** (“Predictive risk”) and **Analytics** (“Predictive watchlist”). Students only receive the usual per-mark analytics scope, not the cohort watchlist.

## Strict CSV import (bulk reliability)

By default, CSV import applies **all valid rows** and reports parser/row issues in the response **`errors`** array; some rows may still import if others are invalid.

**Strict mode** avoids **partial** imports when the file itself has bad rows:

- **API**: `POST /api/marks/import/csv?atomic=1` (or add form field **`atomic=1`** with the file upload).
- **UI**: On **Marks Management**, enable **“Strict CSV: if any row fails validation…”** before choosing a file.

If **any** row fails structural validation (e.g. missing name/subject as enforced by `server/utils/csvParse.js`), the server responds with **400**, **`imported: 0`**, **`atomicAborted: true`**, and **no marks are written**. This satisfies an “all-or-nothing on validation” policy; it does not use MongoDB multi-document transactions (mid-import DB failures remain a separate, rare case).

## Security notes

- Passwords hashed with **bcrypt** (12 rounds).  
- JWT required for protected routes; role middleware on sensitive handlers.  
- For production, place the app behind HTTPS, rotate secrets, and tighten CORS.

## License

Use and modify as needed for your environment.
