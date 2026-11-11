// Usage: npm run test:db
// Runs the sms migrations against in-memory Postgres with a fresh-Supabase stand-in (roles + auth), then checks RLS.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const migrations = process.argv.slice(2).sort().map((f) => readFileSync(f, "utf8"));
const db = new PGlite();

const stubs = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO authenticated; GRANT ALL ON storage.objects TO authenticated;
`;

const U = {
  admin: "00000000-0000-0000-0000-00000000000a",
  teacher: "00000000-0000-0000-0000-00000000000b",
  parent: "00000000-0000-0000-0000-00000000000c",
  stranger: "00000000-0000-0000-0000-00000000000d",
  teacher2: "00000000-0000-0000-0000-00000000000e",
  registrar: "00000000-0000-0000-0000-00000000000f",
  accountant: "00000000-0000-0000-0000-000000000010",
  pupil: "00000000-0000-0000-0000-000000000011",
};

let failures = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
  if (!ok) failures++;
};

async function as(user, sql, params) {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${user}', false); SET ROLE authenticated;`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("RESET ROLE;");
  }
}
async function fails(user, sql, params) {
  try { await as(user, sql, params); return null; } catch (e) { return e.message; }
}

await db.exec(stubs);
for (const m of migrations) await db.exec(m);
console.log(`PASS  ${migrations.length} migrations applied`);

await db.exec(`INSERT INTO auth.users VALUES
  ('${U.admin}', 'admin@school.et'), ('${U.teacher}', 'teacher@school.et'),
  ('${U.parent}', 'parent@mail.et'), ('${U.stranger}', 'other@mail.et'), ('${U.teacher2}', 'teacher2@school.et'), ('${U.registrar}', 'registrar@school.et'), ('${U.accountant}', 'accountant@school.et'), ('${U.pupil}', 'abel@mail.et');`);

const school = (await as(U.admin, "INSERT INTO sms.schools (name) VALUES ('Test School') RETURNING id")).rows[0].id;
const adminRole = await as(U.admin, "SELECT role FROM sms.school_members WHERE school_id = $1", [school]);
check("creator becomes school_admin", adminRole.rows[0]?.role === "school_admin");

check("stranger cannot see school", (await as(U.stranger, "SELECT * FROM sms.schools")).rows.length === 0);
check("stranger cannot add self as member",
  !!(await fails(U.stranger, "INSERT INTO sms.school_members (school_id, user_id, role) VALUES ($1, $2, 'school_admin')", [school, U.stranger])));

await as(U.admin, "SELECT sms.add_member_by_email($1, 'TEACHER@school.et', 'teacher', 'Ato Teacher')", [school]);
await as(U.admin, "SELECT sms.add_member_by_email($1, 'teacher2@school.et', 'teacher', 'Unassigned Teacher')", [school]);
check("teacher added by email sees school", (await as(U.teacher, "SELECT * FROM sms.schools")).rows.length === 1);
check("teacher cannot add members", !!(await fails(U.teacher, "SELECT sms.add_member_by_email($1, 'other@mail.et', 'teacher')", [school])));
check("unknown email gives clear error",
  /No account/.test(await fails(U.admin, "SELECT sms.add_member_by_email($1, 'nobody@x.et', 'teacher')", [school]) ?? ""));

const year = (await as(U.admin, "INSERT INTO sms.academic_years (school_id, name, is_current) VALUES ($1, '2019 E.C.', true) RETURNING id", [school])).rows[0].id;
check("teacher cannot create classes",
  !!(await fails(U.teacher, "INSERT INTO sms.classes (school_id, academic_year_id, grade_level, section) VALUES ($1, $2, 7, 'A')", [school, year])));
const cls = (await as(U.admin, "INSERT INTO sms.classes (school_id, academic_year_id, grade_level, section) VALUES ($1, $2, 7, 'A') RETURNING id", [school, year])).rows[0].id;

const kid = (await as(U.admin, "INSERT INTO sms.students (school_id, first_name, father_name) VALUES ($1, 'Abel', 'Kebede') RETURNING id", [school])).rows[0].id;
const otherKid = (await as(U.admin, "INSERT INTO sms.students (school_id, first_name, father_name) VALUES ($1, 'Sara', 'Tesfaye') RETURNING id", [school])).rows[0].id;
await as(U.admin, "INSERT INTO sms.enrollments (school_id, class_id, student_id) VALUES ($1, $2, $3), ($1, $2, $4)", [school, cls, kid, otherKid]);
await as(U.admin, "SELECT sms.add_guardian($1, 'W/ro Parent', '0911', 'Mother', 'parent@mail.et')", [kid]);

const parentRoles = await as(U.parent, "SELECT role FROM sms.school_members WHERE school_id = $1", [school]);
check("guardian email grants parent role", parentRoles.rows.some((r) => r.role === "parent"));
const parentSees = await as(U.parent, "SELECT id FROM sms.students");
check("parent sees only own child", parentSees.rows.length === 1 && parentSees.rows[0].id === kid);
check("parent cannot write attendance",
  !!(await fails(U.parent, "INSERT INTO sms.attendance (school_id, class_id, student_id, status) VALUES ($1, $2, $3, 'present')", [school, cls, kid])));

check("unassigned teacher cannot take attendance",
  !!(await fails(U.teacher2, "INSERT INTO sms.attendance (school_id, class_id, student_id, status) VALUES ($1, $2, $3, 'present')", [school, cls, kid])));
await as(U.admin, "UPDATE sms.classes SET homeroom_teacher_id = $1 WHERE id = $2", [U.teacher, cls]);
await as(U.teacher, "INSERT INTO sms.attendance (school_id, class_id, student_id, status) VALUES ($1, $2, $3, 'present'), ($1, $2, $4, 'absent')", [school, cls, kid, otherKid]);
check("teacher records attendance; parent sees own child's only",
  (await as(U.parent, "SELECT * FROM sms.attendance")).rows.length === 1);
check("stranger sees no attendance", (await as(U.stranger, "SELECT * FROM sms.attendance")).rows.length === 0);

// Learning link: only the service-role bridge may set it.
const learner = "11111111-1111-1111-1111-111111111111";
check("admin cannot set learning link directly",
  /guardian/.test(await fails(U.admin, "UPDATE sms.students SET learning_student_id = $1 WHERE id = $2", [learner, kid]) ?? ""));
check("signed-in users cannot call set_learning_link",
  !!(await fails(U.parent, "SELECT sms.set_learning_link($1, $2)", [kid, learner])));
await db.exec("SET ROLE service_role;");
await db.query("SELECT sms.set_learning_link($1, $2)", [kid, learner]);
await db.exec("RESET ROLE;");
check("service-role bridge sets learning link",
  (await db.query("SELECT learning_student_id FROM sms.students WHERE id = $1", [kid])).rows[0].learning_student_id === learner);
check("anyone may clear a link (admin unlink)",
  (await fails(U.admin, "UPDATE sms.students SET learning_student_id = NULL WHERE id = $1", [kid])) === null);

