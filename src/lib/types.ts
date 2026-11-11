export type SchoolRole = "school_admin" | "teacher" | "registrar" | "accountant" | "parent" | "student";
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
export type Term = { id: string; academic_year_id: string; name: string; starts_on: string | null; ends_on: string | null };

export type SchoolClass = {
  id: string;
  school_id: string;
  academic_year_id: string;
  grade_level: number;
  section: string;
  homeroom_teacher_id: string | null;
  capacity: number | null;
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
  photo_path: string | null;
};

export type DocumentKind = "birth_certificate" | "transfer_letter" | "report_card" | "medical" | "id_document" | "photo_id" | "other";
export const documentKindLabel: Record<DocumentKind, string> = {
  birth_certificate: "Birth certificate",
  transfer_letter: "Transfer letter",
  report_card: "Previous report card",
  medical: "Medical record",
  id_document: "ID / Kebele ID",
  photo_id: "Passport photo",
  other: "Other",
};
export type StudentDocument = { id: string; student_id: string; kind: DocumentKind; name: string; path: string; size_bytes: number | null; created_at: string };

export type AdmissionStatus = "applied" | "interview" | "accepted" | "rejected" | "withdrawn" | "enrolled";
export const admissionStatusLabel: Record<AdmissionStatus, string> = {
  applied: "Applied",
  interview: "Interview",
  accepted: "Accepted",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  enrolled: "Enrolled",
};
export type Application = {
  id: string;
  academic_year_id: string | null;
  grade_applied: number;
  first_name: string;
  father_name: string;
  grandfather_name: string | null;
  gender: "M" | "F" | null;
  date_of_birth: string | null;
  previous_school: string | null;
  address: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  guardian_relationship: string | null;
  guardian_email: string | null;
  notes: string | null;
  status: AdmissionStatus;
  interview_on: string | null;
  decision_note: string | null;
  student_id: string | null;
  created_at: string;
};

export type EvaluationKind = "observation" | "evaluation" | "commendation" | "concern";
export const evaluationKindLabel: Record<EvaluationKind, string> = {
  observation: "Classroom observation",
  evaluation: "Performance evaluation",
  commendation: "Commendation",
  concern: "Concern",
};
// Criteria rated 1–5. Stored by key, so labels can change without touching old records.
export const EVALUATION_CRITERIA: { key: string; label: string }[] = [
  { key: "planning", label: "Lesson planning" },
  { key: "delivery", label: "Teaching delivery" },
  { key: "management", label: "Classroom management" },
  { key: "assessment", label: "Assessment and feedback" },
  { key: "professionalism", label: "Professionalism" },
];
export type Evaluation = {
  id: string;
  user_id: string;
  kind: EvaluationKind;
  date: string;
  class_subject_id: string | null;
  ratings: Record<string, number>;
  overall: number | null;
  strengths: string | null;
  improvements: string | null;
  notes: string | null;
  shared: boolean;
  acknowledged_at: string | null;
  staff_response: string | null;
};

export type TaxBracket = { up_to: number | null; rate: number };
export type PayrollSettings = { school_id: string; employee_pension_rate: number; employer_pension_rate: number; tax_brackets: TaxBracket[] };
export type StaffPay = { id: string; user_id: string; basic_salary: number; pension: boolean; tin: string | null; bank_name: string | null; bank_account: string | null };
export type PayItem = { id: string; user_id: string; kind: "allowance" | "deduction"; name: string; amount: number; taxable: boolean };
export type PayrollRun = { id: string; period: string; status: "draft" | "finalized"; working_days: number | null; finalized_at: string | null };
export type Payslip = {
  id: string;
  run_id: string;
  user_id: string;
  full_name: string | null;
  tin: string | null;
  bank_name: string | null;
  bank_account: string | null;
  basic_salary: number;
  unpaid_leave_days: number;
  unpaid_leave_deduction: number;
  earned_basic: number;
  allowances: { name: string; amount: number; taxable: boolean }[];
  taxable_allowances: number;
  non_taxable_allowances: number;
  gross_pay: number;
  taxable_income: number;
  income_tax: number;
  pension_employee: number;
  pension_employer: number;
  deductions: { name: string; amount: number }[];
  other_deductions: number;
  net_pay: number;
};

