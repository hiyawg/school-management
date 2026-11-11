# School Management

A standalone school management app for administrators, teachers and parents. It runs on
**its own Supabase project**, fully separate from the education app
(`../backend-genesis-core-a6c853d9`). Nothing in this app can write to the education project.

## Features (v1)

- Register a school; the creator becomes its administrator
- Academic years and terms with dates; classes (KG–12, sections, capacity; a class with students can't be deleted)
- School subject list (code, periods per week, learning-app link), added to every section of a grade at once
- Syllabus: units and topics per subject and grade, importable from the learning app; lesson plans per class
  and subject, marked taught; coverage per class
- Exams: exam periods, schedule with rooms and invigilators (class, room and invigilator clashes refused),
  gradebook columns created from the schedule, published to families when ready
- Calendar: month view of year and term dates, holidays, exams and school events (events can be staff-only)
- People: add teachers, administrators and parents by email (they need an account in this app first)
- Students: register with guardian (automatic student IDs), edit profiles and guardians, enroll, transfer
  between classes, mark as withdrawn or transferred out
- Student photos and documents (birth certificate, transfer letter, …) in a private Storage bucket; staff and
  the student's guardians can open them
- Admissions: applications, interviews, accept / reject, enroll (creates the student, class and guardian)
- Registrar role: manages students and admissions without administrator rights
- Academic history per student: classes by year, attendance totals, results per subject and term
- Year-end promotion: promote, repeat or graduate students into the next year's classes
- Staff: profiles (employee ID, qualification, hire date, employment type, emergency contact) visible to
  administrators and the person only; teaching load per teacher
- Teachers only take attendance for classes they are homeroom or subject teacher of, and only grade their
  own subjects; administrators can do both everywhere
- Timetable: bell schedule (5 or 6 days, breaks), weekly lessons per class with periods-per-week targets,
  teacher view, today's lessons on the teacher dashboard; the database refuses teacher, room and class clashes
- Holidays: school calendar; holidays are not counted as leave days
- Attendance: daily register per class (present / late / absent / excused)
- Finance (administrators and the Accountant role): fee structures per grade (once / per term / monthly lines),
  billing runs that invoice every enrolled student without duplicates, scholarships and discounts, payments with
  numbered receipts (voided with a reason, never deleted), outstanding balances, printable invoices and receipts,
  expenses and budgets, reports with payroll counted as salaries, CSV exports; families see their own fees
- Performance records: classroom observations and evaluations rated on five criteria, commendations and
  concerns; staff read the ones shared with them and acknowledge or reply
- Payroll: salaries, allowances and deductions, monthly runs with income tax (editable brackets, defaults from
  Proclamation 1395/2025), 7% / 11% pension and unpaid-leave deductions; payslips, bank list and CSV export;
  staff see their own payslips once a month is finalized
- Staff attendance: daily register (present / late / absent / on leave, check-in time) and monthly summary
- Leave: editable leave types (defaults from the Ethiopian Labour Proclamation), requests with working-day
  counts and balances, approval by an administrator, approved days marked on leave automatically
- Gradebook: weighted assessments per subject and term
- Family portal (guardians, and students with their own login): overview, attendance by month, results next
  to the class average, homework with the teacher's marks, fees and receipts, documents, and the child's teachers
- Resource library: folders of files, links and pages per staff member, private unless a folder or item is
  shared with all staff; tagged by subject and grade; attachable to homework, which is how families see them
- "New ▾" menu with everything the signed-in person can create; "Actions ▾" on the student record
- Homework: teachers set it for their subjects and mark each student done / late / missing / excused
- Announcements: whole school, staff only or families (administrators); a class's families (its teachers); pinning
- Messages between families and the child's teachers or the office, with unread counts; administrators can read
  every conversation for safeguarding but only post in their own

## How it relates to the education app

| | Status |
| --- | --- |
| Accounts | Separate. People sign up in each app. |
| Curriculum | Read-only from the education project with its public key: grades, subjects, units, topics, skills, exam sets. Subjects and learning-app assessments store those IDs. |
| Learner link (`sms.students.learning_student_id`) | Column ready; can only be set by `sms.set_learning_link`, which only the service role can call. |
| Importing practice results / showing assignments in the education app | Needs a server-side bridge (Edge Functions in both projects, parent-approved link codes). Not built yet. |

## Setup

1. Create a new project at https://supabase.com/dashboard.
2. In its SQL Editor, run each file in `supabase/migrations/` in order (oldest first).
3. Project Settings → Data API → **Exposed schemas**: add `sms`.
4. Project Settings → API: copy the Project URL and the `anon` public key into `.env`
   as `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (see `.env.example`).
5. `npm install` then `npm run dev` (http://localhost:8081).

## Tests

`npm run test:db` runs the migrations in an in-memory Postgres (PGlite) with a stand-in for a
fresh Supabase project (roles and `auth.users`), then checks access rules.