const subj = (await as(U.admin, "INSERT INTO sms.class_subjects (school_id, class_id, subject_name, curriculum_grade_id, teacher_id) VALUES ($1, $2, 'Mathematics', gen_random_uuid(), $3) RETURNING id", [school, cls, U.teacher])).rows[0].id;
await as(U.teacher, "INSERT INTO sms.assessments (school_id, class_subject_id, title, kind, skill_id) VALUES ($1, $2, 'Practice angles', 'learning_skill', gen_random_uuid())", [school, subj]);
check("learning_skill without skill rejected",
  !!(await fails(U.teacher, "INSERT INTO sms.assessments (school_id, class_subject_id, title, kind) VALUES ($1, $2, 'x', 'learning_skill')", [school, subj])));
await as(U.teacher, "INSERT INTO sms.scores (school_id, assessment_id, student_id, score) SELECT $1, id, $2, 8 FROM sms.assessments LIMIT 1", [school, kid]);
check("parent sees own child's score only", (await as(U.parent, "SELECT * FROM sms.scores")).rows.length === 1);
check("stranger sees no scores", (await as(U.stranger, "SELECT * FROM sms.scores")).rows.length === 0);

// Teaching assignments control who may enter grades.
check("other teacher cannot create assessments in a subject they don't teach",
  !!(await fails(U.teacher2, "INSERT INTO sms.assessments (school_id, class_subject_id, title) VALUES ($1, $2, 'x')", [school, subj])));
check("other teacher cannot change scores",
  (await as(U.teacher2, "UPDATE sms.scores SET score = 10 RETURNING id")).rows.length === 0);
check("other teacher can still view the class's scores", (await as(U.teacher2, "SELECT * FROM sms.scores")).rows.length === 1);
await as(U.admin, "INSERT INTO sms.class_subjects (school_id, class_id, subject_name, teacher_id) VALUES ($1, $2, 'English', $3)", [school, cls, U.teacher2]);
check("teaching any subject in a class allows attendance",
  (await fails(U.teacher2, "UPDATE sms.attendance SET note = 'checked' WHERE student_id = $1", [kid])) === null);

check("member email is recorded",
  (await as(U.admin, "SELECT email FROM sms.school_members WHERE user_id = $1", [U.teacher])).rows[0].email === "teacher@school.et");

// Staff profiles: administrators manage them; each person sees only their own.
await as(U.admin, "INSERT INTO sms.staff_profiles (school_id, user_id, employee_id, qualification) VALUES ($1, $2, 'T-01', 'BEd'), ($1, $3, 'T-02', 'BA')", [school, U.teacher, U.teacher2]);
const ownProfiles = await as(U.teacher, "SELECT employee_id FROM sms.staff_profiles");
check("teacher sees only own staff profile", ownProfiles.rows.length === 1 && ownProfiles.rows[0].employee_id === "T-01");
check("teacher cannot edit staff profiles",
  (await as(U.teacher, "UPDATE sms.staff_profiles SET notes = 'x' RETURNING id")).rows.length === 0);
check("parent sees no staff profiles", (await as(U.parent, "SELECT * FROM sms.staff_profiles")).rows.length === 0);
check("employee IDs are unique per school",
  !!(await fails(U.admin, "UPDATE sms.staff_profiles SET employee_id = 'T-01' WHERE user_id = $1", [U.teacher2])));

// Staff attendance: administrators keep the register; staff see only their own.
await as(U.admin, "INSERT INTO sms.staff_attendance (school_id, user_id, date, status) VALUES ($1, $2, '2026-11-16', 'absent'), ($1, $3, '2026-11-16', 'present')", [school, U.teacher, U.teacher2]);
check("teacher sees only own staff attendance", (await as(U.teacher, "SELECT * FROM sms.staff_attendance")).rows.length === 1);
check("teacher cannot mark staff attendance",
  !!(await fails(U.teacher, "INSERT INTO sms.staff_attendance (school_id, user_id, date, status) VALUES ($1, $2, '2026-11-17', 'present')", [school, U.teacher])));

// Leave.
const leaveType = async (name) => (await as(U.admin, "SELECT id FROM sms.leave_types WHERE school_id = $1 AND name = $2", [school, name])).rows[0]?.id;
check("new school gets default leave types", !!(await leaveType("Annual")) && !!(await leaveType("Maternity")));
check("parent cannot see leave types", (await as(U.parent, "SELECT * FROM sms.leave_types")).rows.length === 0);
const sick = await leaveType("Sick");
const request = (user, from, to) => as(user,
  "INSERT INTO sms.leave_requests (school_id, leave_type_id, start_date, end_date) VALUES ($1, $2, $3, $4) RETURNING id, days", [school, sick, from, to]);
const req = (await request(U.teacher, "2026-11-16", "2026-11-22")).rows[0];
check("leave counts working days only", Number(req.days) === 5, String(req.days));
check("parent cannot request leave", !!(await fails(U.parent, "INSERT INTO sms.leave_requests (school_id, leave_type_id, start_date, end_date) VALUES ($1, $2, '2026-11-16', '2026-11-16')", [school, sick])));
check("request cannot be inserted already approved",
  !!(await fails(U.teacher, "INSERT INTO sms.leave_requests (school_id, leave_type_id, start_date, end_date, status) VALUES ($1, $2, '2026-12-01', '2026-12-01', 'approved')", [school, sick])));
check("teacher cannot approve own leave", !!(await fails(U.teacher, "SELECT sms.decide_leave($1, true)", [req.id])));
check("teacher cannot edit a request directly",
  !!(await fails(U.teacher, "UPDATE sms.leave_requests SET status = 'approved' WHERE id = $1", [req.id])));
check("other teacher cannot see the request", (await as(U.teacher2, "SELECT * FROM sms.leave_requests")).rows.length === 0);
await as(U.admin, "SELECT sms.decide_leave($1, true, 'Get well')", [req.id]);
const marks = (await as(U.admin, "SELECT date::text, status FROM sms.staff_attendance WHERE user_id = $1 ORDER BY date", [U.teacher])).rows;
check("approval marks working days on leave, replacing absent", marks.length === 5 && marks.every((m) => m.status === "on_leave"), JSON.stringify(marks[0]));
check("decided request cannot be decided again", /already approved/.test(await fails(U.admin, "SELECT sms.decide_leave($1, false)", [req.id]) ?? ""));
check("approved request cannot be cancelled", !!(await fails(U.teacher, "SELECT sms.cancel_leave($1)", [req.id])));
const req2 = (await request(U.teacher, "2026-12-01", "2026-12-02")).rows[0];
check("other teacher cannot cancel someone's request", !!(await fails(U.teacher2, "SELECT sms.cancel_leave($1)", [req2.id])));
await as(U.teacher, "SELECT sms.cancel_leave($1)", [req2.id]);
check("requester cancels a pending request",
  (await as(U.teacher, "SELECT status FROM sms.leave_requests WHERE id = $1", [req2.id])).rows[0].status === "cancelled");

