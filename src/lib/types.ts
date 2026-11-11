export type SchoolRole = "school_admin" | "teacher" | "parent" | "student";
export type AttendanceStatus = "present" | "absent" | "late" | "excused";
export type AssessmentKind = "quiz" | "test" | "assignment" | "midterm" | "final" | "learning_skill" | "learning_exam";

export type School = {
  id: string;
  name: string;
  code: string | null;
  region: string | null;
  city: string | null;
  phone: string | null;
  school_days: 5 | 6;
};

export type AcademicYear = { id: string; school_id: string; name: string; is_current: boolean; starts_on: string | null; ends_on: string | null };
export type Term = { id: string; academic_year_id: string; name: string };

export type SchoolClass = {
  id: string;
  school_id: string;
  academic_year_id: string;
  grade_level: number;
  section: string;
  homeroom_teacher_id: string | null;
};

export type Student = {
  id: string;
  school_id: string;
  student_code: string | null;
  first_name: string;
  father_name: string;
  grandfather_name: string | null;
  gender: "M" | "F" | null;
  date_of_birth: string | null;
  learning_student_id: string | null;
  admission_date: string | null;
  address: string | null;
  previous_school: string | null;
  medical_notes: string | null;
  status: StudentStatus;
  left_on: string | null;
};

export type StudentStatus = "active" | "graduated" | "withdrawn" | "transferred_out";
export type PromotionResult = "promoted" | "repeated" | "graduated";

export type Guardian = { id: string; full_name: string; phone: string | null; relationship: string | null; user_id: string | null };

export type Member = { id: string; user_id: string; role: SchoolRole; full_name: string | null; phone: string | null; email: string | null };

export type EmploymentType = "full_time" | "part_time" | "contract" | "volunteer";

export type StaffProfile = {
  id: string;
  user_id: string;
  employee_id: string | null;
  gender: "M" | "F" | null;
  date_of_birth: string | null;
  qualification: string | null;
  specialization: string | null;
  hire_date: string | null;
  employment_type: EmploymentType;
  address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  notes: string | null;
};

export const employmentLabel: Record<EmploymentType, string> = {
  full_time: "Full time",
  part_time: "Part time",
  contract: "Contract",
  volunteer: "Volunteer",
};

export type StaffAttendanceStatus = "present" | "late" | "absent" | "on_leave";
export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";
export type LeaveType = { id: string; name: string; days_per_year: number | null; paid: boolean };
export type LeaveRequest = {
  id: string;
  user_id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  days: number;
  reason: string | null;
  status: LeaveStatus;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
};

// Mon–Fri between two dates (inclusive) that are not holidays, matching sms.school_working_days.
export function workingDays(from: string, to: string, holidays: Set<string> = new Set()) {
  if (!from || !to || to < from) return 0;
  let n = 0;
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6 && !holidays.has(d.toISOString().slice(0, 10))) n++;
  }
  return n;
}

export type ClassSubject = {
  id: string;
  class_id: string;
  subject_name: string;
  curriculum_grade_id: string | null;
  teacher_id: string | null;
  periods_per_week: number | null;
};

export type Period = { id: string; name: string; starts_at: string; ends_at: string; is_break: boolean };
export type Slot = { id: string; class_id: string; period_id: string; weekday: number; class_subject_id: string; room: string | null };
export type Holiday = { id: string; date: string; name: string };

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const hhmm = (t: string) => t.slice(0, 5);

export type Assessment = {
  id: string;
  class_subject_id: string;
  term_id: string | null;
  title: string;
  kind: AssessmentKind;
  max_score: number;
  weight: number;
  held_on: string | null;
  due_on: string | null;
  skill_id: string | null;
  exam_set_id: string | null;
};

export const roleLabel: Record<SchoolRole, string> = {
  school_admin: "Administrator",
  teacher: "Teacher",
  parent: "Parent",
  student: "Student",
};

export const studentStatusLabel: Record<StudentStatus, string> = {
  active: "Active",
  graduated: "Graduated",
  withdrawn: "Withdrawn",
  transferred_out: "Transferred to another school",
};

export const resultLabel: Record<PromotionResult, string> = {
  promoted: "Promoted",
  repeated: "Repeated",
  graduated: "Graduated",
};

// Suggestion only: below this year average the promotion page proposes repeating.
export const PASS_MARK = 50;

export const className =(c: Pick<SchoolClass, "grade_level" | "section">) =>
  c.grade_level === 0 ? `KG ${c.section}` : `Grade ${c.grade_level}${c.section}`;

export const studentName = (s: Pick<Student, "first_name" | "father_name">) => `${s.first_name} ${s.father_name}`;

export const isLearningKind = (k: AssessmentKind) => k === "learning_skill" || k === "learning_exam";
