import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { differenceInYears, endOfMonth, format } from "date-fns";
import { ArrowLeft, CalendarCheck, FileUp, School as SchoolIcon, HandCoins, IdCard, ListChecks, MessageSquarePlus, Printer, UserPlus } from "lucide-react";
import AddMenu from "@/components/AddMenu";
import { toast } from "sonner";
import { printStudentCards } from "@/components/student/idCardData";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { useClasses, useCurrentYear } from "@/hooks/useSchoolData";
import { className, studentStatusLabel, type AttendanceStatus, type Guardian, type Student } from "@/lib/types";
import Panel from "@/components/Panel";
import StudentHistory from "@/components/StudentHistory";
import { StudentDocuments } from "@/components/StudentFiles";
import StudentFees from "@/components/finance/StudentFees";
import { GuardiansTab, ProfileTab } from "@/components/student/StudentPanels";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<AttendanceStatus, string> = {
  present: "text-emerald-700 dark:text-emerald-400", late: "text-amber-700 dark:text-amber-400",
  absent: "text-red-700 dark:text-red-400", excused: "text-sky-700 dark:text-sky-400",
};

// One student's record: a header band with the essentials, then panels for each part of the record.
export default function StudentRecord() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { canManageFinance, canManageStudents, school } = useSchool();
  const { data: year } = useCurrentYear();
  const { data: classes = [] } = useClasses(year?.id);

  const { data, isLoading } = useQuery({
    queryKey: ["students", "record", id],
    enabled: !!id,
    queryFn: async () => {
      const [s, e, g] = await Promise.all([
        supabase.from("students").select("*").eq("id", id!).maybeSingle(),
        supabase.from("enrollments").select("class_id").eq("student_id", id!).eq("status", "active"),
        supabase.from("guardians").select("*").eq("student_id", id!).order("created_at"),
      ]);
      const err = s.error ?? e.error ?? g.error;
      if (err) throw err;
      return { student: s.data as Student | null, classIds: (e.data ?? []).map((x) => x.class_id as string), guardians: (g.data ?? []) as Guardian[] };
    },
  });

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  const student = data?.student;
  if (!student) return <p className="text-muted-foreground">Student not found. <Link className="underline" to="/students">Back to students</Link></p>;
  const cls = classes.find((c) => data.classIds.includes(c.id));
  const age = student.date_of_birth ? differenceInYears(new Date(), new Date(`${student.date_of_birth}T00:00:00`)) : null;
  const guardian = data.guardians[0];
  const flagged = !!student.medical_notes || student.status !== "active";

  // Actions that live in a panel scroll to it and flash it.
  const jump = (id: string) => {
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    el?.animate([{ boxShadow: "0 0 0 3px hsl(var(--ring))" }, { boxShadow: "0 0 0 0 transparent" }], { duration: 1200 });
  };

  const item = (label: string, value: React.ReactNode) => (
    <div className="flex gap-1.5"><span className="italic text-muted-foreground">{label}:</span><span className="font-semibold">{value || "—"}</span></div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm print:hidden">
        <button className="flex items-center gap-1 text-primary hover:underline" onClick={() => navigate("/students")}><ArrowLeft className="h-4 w-4" /> Students</button>
        <span className="ml-auto flex items-center gap-1">
          <AddMenu label="Actions" icon={ListChecks} align="end" groups={[
            { items: [
              { label: cls ? "Move to another class" : "Enroll in a class", icon: SchoolIcon, color: "text-blue-700", onSelect: () => jump("panel-profile"), show: canManageStudents },
              { label: "Add guardian", icon: UserPlus, color: "text-emerald-600", onSelect: () => jump("panel-guardians") },
              { label: "Upload document", icon: FileUp, color: "text-orange-600", onSelect: () => jump("panel-documents") },
              { label: "Record payment", icon: HandCoins, color: "text-emerald-700", onSelect: () => jump("panel-fees"), show: canManageFinance },
            ] },
            { items: [
              { label: "Message family", icon: MessageSquarePlus, color: "text-rose-600", onSelect: () => navigate(`/messages?new=1&student=${student.id}`) },
              { label: "Print ID card", icon: IdCard, color: "text-blue-700", onSelect: () => printStudentCards([student], school!, year?.name ?? null, () => (cls ? className(cls) : null)).catch((e) => toast.error(e.message)) },
              { label: "Print record", icon: Printer, color: "text-slate-600 dark:text-slate-300", onSelect: () => window.print() },
            ] },
          ]} />
        </span>
      </div>

      {/* Header band: who this is, at a glance. Amber when there is something to notice. */}
      <div className={cn("grid gap-3 rounded-sm border px-4 py-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.3fr)]",
        flagged ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40" : "border-primary/30 bg-accent")}>
        <div>
          <div className="text-2xl font-medium">{student.first_name} {student.father_name} {student.grandfather_name}</div>
          <div className="text-sm">
            {age !== null && age > 0 && <b>{age} years</b>}{student.gender && <> · {student.gender === "M" ? "Male" : "Female"}</>}
            {student.date_of_birth && <> · <i className="text-muted-foreground">DOB:</i> <b>{format(new Date(`${student.date_of_birth}T00:00:00`), "dd-MMM-yyyy")}</b></>}
          </div>
          <div className="text-sm">{guardian && <><i className="text-muted-foreground">Guardian:</i> <b>{guardian.full_name}{guardian.phone && ` · ${guardian.phone}`}</b></>}</div>
        </div>
        <div className="space-y-0.5 border-primary/20 text-sm md:border-l md:pl-3">
          {item("Class", cls ? className(cls) : "Not enrolled")}
          {item("Status", studentStatusLabel[student.status])}
          {item("Admitted", student.admission_date)}
        </div>
        <div className="space-y-0.5 border-primary/20 text-sm md:border-l md:pl-3">
          {item("Student ID", student.student_code)}
          {item("Notes", student.medical_notes)}
          {item("Address", student.address)}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Profile" id="panel-profile"><ProfileTab student={student} currentClassId={cls?.id} onClose={() => undefined} /></Panel>
        <Panel title="Guardians" id="panel-guardians"><GuardiansTab student={student} /></Panel>
        <AttendancePanel studentId={student.id} />
        <Panel title="Documents" id="panel-documents"><StudentDocuments student={student} /></Panel>
        <Panel title="Results by year" className="lg:col-span-2"><StudentHistory studentId={student.id} /></Panel>
        {canManageFinance && <Panel title="Fees" id="panel-fees" className="lg:col-span-2"><StudentFees student={student} /></Panel>}
      </div>
    </div>
  );
}

function AttendancePanel({ studentId }: { studentId: string }) {
  const navigate = useNavigate();
  const [month, setMonth] = useState(format(new Date(), "yyyy-MM"));
  const from = `${month}-01`;
  const to = format(endOfMonth(new Date(`${from}T00:00:00`)), "yyyy-MM-dd");
  const { data: days = [] } = useQuery({
    queryKey: ["record-attendance", studentId, month],
    queryFn: async () => {
      const { data, error } = await supabase.from("attendance").select("date, status, note").eq("student_id", studentId)
        .gte("date", from).lte("date", to).order("date", { ascending: false });
      if (error) throw error;
      return data as { date: string; status: AttendanceStatus; note: string | null }[];
    },
  });
  const count = (s: AttendanceStatus) => days.filter((d) => d.status === s).length;
  return (
    <Panel title="Attendance" actions={[{ label: "Take attendance", icon: CalendarCheck, onClick: () => navigate("/attendance") }]}>
      <div className="space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <Input type="month" className="h-8 w-40" value={month} onChange={(e) => setMonth(e.target.value)} />
          <span><b>{count("present")}</b> present · <b>{count("late")}</b> late · <b>{count("absent")}</b> absent · <b>{count("excused")}</b> excused</span>
        </div>
        <div className="max-h-48 overflow-auto border">
          <table className="w-full text-sm">
            <thead><tr><th className="px-2 py-1 text-left">Date</th><th className="px-2 py-1 text-left">Status</th><th className="px-2 py-1 text-left">Note</th></tr></thead>
            <tbody>
              {days.length === 0 && <tr><td colSpan={3} className="px-2 py-4 text-center text-muted-foreground">Nothing recorded this month.</td></tr>}
              {days.map((d) => (
                <tr key={d.date} className="border-t">
                  <td className="px-2 py-1 tabular-nums">{format(new Date(`${d.date}T00:00:00`), "EEE dd MMM")}</td>
                  <td className={cn("px-2 py-1 font-medium capitalize", STATUS_TONE[d.status])}>{d.status}</td>
                  <td className="px-2 py-1 text-muted-foreground">{d.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
  );
}