// Timetable: clash checks for teachers, rooms and classes.
const [p1, brk] = (await as(U.admin, "INSERT INTO sms.periods (school_id, name, starts_at, ends_at, is_break) VALUES ($1, 'Period 1', '08:00', '08:40', false), ($1, 'Break', '10:00', '10:20', true) RETURNING id", [school])).rows.map((r) => r.id);
const cls7b = (await as(U.admin, "INSERT INTO sms.classes (school_id, academic_year_id, grade_level, section) VALUES ($1, $2, 7, 'B') RETURNING id", [school, year])).rows[0].id;
const math7b = (await as(U.admin, "INSERT INTO sms.class_subjects (school_id, class_id, subject_name, teacher_id) VALUES ($1, $2, 'Mathematics', $3) RETURNING id", [school, cls7b, U.teacher])).rows[0].id;
const english7a = (await as(U.admin, "SELECT id FROM sms.class_subjects WHERE class_id = $1 AND subject_name = 'English'", [cls])).rows[0].id;
const english7b = (await as(U.admin, "INSERT INTO sms.class_subjects (school_id, class_id, subject_name) VALUES ($1, $2, 'English') RETURNING id", [school, cls7b])).rows[0].id;
const slot = (classId, subjectId, period, room = null, day = 1) => as(U.admin,
  "INSERT INTO sms.timetable_slots (school_id, class_id, period_id, weekday, class_subject_id, room) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
  [school, classId, period, day, subjectId, room]);
const slotFails = (...a) => slot(...a).then(() => null, (e) => e.message);

await slot(cls, subj, p1, "Room 1");
check("class cannot have two lessons at once", !!(await slotFails(cls, english7a, p1)));
check("teacher cannot be in two classes at once", /teacher already has Mathematics in Grade 7A/.test(await slotFails(cls7b, math7b, p1) ?? ""));
check("room cannot be double-booked", /room is already used by Mathematics in Grade 7A/.test(await slotFails(cls7b, english7b, p1, " room 1 ") ?? ""));
check("lesson in a break is rejected", /teaching periods/.test(await slotFails(cls, english7a, brk, null, 3) ?? ""));
check("subject from another class is rejected", /not taught in this class/.test(await slotFails(cls, math7b, p1, null, 4) ?? ""));
await slot(cls7b, math7b, p1, null, 2);
const oldYear = (await as(U.admin, "INSERT INTO sms.academic_years (school_id, name) VALUES ($1, '2018 E.C.') RETURNING id", [school])).rows[0].id;
const old6a = (await as(U.admin, "INSERT INTO sms.classes (school_id, academic_year_id, grade_level, section) VALUES ($1, $2, 6, 'A') RETURNING id", [school, oldYear])).rows[0].id;
const oldMath = (await as(U.admin, "INSERT INTO sms.class_subjects (school_id, class_id, subject_name, teacher_id) VALUES ($1, $2, 'Mathematics', $3) RETURNING id", [school, old6a, U.teacher])).rows[0].id;
check("other years' timetables do not clash", (await slotFails(old6a, oldMath, p1)) === null);
await slot(cls7b, english7b, p1);
check("reassigning a teacher into a clash is rejected",
  /Cannot change the teacher/.test(await fails(U.admin, "UPDATE sms.class_subjects SET teacher_id = $1 WHERE id = $2", [U.teacher, english7b]) ?? ""));
check("teacher cannot edit the timetable",
  !!(await fails(U.teacher, "INSERT INTO sms.timetable_slots (school_id, class_id, period_id, weekday, class_subject_id) VALUES ($1, $2, $3, 5, $4)", [school, cls, p1, subj])));
check("parent can read the timetable", (await as(U.parent, "SELECT * FROM sms.timetable_slots")).rows.length > 0);

// Holidays are not counted as leave days.
await as(U.admin, "INSERT INTO sms.holidays (school_id, date, name) VALUES ($1, '2026-12-03', 'Test holiday')", [school]);
check("holidays are skipped when counting leave", Number((await request(U.teacher, "2026-12-01", "2026-12-04")).rows[0].days) === 3);

// Student IDs: generated when left blank, typed-in IDs kept, taken numbers skipped.
const codeOf = async (id) => (await as(U.admin, "SELECT student_code FROM sms.students WHERE id = $1", [id])).rows[0].student_code;
check("blank student ID is generated", (await codeOf(kid)) === "0001" && (await codeOf(otherKid)) === "0002");
await as(U.admin, "INSERT INTO sms.students (school_id, first_name, father_name, student_code) VALUES ($1, 'Typed', 'Id', '0003')", [school]);
const auto = (await as(U.admin, "INSERT INTO sms.students (school_id, first_name, father_name) VALUES ($1, 'Next', 'One') RETURNING student_code", [school])).rows[0].student_code;
check("generated ID skips a typed-in one", auto === "0004", auto);

check("admin edits a profile",
  (await fails(U.admin, "UPDATE sms.students SET address = 'Bole', medical_notes = 'Asthma' WHERE id = $1", [kid])) === null);
check("teacher cannot edit a profile",
  (await as(U.teacher, "UPDATE sms.students SET address = 'x' WHERE id = $1 RETURNING id", [kid])).rows.length === 0);

// Results and attendance views follow the same access rules as the tables.
check("parent sees own child's results", (await as(U.parent, "SELECT * FROM sms.subject_results")).rows.length === 1);
check("stranger sees no results", (await as(U.stranger, "SELECT * FROM sms.class_results")).rows.length === 0);
check("parent sees own child's attendance summary",
  (await as(U.parent, "SELECT * FROM sms.attendance_summary")).rows.every((r) => r.student_id === kid));

// Year-end promotion.
const year2 = (await as(U.admin, "INSERT INTO sms.academic_years (school_id, name) VALUES ($1, '2020 E.C.') RETURNING id", [school])).rows[0].id;
const [c8a, c8b] = (await as(U.admin, "INSERT INTO sms.classes (school_id, academic_year_id, grade_level, section) VALUES ($1, $2, 8, 'A'), ($1, $2, 8, 'B') RETURNING id", [school, year2])).rows.map((r) => r.id);
const decide = (sid, result, to) => ({ student_id: sid, result, to_class_id: to });
const promote = (user, list) => as(user, "SELECT sms.promote_students($1, $2, $3::jsonb) AS n", [year, year2, JSON.stringify(list)]);

check("teacher cannot promote", !!(await fails(U.teacher, "SELECT sms.promote_students($1, $2, '[]'::jsonb)", [year, year2])));
check("promoting without a class is rejected",
  /class in the new year/.test(await fails(U.admin, "SELECT sms.promote_students($1, $2, $3::jsonb)", [year, year2, JSON.stringify([decide(kid, "promoted", null)])]) ?? ""));
await promote(U.admin, [decide(kid, "promoted", c8a), decide(otherKid, "graduated", null)]);
const activeIn = async (sid) => (await as(U.admin, "SELECT class_id FROM sms.enrollments WHERE student_id = $1 AND status = 'active'", [sid])).rows.map((r) => r.class_id);
check("promoted student is in the new class and keeps the old one", (await activeIn(kid)).sort().join() === [cls, c8a].sort().join());
check("old enrollment records the outcome",
  (await as(U.admin, "SELECT result FROM sms.enrollments WHERE student_id = $1 AND class_id = $2", [kid, cls])).rows[0].result === "promoted");
check("graduate is marked graduated",
  (await as(U.admin, "SELECT status, left_on FROM sms.students WHERE id = $1", [otherKid])).rows[0].status === "graduated");
await promote(U.admin, [decide(kid, "promoted", c8b), decide(otherKid, "repeated", c8a)]);
check("changing a decision moves the student", (await activeIn(kid)).sort().join() === [cls, c8b].sort().join());
check("un-graduating restores active status",
  (await as(U.admin, "SELECT status FROM sms.students WHERE id = $1", [otherKid])).rows[0].status === "active");