export const birr = (n: number | string | null | undefined) =>
  n === null || n === undefined ? "—" : Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
  subject_id: string | null;
};

export type Subject = { id: string; name: string; code: string | null; default_periods_per_week: number | null; curriculum_subject_id: string | null };
export type SyllabusUnit = { id: string; subject_id: string; grade_level: number; position: number; title: string; description: string | null; curriculum_unit_id: string | null };
export type SyllabusTopic = { id: string; unit_id: string; position: number; title: string; planned_periods: number | null; curriculum_topic_id: string | null };
export type LessonStatus = "planned" | "taught" | "skipped";
export type LessonPlan = {
  id: string;
  class_subject_id: string;
  topic_id: string | null;
  planned_on: string | null;
  title: string;
  objectives: string | null;
  activities: string | null;
  homework: string | null;
  status: LessonStatus;
  taught_on: string | null;
  notes: string | null;
};
export type ExamKind = "midterm" | "final" | "mock" | "other";
export const examKindLabel: Record<ExamKind, string> = { midterm: "Mid-term", final: "Final", mock: "Mock / national practice", other: "Other" };
export type ExamPeriod = { id: string; academic_year_id: string; term_id: string | null; name: string; kind: ExamKind; starts_on: string; ends_on: string; published: boolean };
export type ExamSitting = {
  id: string;
  exam_period_id: string;
  class_id: string;
  class_subject_id: string;
  date: string;
  starts_at: string;
  ends_at: string;
  room: string | null;
  assessment_id: string | null;
  notes: string | null;
};
export type EventKind = "event" | "meeting" | "deadline" | "other";
export type SchoolEvent = { id: string; title: string; kind: EventKind; starts_on: string; ends_on: string; audience: "everyone" | "staff"; description: string | null };

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
  registrar: "Registrar",
  accountant: "Accountant",
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

export type FeeKind = "tuition" | "registration" | "other";
export type FeeFrequency = "once" | "per_term" | "monthly";
export const feeKindLabel: Record<FeeKind, string> = { tuition: "Tuition", registration: "Registration", other: "Other" };
export const frequencyLabel: Record<FeeFrequency, string> = { once: "Once", per_term: "Per term", monthly: "Monthly" };
export type FeeStructure = { id: string; academic_year_id: string; grade_level: number | null; name: string };
export type FeeItem = { id: string; structure_id: string; name: string; kind: FeeKind; frequency: FeeFrequency; amount: number };
export type Discount = {
  id: string; student_id: string; academic_year_id: string; name: string; kind: "percent" | "fixed"; value: number;
  applies_to: "tuition" | "all"; notes: string | null;
};
export type InvoiceState = "paid" | "partial" | "unpaid" | "overdue" | "void";
export const invoiceStateLabel: Record<InvoiceState, string> = { paid: "Paid", partial: "Part paid", unpaid: "Unpaid", overdue: "Overdue", void: "Void" };
export type InvoiceBalance = {
  invoice_id: string; student_id: string; academic_year_id: string | null; number: string; title: string;
  issued_on: string; due_on: string | null; total: number; paid: number; balance: number; state: InvoiceState;
};
export type InvoiceLine = { id: string; invoice_id: string; description: string; kind: FeeKind | "discount"; amount: number };
export type PaymentMethod = "cash" | "bank" | "telebirr" | "cbe_birr" | "cheque" | "other";
export const paymentMethodLabel: Record<PaymentMethod, string> = {
  cash: "Cash", bank: "Bank transfer", telebirr: "Telebirr", cbe_birr: "CBE Birr", cheque: "Cheque", other: "Other",
};
export type Payment = {
  id: string; invoice_id: string; student_id: string; receipt_number: string; amount: number; paid_on: string;
  method: PaymentMethod; reference: string | null; voided: boolean; void_reason: string | null; created_at: string;
};
export type Expense = {
  id: string; academic_year_id: string | null; category: string; description: string; amount: number; spent_on: string;
  paid_to: string | null; method: PaymentMethod; reference: string | null;
};
export type BudgetLine = { id: string; academic_year_id: string; category: string; amount: number };
