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
`;

const U = {
  admin: "00000000-0000-0000-0000-00000000000a",
  teacher: "00000000-0000-0000-0000-00000000000b",
  parent: "00000000-0000-0000-0000-00000000000c",
  stranger: "00000000-0000-0000-0000-00000000000d",
  teacher2: "00000000-0000-0000-0000-00000000000e",
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
  ('${U.parent}', 'parent@mail.et'), ('${U.stranger}', 'other@mail.et'), ('${U.teacher2}', 'teacher2@school.et');`);

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

// Deleting accounts must never be blocked by school data.
try {
  await db.exec(`DELETE FROM auth.users WHERE id IN ('${U.admin}', '${U.teacher}', '${U.parent}', '${U.teacher2}');`);
  const left = await db.query("SELECT created_by FROM sms.schools WHERE id = $1", [school]);
  check("deleting user accounts is never blocked", left.rows[0].created_by === null);
} catch (e) {
  check("deleting user accounts is never blocked", false, e.message);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