// Registrar: manages student records, nothing else.
await as(U.admin, "SELECT sms.add_member_by_email($1, 'registrar@school.et', 'registrar', 'Registrar')", [school]);
const regKid = (await as(U.registrar, "INSERT INTO sms.students (school_id, first_name, father_name) VALUES ($1, 'Reg', 'Istered') RETURNING id", [school])).rows[0].id;
check("registrar registers a student", !!regKid);
check("registrar enrolls and adds a guardian",
  (await fails(U.registrar, "INSERT INTO sms.enrollments (school_id, class_id, student_id) VALUES ($1, $2, $3)", [school, cls, regKid])) === null
  && (await fails(U.registrar, "SELECT sms.add_guardian($1, 'Guardian')", [regKid])) === null);
check("registrar cannot create classes",
  !!(await fails(U.registrar, "INSERT INTO sms.classes (school_id, academic_year_id, grade_level, section) VALUES ($1, $2, 9, 'Z')", [school, year])));
check("registrar cannot take attendance",
  !!(await fails(U.registrar, "INSERT INTO sms.attendance (school_id, class_id, student_id, status) VALUES ($1, $2, $3, 'present')", [school, cls, regKid])));
check("registrar cannot add staff", !!(await fails(U.registrar, "SELECT sms.add_member_by_email($1, 'other@mail.et', 'teacher')", [school])));
check("registrar cannot run promotion", !!(await fails(U.registrar, "SELECT sms.promote_students($1, $2, '[]'::jsonb)", [year, year2])));
check("registrar reads results for transcripts", (await as(U.registrar, "SELECT * FROM sms.scores")).rows.length > 0);
check("teacher cannot register students",
  !!(await fails(U.teacher, "INSERT INTO sms.students (school_id, first_name, father_name) VALUES ($1, 'No', 'Way')", [school])));

// Student files in Storage: <school>/<student>/...
const objectAt = (user, path) => as(user, "INSERT INTO storage.objects (bucket_id, name) VALUES ('student-files', $1)", [path]);
check("student-files bucket exists", (await db.query("SELECT 1 FROM storage.buckets WHERE id = 'student-files'")).rows.length === 1);
await objectAt(U.registrar, `${school}/${kid}/photo`);
await objectAt(U.admin, `${school}/${otherKid}/photo`);
check("teacher cannot upload student files", !!(await fails(U.teacher, "INSERT INTO storage.objects (bucket_id, name) VALUES ('student-files', $1)", [`${school}/${kid}/x`])));
check("malformed path is refused", !!(await fails(U.admin, "INSERT INTO storage.objects (bucket_id, name) VALUES ('student-files', 'not-a-school/photo')")));
check("student in another school's folder is refused",
  !!(await fails(U.admin, "INSERT INTO storage.objects (bucket_id, name) VALUES ('student-files', $1)", [`${U.stranger}/${kid}/photo`])));
const parentFiles = (await as(U.parent, "SELECT name FROM storage.objects")).rows;
check("parent opens only own child's files", parentFiles.length === 1 && parentFiles[0].name.includes(kid));
check("teacher opens student files", (await as(U.teacher, "SELECT * FROM storage.objects")).rows.length === 2);
check("stranger opens no student files", (await as(U.stranger, "SELECT * FROM storage.objects")).rows.length === 0);

// Admissions.
const app = (await as(U.registrar,
  "INSERT INTO sms.admission_applications (school_id, grade_applied, first_name, father_name, guardian_name, guardian_email) VALUES ($1, 7, 'New', 'Comer', 'W/ro Parent', 'parent@mail.et') RETURNING id",
  [school])).rows[0].id;
check("teacher cannot see applications", (await as(U.teacher, "SELECT * FROM sms.admission_applications")).rows.length === 0);
check("parent cannot see applications", (await as(U.parent, "SELECT * FROM sms.admission_applications")).rows.length === 0);
check("status cannot be set to enrolled directly",
  /Use Enroll/.test(await fails(U.registrar, "UPDATE sms.admission_applications SET status = 'enrolled' WHERE id = $1", [app]) ?? ""));
check("only accepted applications are enrolled", /Only accepted/.test(await fails(U.registrar, "SELECT sms.enroll_applicant($1, $2)", [app, cls]) ?? ""));
await as(U.registrar, "UPDATE sms.admission_applications SET status = 'accepted' WHERE id = $1", [app]);
check("teacher cannot enroll", !!(await fails(U.teacher, "SELECT sms.enroll_applicant($1, $2)", [app, cls])));
const newStudent = (await as(U.registrar, "SELECT sms.enroll_applicant($1, $2) AS id", [app, cls])).rows[0].id;
const enrolled = (await as(U.admin, "SELECT s.student_code, (SELECT count(*) FROM sms.enrollments e WHERE e.student_id = s.id AND e.class_id = $2) AS enr FROM sms.students s WHERE s.id = $1", [newStudent, cls])).rows[0];
check("enrolling creates the student with an ID and class", !!enrolled?.student_code && Number(enrolled.enr) === 1, JSON.stringify(enrolled));
check("guardian email links the parent", (await as(U.parent, "SELECT id FROM sms.students WHERE id = $1", [newStudent])).rows.length === 1);
check("application is marked enrolled",
  (await as(U.registrar, "SELECT status, student_id FROM sms.admission_applications WHERE id = $1", [app])).rows[0].student_id === newStudent);
check("enrolled application cannot be reopened",
  !!(await fails(U.registrar, "UPDATE sms.admission_applications SET status = 'accepted' WHERE id = $1", [app])));

// Performance records.
const evalId = (await as(U.admin,
  "INSERT INTO sms.staff_evaluations (school_id, user_id, kind, ratings, strengths) VALUES ($1, $2, 'observation', '{\"planning\": 4, \"delivery\": 5}', 'Clear') RETURNING id, overall",
  [school, U.teacher])).rows[0];
check("overall rating is the average", Number(evalId.overall) === 4.5, String(evalId.overall));
await as(U.admin, "INSERT INTO sms.staff_evaluations (school_id, user_id, kind, shared, notes) VALUES ($1, $2, 'concern', false, 'private')", [school, U.teacher]);
check("rating outside 1–5 is rejected",
  !!(await fails(U.admin, "INSERT INTO sms.staff_evaluations (school_id, user_id, ratings) VALUES ($1, $2, '{\"planning\": 9}')", [school, U.teacher])));
check("teacher sees only records shared with them", (await as(U.teacher, "SELECT * FROM sms.staff_evaluations")).rows.length === 1);
check("other teacher sees none", (await as(U.teacher2, "SELECT * FROM sms.staff_evaluations")).rows.length === 0);
check("teacher cannot change a record",
  (await as(U.teacher, "UPDATE sms.staff_evaluations SET overall = 5 RETURNING id")).rows.length === 0);
await as(U.teacher, "SELECT sms.acknowledge_evaluation($1, 'Thank you')", [evalId.id]);
check("teacher acknowledges and replies",
  (await as(U.admin, "SELECT staff_response, acknowledged_at FROM sms.staff_evaluations WHERE id = $1", [evalId.id])).rows[0].staff_response === "Thank you");
