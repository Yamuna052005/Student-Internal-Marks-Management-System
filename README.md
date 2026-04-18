# Smart Internal Marks Management System (SIMMS)

A full-stack academic management system designed to streamline internal marks handling, enforce submission deadlines, and provide actionable performance insights for students and faculty.

---

## 🚀 Overview

SIMMS is a production-oriented web application that enables institutions to manage internal assessments with strict controls, analytics, and automated workflows.

The system enforces **time-bound marks entry**, supports **role-based access control**, and provides **risk-based academic insights** to identify and support underperforming students.

---

## ⚙️ Tech Stack

* **Frontend**: HTML, CSS, JavaScript
* **Backend**: Node.js, Express
* **Database**: MongoDB (Mongoose)
* **Authentication**: JWT
* **Security**: bcrypt password hashing

---

## 🔑 Key Features

* Role-Based Access Control (**Admin / Faculty / Student**)
* Time-bound marks entry with automatic locking
* Admin override for post-deadline modifications
* 80/20 internal marks calculation logic
* Student performance analytics dashboard
* Predictive risk detection across subjects
* Remedial session tracking and automation
* CSV import/export for bulk data operations
* Activity logging for accountability

---

## 🔄 System Workflow

1. Faculty logs in and enters marks within the allowed deadline
2. System automatically locks marks after the deadline
3. Admin can override locked entries if required
4. Analytics module evaluates performance trends
5. At-risk students are flagged automatically
6. Remedial sessions are created for intervention

---

## 📁 Project Structure

```
server/
  controllers/
  models/
  routes/
  middleware/
  utils/

client/
  pages/
  js/
  css/
```

---

## 🧮 Marks Calculation Logic

* Internal 1 = Mid-1 + Assignment
* Internal 2 = Mid-2 + Assignment

Final score:

```
final = 0.8 * max(i1, i2) + 0.2 * min(i1, i2)
```

A student is flagged as **at-risk** if:

* `final < 16`
* OR combined internal score is critically low

---

## 📊 Predictive Risk System

The system evaluates students using:

* Course average vs threshold
* Performance consistency across subjects
* Historical trends (drop detection)
* Minimum subject score

Outputs:

* Risk Score (0–100)
* Risk Band (High / Elevated / Watch)
* Contributing factors

---

## 🔌 API Highlights

* `POST /api/auth/login` — Authentication
* `GET /api/students` — Student management
* `POST /api/marks` — Add/update marks
* `GET /api/analytics/summary` — Performance insights
* `POST /api/marks/import/csv` — Bulk upload

---

## ⚙️ Setup Instructions

### 1. Clone the repository

```bash
git clone https://github.com/Yamuna052005/Student-Internal-Marks-Management-System.git
cd Student-Internal-Marks-Management-System
```

### 2. Configure environment

```bash
copy .env.example .env
```

Edit `.env`:

```
MONGODB_URI=your_mongodb_url
JWT_SECRET=your_secret
PORT=5000
```

### 3. Install dependencies

```bash
npm install
```

### 4. Run the application

```bash
npm run dev
```

Open:

```
http://localhost:5000
```

---

## 👤 Default Credentials

| Role    | Username | Password   |
| ------- | -------- | ---------- |
| Admin   | admin    | admin123   |
| Faculty | faculty  | faculty123 |
| Student | student  | student123 |

---

## 📥 CSV Import (Strict Mode)

Supports bulk marks upload with validation.

* Normal mode → imports valid rows
* Strict mode → rejects entire file if any row is invalid

---

## 🔐 Security

* Password hashing using bcrypt
* JWT-based authentication
* Role-based authorization middleware

---

<<<<<<< HEAD
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
=======
## 🚧 Future Improvements


* Cloud deployment
* Advanced frontend (React migration)
* Notification system
* Report export (PDF)

<<<<<<< HEAD
- Internal-1 = Mid-1 + Assignment  
- Internal-2 = Mid-2 + Lab / Assignment-2  
- `final = 0.8 * max(i1, i2) + 0.2 * min(i1, i2)`  
- For your college rule, each internal is out of **25**: usually **Mid = 20** and **Assignment / Practical = 5**.  
- **Marks `atRisk` flag** (marks table, filters, dashboard count): **`final < 16`** or **`internal1 < 9`** or **`internal2 < 9`** when marks are entered. Final below 16 is treated as a fail condition. Settings **`riskThreshold`** (default 40) is **not** used for this flag — it is for **analytics / predictive insights** and pass-style views only. Staff **GET /marks** reconciles stored `atRisk` against this rule.  
- **Anomaly** if internal gap spike or large jump vs prior final (see `server/utils/calcMarks.js`).
=======
---

## 📄 License

MIT License
