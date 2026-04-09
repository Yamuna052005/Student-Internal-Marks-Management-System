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
* Internal 2 = Mid-2 + Lab

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

## 🚧 Future Improvements

* Cloud deployment
* Advanced frontend (React migration)
* Notification system
* Report export (PDF)

---

## 📄 License

MIT License