check("other teacher cannot acknowledge it", !!(await fails(U.teacher2, "SELECT sms.acknowledge_evaluation($1)", [evalId.id])));

// Payroll: progressive income tax with the default brackets.
const brackets = (await as(U.admin, "SELECT tax_brackets FROM sms.payroll_settings WHERE school_id = $1", [school])).rows[0]?.tax_brackets;
check("new school gets payroll settings", Array.isArray(brackets) && brackets.length === 6);
const taxOf = async (amount) => Number((await as(U.admin, "SELECT sms.income_tax($1::jsonb, $2) AS t", [JSON.stringify(brackets), amount])).rows[0].t);
check("tax: 1,500 → 0", (await taxOf(1500)) === 0);
check("tax: 3,000 → 150", (await taxOf(3000)) === 150);
check("tax: 10,000 → 1,650", (await taxOf(10000)) === 1650);
check("tax: 20,000 → 4,950", (await taxOf(20000)) === 4950);

// Payroll run for December: salary, allowances, a deduction and approved unpaid leave.
await as(U.admin, "INSERT INTO sms.staff_pay (school_id, user_id, basic_salary, tin) VALUES ($1, $2, 10000, 'TIN-1'), ($1, $3, 8000, null)", [school, U.teacher, U.teacher2]);
await as(U.admin, `INSERT INTO sms.pay_items (school_id, user_id, kind, name, amount, taxable) VALUES
  ($1, $2, 'allowance', 'Transport', 600, false), ($1, $2, 'allowance', 'Position', 1000, true), ($1, $2, 'deduction', 'Loan', 500, true)`, [school, U.teacher]);
check("teacher cannot see others' salaries", (await as(U.teacher, "SELECT * FROM sms.staff_pay")).rows.length === 1);
const unpaid = await leaveType("Unpaid");
const unpaidReq = (await as(U.teacher, "INSERT INTO sms.leave_requests (school_id, leave_type_id, start_date, end_date) VALUES ($1, $2, '2026-12-07', '2026-12-08') RETURNING id", [school, unpaid])).rows[0].id;
await as(U.admin, "SELECT sms.decide_leave($1, true)", [unpaidReq]);
check("teacher cannot run payroll", !!(await fails(U.teacher, "SELECT sms.generate_payroll($1, '2026-12-15')", [school])));
const run = (await as(U.admin, "SELECT sms.generate_payroll($1, '2026-12-15') AS id", [school])).rows[0].id;
const slip = (await as(U.admin, "SELECT * FROM sms.payslips WHERE run_id = $1 AND user_id = $2", [run, U.teacher])).rows[0];
const wd = Number((await as(U.admin, "SELECT sms.school_working_days($1, '2026-12-01', '2026-12-31') AS n", [school])).rows[0].n);
const ded = Math.round((10000 / wd) * 2 * 100) / 100;
const earned = 10000 - ded;
const expectTax = await taxOf(earned + 1000);
const expectPension = Math.round(earned * 0.07 * 100) / 100;
const near = (a, b) => Math.abs(Number(a) - b) < 0.011;
check("unpaid leave is deducted pro rata", slip.unpaid_leave_days === 2 && near(slip.unpaid_leave_deduction, ded), `${slip.unpaid_leave_days} days, ${slip.unpaid_leave_deduction}`);
check("taxable income excludes non-taxable allowances", near(slip.taxable_income, earned + 1000) && near(slip.income_tax, expectTax));
check("pension is 7% of earned basic, 11% employer", near(slip.pension_employee, expectPension) && near(slip.pension_employer, Math.round(earned * 0.11 * 100) / 100));
check("net pay adds up", near(slip.net_pay, earned + 1600 - expectTax - expectPension - 500), String(slip.net_pay));
check("teacher cannot see a draft payslip", (await as(U.teacher, "SELECT * FROM sms.payslips")).rows.length === 0);
await as(U.admin, "SELECT sms.finalize_payroll($1)", [run]);
const ownSlips = (await as(U.teacher, "SELECT user_id FROM sms.payslips")).rows;
check("after finalizing, staff see only their own payslip", ownSlips.length === 1 && ownSlips[0].user_id === U.teacher);
check("finalized payroll cannot be regenerated", /finalized/.test(await fails(U.admin, "SELECT sms.generate_payroll($1, '2026-12-01')", [school]) ?? ""));
check("finalized run cannot be deleted",
  (await as(U.admin, "DELETE FROM sms.payroll_runs WHERE id = $1 RETURNING id", [run])).rows.length === 0);

// Classes: capacity and safe deletion.
check("class with students cannot be deleted", /has students/.test(await fails(U.admin, "DELETE FROM sms.classes WHERE id = $1", [cls]) ?? ""));
const small = (await as(U.admin, "INSERT INTO sms.classes (school_id, academic_year_id, grade_level, section, capacity) VALUES ($1, $2, 3, 'A', 1) RETURNING id", [school, year])).rows[0].id;
await as(U.admin, "INSERT INTO sms.enrollments (school_id, class_id, student_id) VALUES ($1, $2, $3)", [school, small, regKid]);
check("full class refuses another student",
  /class is full/.test(await fails(U.admin, "INSERT INTO sms.enrollments (school_id, class_id, student_id) VALUES ($1, $2, $3)", [school, small, newStudent]) ?? ""));
await as(U.admin, "UPDATE sms.enrollments SET status = 'transferred' WHERE class_id = $1", [small]);
check("empty class can be deleted", (await fails(U.admin, "DELETE FROM sms.classes WHERE id = $1", [small])) === null);

// Subject list: existing class subjects were turned into the list.
const mathSubject = (await as(U.admin, "SELECT id FROM sms.subjects WHERE school_id = $1 AND name = 'Mathematics'", [school])).rows[0]?.id;
check("existing subjects form the school list", !!mathSubject);
check("class subjects are linked to the list",
  (await as(U.admin, "SELECT subject_id FROM sms.class_subjects WHERE id = $1", [subj])).rows[0].subject_id === mathSubject);
check("duplicate subject names are refused",
  !!(await fails(U.admin, "INSERT INTO sms.subjects (school_id, name) VALUES ($1, 'mathematics')", [school])));
check("teacher cannot edit the subject list", !!(await fails(U.teacher, "INSERT INTO sms.subjects (school_id, name) VALUES ($1, 'Art')", [school])));

// Syllabus: the subject's teacher at that grade may edit it.
const unit7 = (await as(U.teacher, "INSERT INTO sms.syllabus_units (school_id, subject_id, grade_level, title) VALUES ($1, $2, 7, 'Unit 1: Integers') RETURNING id", [school, mathSubject])).rows[0].id;
check("subject teacher writes the syllabus for their grade", !!unit7);
check("teacher cannot write another grade's syllabus",
  !!(await fails(U.teacher, "INSERT INTO sms.syllabus_units (school_id, subject_id, grade_level, title) VALUES ($1, $2, 11, 'x')", [school, mathSubject])));
check("other teacher cannot write this syllabus",
  !!(await fails(U.teacher2, "INSERT INTO sms.syllabus_topics (school_id, unit_id, title) VALUES ($1, $2, 'x')", [school, unit7])));
const [t1, t2] = (await as(U.teacher, "INSERT INTO sms.syllabus_topics (school_id, unit_id, position, title) VALUES ($1, $2, 1, 'Adding'), ($1, $2, 2, 'Subtracting') RETURNING id", [school, unit7])).rows.map((r) => r.id);
check("parent can read the syllabus", (await as(U.parent, "SELECT * FROM sms.syllabus_topics")).rows.length === 2);

// Lesson plans and coverage.
await as(U.teacher, "INSERT INTO sms.lesson_plans (school_id, class_subject_id, topic_id, title, status, taught_on) VALUES ($1, $2, $3, 'Adding integers', 'taught', '2026-11-10')", [school, subj, t1]);
await as(U.teacher, "INSERT INTO sms.lesson_plans (school_id, class_subject_id, topic_id, title) VALUES ($1, $2, $3, 'Subtracting')", [school, subj, t2]);
check("taught lesson needs a date",
  !!(await fails(U.teacher, "INSERT INTO sms.lesson_plans (school_id, class_subject_id, title, status) VALUES ($1, $2, 'x', 'taught')", [school, subj])));
check("other teacher cannot plan this subject's lessons",
  !!(await fails(U.teacher2, "INSERT INTO sms.lesson_plans (school_id, class_subject_id, title) VALUES ($1, $2, 'x')", [school, subj])));
check("parent cannot see lesson plans", (await as(U.parent, "SELECT * FROM sms.lesson_plans")).rows.length === 0);
const cov = (await as(U.admin, "SELECT topics, topics_taught FROM sms.syllabus_coverage WHERE class_subject_id = $1", [subj])).rows[0];
check("coverage counts topics taught", Number(cov.topics) === 2 && Number(cov.topics_taught) === 1, JSON.stringify(cov));

// Exam schedules.
const examPeriod = (await as(U.admin, "INSERT INTO sms.exam_periods (school_id, academic_year_id, name, starts_on, ends_on) VALUES ($1, $2, 'Finals', '2027-01-11', '2027-01-15') RETURNING id", [school, year])).rows[0].id;
const sitting = (user, classId, subjectId, date, from, to, room = null) => as(user,
  "INSERT INTO sms.exam_sittings (school_id, exam_period_id, class_id, class_subject_id, date, starts_at, ends_at, room) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
  [school, examPeriod, classId, subjectId, date, from, to, room]);
const sittingFails = (...a) => sitting(U.admin, ...a).then(() => null, (e) => e.message);
const mathExam = (await sitting(U.admin, cls, subj, "2027-01-11", "08:30", "10:30", "Hall")).rows[0].id;
check("exam outside the period is refused", /within Finals/.test(await sittingFails(cls, english7a, "2027-02-01", "08:30", "10:00") ?? ""));
check("class cannot sit two exams at once", /class already has Mathematics/.test(await sittingFails(cls, english7a, "2027-01-11", "10:00", "11:00") ?? ""));
check("exam room cannot be double-booked", /room is already used/.test(await sittingFails(cls7b, math7b, "2027-01-11", "09:00", "10:00", "hall") ?? ""));
const english7bExam = (await sitting(U.admin, cls7b, english7b, "2027-01-11", "09:00", "10:00", "Room 2")).rows[0].id;
await as(U.admin, "INSERT INTO sms.exam_invigilators (sitting_id, user_id) VALUES ($1, $2)", [mathExam, U.teacher2]);
check("invigilator cannot supervise two exams at once",
  /invigilator is already supervising/.test(await fails(U.admin, "INSERT INTO sms.exam_invigilators (sitting_id, user_id) VALUES ($1, $2)", [english7bExam, U.teacher2]) ?? ""));
check("parent cannot be an invigilator", !!(await fails(U.admin, "INSERT INTO sms.exam_invigilators (sitting_id, user_id) VALUES ($1, $2)", [english7bExam, U.parent])));
await as(U.admin, "INSERT INTO sms.exam_invigilators (sitting_id, user_id) VALUES ($1, $2)", [english7bExam, U.teacher]);
const laterExam = (await sitting(U.admin, old6a, oldMath, "2027-01-12", "12:00", "13:00")).rows[0].id;
await as(U.admin, "INSERT INTO sms.exam_invigilators (sitting_id, user_id) VALUES ($1, $2)", [laterExam, U.teacher]);
check("moving an exam onto its invigilator's other exam is refused",
  /^This invigilator is already supervising English \(Grade 7B\) from 09:00 to 10:00$/.test(await fails(U.admin, "UPDATE sms.exam_sittings SET date = '2027-01-11', starts_at = '09:30', ends_at = '10:30' WHERE id = $1", [laterExam]) ?? ""));
check("parent cannot see an unpublished schedule", (await as(U.parent, "SELECT * FROM sms.exam_sittings")).rows.length === 0);
await as(U.admin, "UPDATE sms.exam_periods SET published = true WHERE id = $1", [examPeriod]);
check("parent sees a published schedule", (await as(U.parent, "SELECT * FROM sms.exam_sittings")).rows.length === 3);
check("teacher cannot edit exams", (await as(U.teacher, "UPDATE sms.exam_sittings SET room = 'x' WHERE id = $1 RETURNING id", [mathExam])).rows.length === 0);

// Calendar events by audience.
await as(U.admin, "INSERT INTO sms.school_events (school_id, title, starts_on, ends_on, audience) VALUES ($1, 'Parents day', '2026-12-12', '2026-12-12', 'everyone'), ($1, 'Staff meeting', '2026-12-14', '2026-12-14', 'staff')", [school]);
check("parent sees only events for everyone", (await as(U.parent, "SELECT title FROM sms.school_events")).rows.map((r) => r.title).join() === "Parents day");
check("teacher sees staff events too", (await as(U.teacher, "SELECT * FROM sms.school_events")).rows.length === 2);

// Finance.
await as(U.admin, "SELECT sms.add_member_by_email($1, 'accountant@school.et', 'accountant', 'Accountant')", [school]);
const structure = (await as(U.accountant, "INSERT INTO sms.fee_structures (school_id, academic_year_id, grade_level, name) VALUES ($1, $2, 7, 'Grade 7') RETURNING id", [school, year])).rows[0].id;
await as(U.accountant, `INSERT INTO sms.fee_items (school_id, structure_id, name, kind, frequency, amount) VALUES
  ($1, $2, 'Registration', 'registration', 'once', 500), ($1, $2, 'Tuition', 'tuition', 'monthly', 2000), ($1, $2, 'Transport', 'other', 'monthly', 300)`, [school, structure]);
check("teacher cannot edit fees", !!(await fails(U.teacher, "INSERT INTO sms.fee_items (school_id, structure_id, name, amount) VALUES ($1, $2, 'x', 1)", [school, structure])));
check("parent can read the fee structure", (await as(U.parent, "SELECT * FROM sms.fee_items")).rows.length === 3);
await as(U.accountant, "INSERT INTO sms.student_discounts (school_id, student_id, academic_year_id, name, kind, value) VALUES ($1, $2, $3, 'Sibling', 'percent', 10)", [school, kid, year]);
await as(U.accountant, "INSERT INTO sms.student_discounts (school_id, student_id, academic_year_id, name, kind, value, applies_to) VALUES ($1, $2, $3, 'Full scholarship', 'fixed', 99999, 'all')", [school, otherKid, year]);
check("percent discount over 100 is refused",
  !!(await fails(U.accountant, "INSERT INTO sms.student_discounts (school_id, student_id, academic_year_id, name, kind, value) VALUES ($1, $2, $3, 'x', 'percent', 150)", [school, kid, year])));

const billMonth = (user, key = "2026-11") => as(user, "SELECT sms.generate_invoices($1, 'monthly', $2, 'Tuition · November', '2026-11-30') AS n", [year, key]);
check("teacher cannot create invoices", !!(await fails(U.teacher, "SELECT sms.generate_invoices($1, 'monthly', '2026-11', 'x', null)", [year])));
const enrolledNow = Number((await db.query("SELECT count(DISTINCT e.student_id) AS n FROM sms.enrollments e JOIN sms.classes c ON c.id = e.class_id JOIN sms.students s ON s.id = e.student_id WHERE c.academic_year_id = $1 AND e.status = 'active' AND s.status = 'active'", [year])).rows[0].n);
const firstRun = Number((await billMonth(U.accountant)).rows[0].n);
check("billing run invoices every enrolled student", firstRun === enrolledNow && firstRun > 0, `${firstRun} of ${enrolledNow}`);
check("running it again creates nothing", Number((await billMonth(U.accountant)).rows[0].n) === 0);
const bal = async (sid, key) => (await as(U.accountant, "SELECT * FROM sms.invoice_balances b JOIN sms.invoices i ON i.id = b.invoice_id WHERE b.student_id = $1 AND i.period_key = $2", [sid, key])).rows[0];
const kidNov = await bal(kid, "2026-11");
check("discount applies to tuition only", Number(kidNov.total) === 2100, String(kidNov.total));
check("invoice is numbered", /^INV-\d{4}$/.test(kidNov.number), kidNov.number);
check("full scholarship never goes below zero", Number((await bal(otherKid, "2026-11")).total) === 0);
await as(U.accountant, "SELECT sms.generate_invoices($1, 'once', 'registration', 'Registration', null)", [year]);
check("one-off fee is billed once", Number((await bal(kid, "registration")).total) === 500);
check("one-off fee is not billed again under another name",
  Number((await as(U.accountant, "SELECT sms.generate_invoices($1, 'once', 'registration-again', 'x', null) AS n", [year])).rows[0].n) === 0);

const pay = (user, invoiceId, sid, amount) => as(user,
  "INSERT INTO sms.payments (school_id, invoice_id, student_id, amount, method) VALUES ($1, $2, $3, $4, 'telebirr') RETURNING receipt_number", [school, invoiceId, sid, amount]);
const receipt = (await pay(U.accountant, kidNov.invoice_id, kid, 1000)).rows[0].receipt_number;
check("payment gets a receipt number", /^RCP-\d{4}$/.test(receipt), receipt);
check("overpaying is refused", /more than the 1,100.00 still owed/.test(await fails(U.accountant,
  "INSERT INTO sms.payments (school_id, invoice_id, student_id, amount) VALUES ($1, $2, $3, 2000)", [school, kidNov.invoice_id, kid]) ?? ""));
const after = await bal(kid, "2026-11");
check("balance and state follow payments", Number(after.balance) === 1100 && after.state === "partial", `${after.balance} ${after.state}`);
check("teacher cannot record payments", !!(await fails(U.teacher,
  "INSERT INTO sms.payments (school_id, invoice_id, student_id, amount) VALUES ($1, $2, $3, 1)", [school, kidNov.invoice_id, kid])));
check("payments cannot be edited", !!(await fails(U.accountant, "UPDATE sms.payments SET amount = 1 WHERE receipt_number = $1", [receipt])));
check("invoice lines are locked once paid",
  /has payments/.test(await fails(U.accountant, "INSERT INTO sms.invoice_lines (school_id, invoice_id, description, amount) VALUES ($1, $2, 'Fine', 50)", [school, kidNov.invoice_id]) ?? ""));
check("invoice with payments cannot be voided", /void them first/.test(await fails(U.accountant, "SELECT sms.void_invoice($1, 'mistake')", [kidNov.invoice_id]) ?? ""));
check("voiding needs a reason", /reason/.test(await fails(U.accountant, "SELECT sms.void_payment(id, ' ') FROM sms.payments WHERE receipt_number = $1", [receipt]) ?? ""));
await as(U.accountant, "SELECT sms.void_payment(id, 'Wrong student') FROM sms.payments WHERE receipt_number = $1", [receipt]);
check("voided payment no longer counts", Number((await bal(kid, "2026-11")).balance) === 2100);
await as(U.accountant, "SELECT sms.void_invoice($1, 'Billed twice')", [kidNov.invoice_id]);
check("void invoice can be billed again", Number((await billMonth(U.accountant)).rows[0].n) === 1);

const parentInvoices = (await as(U.parent, "SELECT DISTINCT student_id FROM sms.invoices")).rows.map((r) => r.student_id);
const parentKids = (await as(U.parent, "SELECT student_id FROM sms.guardians WHERE user_id = $1", [U.parent])).rows.map((r) => r.student_id);
check("parent sees only their children's invoices", parentInvoices.length > 0 && parentInvoices.every((id) => parentKids.includes(id)));
check("parent sees their payments", (await as(U.parent, "SELECT * FROM sms.payments")).rows.every((r) => parentKids.includes(r.student_id)));
check("teacher sees no invoices", (await as(U.teacher, "SELECT * FROM sms.invoices")).rows.length === 0);

await as(U.accountant, "INSERT INTO sms.budget_lines (school_id, academic_year_id, category, amount) VALUES ($1, $2, 'Utilities', 20000)", [school, year]);
await as(U.accountant, "INSERT INTO sms.expenses (school_id, academic_year_id, category, description, amount) VALUES ($1, $2, 'Utilities', 'Electricity', 1800)", [school, year]);
check("teacher sees no expenses", (await as(U.teacher, "SELECT * FROM sms.expenses")).rows.length === 0);
const payroll = (await as(U.accountant, "SELECT * FROM sms.payroll_totals($1, '2026-12-01', '2026-12-31')", [school])).rows;
check("accountant sees finalized payroll totals", payroll.length === 1 && Number(payroll[0].total_cost) > 0);
check("accountant cannot read individual payslips", (await as(U.accountant, "SELECT * FROM sms.payslips")).rows.length === 0);
check("teacher cannot see payroll totals", !!(await fails(U.teacher, "SELECT * FROM sms.payroll_totals($1, '2026-01-01', '2027-12-31')", [school])));
check("accountant cannot run payroll", !!(await fails(U.accountant, "SELECT sms.generate_payroll($1, '2027-01-01')", [school])));

// Portal: student accounts.
check("unknown student email is refused", /No account/.test(await fails(U.registrar, "SELECT sms.link_student_account($1, 'nobody@x.et')", [kid]) ?? ""));
await as(U.registrar, "SELECT sms.link_student_account($1, 'abel@mail.et')", [kid]);
check("student sees only their own record", (await as(U.pupil, "SELECT id FROM sms.students")).rows.map((r) => r.id).join() === kid);
check("student sees their own scores", (await as(U.pupil, "SELECT * FROM sms.scores")).rows.every((r) => r.student_id === kid));
check("an account links to one student only", /already linked/.test(await fails(U.registrar, "SELECT sms.link_student_account($1, 'abel@mail.et')", [otherKid]) ?? ""));
check("teacher cannot link student accounts", !!(await fails(U.teacher, "SELECT sms.link_student_account($1, 'abel@mail.et')", [kid])));

// Homework.
const hw = (await as(U.teacher, "INSERT INTO sms.homework (school_id, class_subject_id, title, due_on) VALUES ($1, $2, 'Exercise 3.1', current_date + 3) RETURNING id", [school, subj])).rows[0].id;
check("other teacher cannot set homework in this subject",
  !!(await fails(U.teacher2, "INSERT INTO sms.homework (school_id, class_subject_id, title) VALUES ($1, $2, 'x')", [school, subj])));
check("family of the class sees the homework", (await as(U.parent, "SELECT id FROM sms.homework")).rows.some((r) => r.id === hw));
check("student sees the homework", (await as(U.pupil, "SELECT id FROM sms.homework")).rows.some((r) => r.id === hw));
check("stranger sees no homework", (await as(U.stranger, "SELECT * FROM sms.homework")).rows.length === 0);
await as(U.teacher, "INSERT INTO sms.homework_status (homework_id, student_id, school_id, status) VALUES ($1, $2, $3, 'done'), ($1, $4, $3, 'missing')", [hw, kid, school, otherKid]);
check("parent sees only their child's homework status", (await as(U.parent, "SELECT student_id FROM sms.homework_status")).rows.every((r) => r.student_id !== otherKid));
check("parent cannot mark homework",
  (await as(U.parent, "UPDATE sms.homework_status SET status = 'excused' WHERE student_id = $1 RETURNING student_id", [kid])).rows.length === 0);

// Announcements.
const post = (user, title, audience, classId = null) => as(user,
  "INSERT INTO sms.announcements (school_id, title, body, audience, class_id) VALUES ($1, $2, 'Body', $3, $4) RETURNING id", [school, title, audience, classId]);
await post(U.admin, "Welcome back", "everyone");
await post(U.admin, "Staff meeting", "staff");
await post(U.admin, "Parents evening", "families");
await post(U.teacher, "7A trip", "families", cls);
check("teacher cannot post school-wide", !!(await fails(U.teacher, "INSERT INTO sms.announcements (school_id, title, body) VALUES ($1, 'x', 'y')", [school])));
check("teacher cannot post to a class they don't teach",
  !!(await fails(U.teacher, "INSERT INTO sms.announcements (school_id, title, body, audience, class_id) VALUES ($1, 'x', 'y', 'families', $2)", [school, c8a])));
const titles = async (user) => (await as(user, "SELECT title FROM sms.announcements ORDER BY title")).rows.map((r) => r.title).join("|");
check("parent sees everyone, family and class posts, not staff ones", (await titles(U.parent)) === "7A trip|Parents evening|Welcome back", await titles(U.parent));
check("teacher sees every post", (await titles(U.teacher2)).split("|").length === 4);
check("stranger sees no posts", (await titles(U.stranger)) === "");

// Messaging.
check("family can't write to staff unrelated to the child",
  !!(await fails(U.parent, "INSERT INTO sms.conversations (school_id, student_id, staff_user_id, subject) VALUES ($1, $2, $3, 'x')", [school, kid, U.registrar])));
const convo = (await as(U.parent, "INSERT INTO sms.conversations (school_id, student_id, staff_user_id, subject) VALUES ($1, $2, $3, 'Homework question') RETURNING id", [school, kid, U.teacher])).rows[0].id;
await as(U.parent, "INSERT INTO sms.messages (school_id, conversation_id, body) VALUES ($1, $2, 'Is exercise 3.1 due Friday?')", [school, convo]);
await as(U.teacher, "INSERT INTO sms.messages (school_id, conversation_id, body) VALUES ($1, $2, 'Yes, Friday.')", [school, convo]);
const inbox = async (user) => (await as(user, "SELECT * FROM sms.my_inbox($1)", [school])).rows;
const parentInbox = await inbox(U.parent);
check("inbox shows the teacher's name and one unread reply", parentInbox.length === 1 && parentInbox[0].staff_name === "Ato Teacher" && parentInbox[0].unread === 1, JSON.stringify(parentInbox[0]));
await as(U.parent, "INSERT INTO sms.conversation_reads (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT (conversation_id, user_id) DO UPDATE SET last_read_at = now()", [convo, U.parent]);
check("reading clears the unread count", (await inbox(U.parent))[0].unread === 0);
check("the student is in their own family's conversation", (await as(U.pupil, "SELECT * FROM sms.messages WHERE conversation_id = $1", [convo])).rows.length === 2);
check("stranger cannot read the conversation", (await as(U.stranger, "SELECT * FROM sms.messages")).rows.length === 0);
check("other teacher cannot read it", (await as(U.teacher2, "SELECT * FROM sms.messages WHERE conversation_id = $1", [convo])).rows.length === 0);
check("administrator can read it for safeguarding", (await as(U.admin, "SELECT * FROM sms.messages WHERE conversation_id = $1", [convo])).rows.length === 2);
check("administrator cannot post in someone else's conversation",
  !!(await fails(U.admin, "INSERT INTO sms.messages (school_id, conversation_id, body) VALUES ($1, $2, 'x')", [school, convo])));
check("messages cannot be edited", !!(await fails(U.parent, "UPDATE sms.messages SET body = 'changed' WHERE conversation_id = $1", [convo])));
const people = (await as(U.parent, "SELECT name FROM sms.conversation_people($1) ORDER BY name", [convo])).rows.map((r) => r.name).join("|");
check("message authors have names", people === "Ato Teacher|W/ro Parent", people);
const contacts = (await as(U.parent, "SELECT * FROM sms.student_contacts($1)", [kid])).rows;
check("contacts list the child's teachers and administration",
  contacts.some((c) => c.user_id === U.teacher) && contacts.some((c) => c.role.includes("School administration")) && !contacts.some((c) => c.user_id === U.registrar));
check("stranger gets no contacts", (await as(U.stranger, "SELECT * FROM sms.student_contacts($1)", [kid])).rows.length === 0);

// Results next to the class average, without other children's marks.
const vs = (await as(U.parent, "SELECT * FROM sms.student_vs_class($1)", [kid])).rows;
check("parent sees their child's totals with the class average", vs.length > 0 && vs.every((r) => r.class_average !== null));
check("stranger gets no class comparison", (await as(U.stranger, "SELECT * FROM sms.student_vs_class($1)", [kid])).rows.length === 0);

const paidInv = (await bal(newStudent, "2026-11"));
await pay(U.accountant, paidInv.invoice_id, newStudent, 100);
check("deleting a student with invoices and payments works",
  (await fails(U.admin, "DELETE FROM sms.students WHERE id = $1", [newStudent])) === null);

// Deleting accounts must never be blocked by school data.
try {
  await db.exec(`DELETE FROM auth.users WHERE id IN ('${U.admin}', '${U.teacher}', '${U.parent}', '${U.teacher2}', '${U.registrar}', '${U.accountant}', '${U.pupil}');`);
  const left = await db.query("SELECT created_by FROM sms.schools WHERE id = $1", [school]);
  check("deleting user accounts is never blocked", left.rows[0].created_by === null);
} catch (e) {
  check("deleting user accounts is never blocked", false, e.message);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
