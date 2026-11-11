import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { endOfMonth, format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import {
  birr, className, homeworkStateLabel, studentName,
  type Announcement, type AttendanceStatus, type Homework, type HomeworkStatus, type Resource, type SchoolClass, type Student, type VsClass,
} from "@/lib/types";
import StudentHistory from "@/components/StudentHistory";
import { StudentDocuments, StudentPhoto } from "@/components/StudentFiles";
import StudentFees from "@/components/finance/StudentFees";
import { useStudentFinance } from "@/components/finance/financeData";
import ResourceChips from "@/components/resources/ResourceChips";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const today = () => new Date().toISOString().slice(0, 10);
const ATTENDANCE_TONE: Record<AttendanceStatus, string> = {
  present: "bg-emerald-500", late: "bg-amber-400", excused: "bg-sky-500", absent: "bg-red-500",
};

// The family portal: guardians see each of their children; a student with their own login sees themselves.
export default function MyChildren() {
  const { school, session, roles } = useSchool();
  const isStudent = roles.includes("student") && !roles.includes("parent");

  const { data: children = [], isLoading } = useQuery({
    queryKey: ["my-children", school?.id, session?.user.id],
    enabled: !!school && !!session,
    queryFn: async () => {
      const [g, self] = await Promise.all([
        supabase.from("guardians").select("student:students(*)").eq("school_id", school!.id).eq("user_id", session!.user.id),
        supabase.from("students").select("*").eq("school_id", school!.id).eq("user_id", session!.user.id),
      ]);
      const err = g.error ?? self.error;
      if (err) throw err;
      const all = [...((g.data ?? []) as unknown as { student: Student }[]).map((r) => r.student), ...((self.data ?? []) as Student[])].filter(Boolean);
      return [...new Map(all.map((s) => [s.id, s])).values()];
    },
  });
  const [selectedId, setSelectedId] = useState<string>();
  const child = children.find((c) => c.id === selectedId) ?? children[0];

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{isStudent ? "My portal" : "My children"}</h1>
      {children.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {isStudent ? "Your account isn't linked to a student record yet. Ask the school office."
            : `No children are linked to your account at ${school?.name}. Ask the school to add your email as a guardian.`}
        </p>
      )}
      {children.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {children.map((c) => (
            <Button key={c.id} variant={c.id === child?.id ? "default" : "outline"} onClick={() => setSelectedId(c.id)}>{studentName(c)}</Button>
          ))}
        </div>
      )}
      {child && <ChildPortal key={child.id} child={child} />}
    </div>
  );
}

function useCurrentClass(studentId: string) {
  return useQuery({
    queryKey: ["child-class", studentId],
    queryFn: async () => {
      const { data, error } = await supabase.from("enrollments")
        .select("class:classes(*, academic_year:academic_years(is_current))").eq("student_id", studentId).eq("status", "active");
      if (error) throw error;
      // The current year's class; a promoted student keeps last year's enrollment for history.
      const rows = (data ?? []) as unknown as { class: SchoolClass & { academic_year: { is_current: boolean } } }[];
      return (rows.find((r) => r.class.academic_year?.is_current) ?? rows[0])?.class ?? null;
    },
  });
}

function ChildPortal({ child }: { child: Student }) {
  const { data: cls } = useCurrentClass(child.id);
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-4 space-y-0">
        <StudentPhoto student={child} size={64} readOnly />
        <div>
          <CardTitle className="text-lg">{studentName(child)} {child.grandfather_name}</CardTitle>
          <div className="text-sm text-muted-foreground">{cls ? className(cls) : "Not enrolled in a class"}{child.student_code && ` · ${child.student_code}`}</div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="overview">
          <TabsList className="flex-wrap">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="attendance">Attendance</TabsTrigger>
            <TabsTrigger value="results">Results</TabsTrigger>
            <TabsTrigger value="homework">Homework</TabsTrigger>
            <TabsTrigger value="fees">Fees</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
            <TabsTrigger value="teachers">Teachers</TabsTrigger>
          </TabsList>
          <TabsContent value="overview"><Overview child={child} cls={cls ?? null} /></TabsContent>
          <TabsContent value="attendance"><AttendanceTab child={child} /></TabsContent>
          <TabsContent value="results"><Results child={child} /></TabsContent>
          <TabsContent value="homework"><HomeworkTab child={child} cls={cls ?? null} /></TabsContent>
          <TabsContent value="fees"><StudentFees student={child} readOnly /></TabsContent>
          <TabsContent value="documents"><StudentDocuments student={child} readOnly /></TabsContent>
          <TabsContent value="teachers"><Teachers child={child} /></TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

// Homework for the child's current class, with the teacher's mark for this child.
function useChildHomework(child: Student, cls: SchoolClass | null) {
  return useQuery({
    queryKey: ["child-homework", child.id, cls?.id],
    enabled: !!cls,
    queryFn: async () => {
      const { data: subjects, error } = await supabase.from("class_subjects").select("id, subject_name").eq("class_id", cls!.id);
      if (error) throw error;
      const ids = (subjects ?? []).map((s) => s.id);
      const [hw, st] = await Promise.all([
        ids.length ? supabase.from("homework").select("*, attachments:homework_resources(resource:resources(*))").in("class_subject_id", ids)
          .order("due_on", { ascending: false, nullsFirst: false }).limit(100)
          : Promise.resolve({ data: [], error: null }),
        supabase.from("homework_status").select("*").eq("student_id", child.id),
      ]);
      const err = hw.error ?? st.error;
      if (err) throw err;
      const subjectName = new Map((subjects ?? []).map((s) => [s.id as string, s.subject_name as string]));
      const status = new Map(((st.data ?? []) as HomeworkStatus[]).map((s) => [s.homework_id, s]));
      return ((hw.data ?? []) as unknown as (Homework & { attachments: { resource: Resource | null }[] })[]).map((h) => ({
        ...h, subject: subjectName.get(h.class_subject_id) ?? "", status: status.get(h.id),
        resources: h.attachments.map((a) => a.resource).filter((r): r is Resource => !!r),
      }));
    },
  });
}

function Overview({ child, cls }: { child: Student; cls: SchoolClass | null }) {
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const { data } = useQuery({
    queryKey: ["child-overview", child.id, cls?.id],
    queryFn: async () => {
      const [att, exams, posts] = await Promise.all([
        supabase.from("attendance").select("status").eq("student_id", child.id).gte("date", since),
        cls
          ? supabase.from("exam_sittings").select("id, date, starts_at, ends_at, room, class_subject:class_subjects(subject_name), period:exam_periods(name)")
            .eq("class_id", cls.id).gte("date", today()).order("date").order("starts_at").limit(10)
          : Promise.resolve({ data: [], error: null }),
        supabase.from("announcements").select("*").eq("school_id", child.school_id).order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(3),
      ]);
      const err = att.error ?? exams.error ?? posts.error;
      if (err) throw err;
      return {
        attendance: (att.data ?? []) as { status: AttendanceStatus }[],
        exams: (exams.data ?? []) as unknown as { id: string; date: string; starts_at: string; ends_at: string; room: string | null; class_subject: { subject_name: string }; period: { name: string } }[],
        posts: (posts.data ?? []) as Announcement[],
      };
    },
  });
  const { data: homework = [] } = useChildHomework(child, cls);
  const { data: finance } = useStudentFinance(child.id);
  const att = data?.attendance ?? [];
  const attended = att.filter((a) => a.status === "present" || a.status === "late").length;
  const dueSoon = homework.filter((h) => h.due_on && h.due_on >= today() && h.status?.status !== "done").slice(0, 5);
  const owed = (finance?.invoices ?? []).reduce((n, i) => n + Number(i.balance), 0);

  return (
    <div className="grid gap-4 pt-2 md:grid-cols-3">
      <Stat label="Attendance, last 30 days" value={att.length ? `${Math.round((attended / att.length) * 100)}%` : "—"} note={att.length ? `${att.length} school ${att.length === 1 ? "day" : "days"} marked` : undefined} />
      <Stat label="Homework due" value={String(dueSoon.length)} note={dueSoon[0] ? `Next: ${dueSoon[0].subject} · ${dueSoon[0].due_on}` : undefined} />
      <Stat label="Fees outstanding" value={`${birr(owed)} birr`} danger={owed > 0} />

      <Section title="Upcoming exams" empty="No exams scheduled.">
        {(data?.exams ?? []).map((e) => (
          <div key={e.id} className="flex flex-wrap justify-between gap-2 py-1">
            <span>{e.class_subject.subject_name} <span className="text-muted-foreground">· {e.period.name}</span></span>
            <span className="tabular-nums text-muted-foreground">{e.date} · {e.starts_at.slice(0, 5)}{e.room && ` · ${e.room}`}</span>
          </div>
        ))}
      </Section>
      <Section title="Homework due soon" empty="Nothing due.">
        {dueSoon.map((h) => (
          <div key={h.id} className="flex justify-between gap-2 py-1">
            <span>{h.title} <span className="text-muted-foreground">· {h.subject}</span></span>
            <span className="tabular-nums text-muted-foreground">{h.due_on}</span>
          </div>
        ))}
      </Section>
      <Section title="Announcements" empty="No announcements.">
        {(data?.posts ?? []).map((p) => (
          <div key={p.id} className="py-1">
            <div className="font-medium">{p.pinned && "📌 "}{p.title}</div>
            <div className="line-clamp-2 text-muted-foreground">{p.body}</div>
          </div>
        ))}
      </Section>
    </div>
  );
}

function Stat({ label, value, note, danger }: { label: string; value: string; note?: string; danger?: boolean }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-2xl font-semibold tabular-nums", danger && "text-destructive")}>{value}</div>
      {note && <div className="text-xs text-muted-foreground">{note}</div>}
    </div>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <div className="space-y-1 text-sm md:col-span-1">
      <div className="font-medium">{title}</div>
      {children.length === 0 ? <p className="text-muted-foreground">{empty}</p> : <div className="divide-y">{children}</div>}
    </div>
  );
}

function AttendanceTab({ child }: { child: Student }) {
  const [month, setMonth] = useState(format(new Date(), "yyyy-MM"));
  const from = `${month}-01`;
  const to = format(endOfMonth(new Date(`${from}T00:00:00`)), "yyyy-MM-dd");
  const { data: days = [] } = useQuery({
    queryKey: ["child-attendance", child.id, month],
    queryFn: async () => {
      const { data, error } = await supabase.from("attendance").select("date, status, note").eq("student_id", child.id)
        .gte("date", from).lte("date", to).order("date");
      if (error) throw error;
      return data as { date: string; status: AttendanceStatus; note: string | null }[];
    },
  });
  const count = (s: AttendanceStatus) => days.filter((d) => d.status === s).length;

  return (
    <div className="space-y-3 pt-2 text-sm">
      <Input type="month" className="w-44" value={month} onChange={(e) => setMonth(e.target.value)} />
      <div className="flex flex-wrap gap-3">
        <span><b>{count("present")}</b> present</span><span><b>{count("late")}</b> late</span>
        <span><b>{count("absent")}</b> absent</span><span><b>{count("excused")}</b> excused</span>
        {days.length > 0 && <span className="text-muted-foreground">· {Math.round(((count("present") + count("late")) / days.length) * 100)}% attended</span>}
      </div>
      {days.length === 0 && <p className="text-muted-foreground">No attendance recorded this month.</p>}
      <div className="divide-y rounded-md border">
        {days.map((d) => (
          <div key={d.date} className="flex items-center gap-3 px-3 py-1.5">
            <span className={cn("h-2.5 w-2.5 rounded-full", ATTENDANCE_TONE[d.status])} />
            <span className="w-32 tabular-nums">{format(new Date(`${d.date}T00:00:00`), "EEE d MMM")}</span>
            <span className="capitalize">{d.status}</span>
            {d.note && <span className="text-muted-foreground">· {d.note}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Results({ child }: { child: Student }) {
  const { data } = useQuery({
    queryKey: ["child-vs-class", child.id],
    queryFn: async () => {
      const { data: rows, error } = await supabase.rpc("student_vs_class", { _student_id: child.id });
      if (error) throw error;
      const termIds = [...new Set((rows as VsClass[]).map((r) => r.term_id).filter(Boolean))] as string[];
      const terms = termIds.length ? await supabase.from("terms").select("id, name, academic_year_id").in("id", termIds) : { data: [], error: null };
      if (terms.error) throw terms.error;
      return { rows: rows as VsClass[], terms: (terms.data ?? []) as { id: string; name: string }[] };
    },
  });
  const rows = data?.rows ?? [];
  const termName = useMemo(() => new Map((data?.terms ?? []).map((t) => [t.id, t.name])), [data]);
  const termIds = [...new Set(rows.map((r) => r.term_id ?? ""))].sort((a, b) => (termName.get(a) ?? "").localeCompare(termName.get(b) ?? ""));
  const subjects = [...new Map(rows.map((r) => [r.class_subject_id, r.subject_name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));

  return (
    <div className="space-y-4 pt-2 text-sm">
      {rows.length === 0 ? <p className="text-muted-foreground">No results yet.</p> : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[480px]">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-normal">Subject</th>
                {termIds.map((t) => <th key={t} className="px-3 py-2 text-right font-normal">{termName.get(t) ?? "No term"}</th>)}
              </tr>
            </thead>
            <tbody>
              {subjects.map(([id, name]) => (
                <tr key={id} className="border-b last:border-0">
                  <td className="px-3 py-2">{name}</td>
                  {termIds.map((t) => {
                    const r = rows.find((x) => x.class_subject_id === id && (x.term_id ?? "") === t);
                    const above = r?.student_total != null && r.class_average != null && Number(r.student_total) >= Number(r.class_average);
                    return (
                      <td key={t} className="px-3 py-2 text-right tabular-nums">
                        {r?.student_total != null ? (
                          <>
                            <span className={cn("font-medium", above ? "text-emerald-700 dark:text-emerald-400" : "")}>{Number(r.student_total)}</span>
                            <div className="text-xs text-muted-foreground">class avg {Number(r.class_average)}</div>
                          </>
                        ) : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Totals are weighted marks so far in each term. The class average shows how the class did overall; no other child's marks are shared.</p>
      <details>
        <summary className="cursor-pointer font-medium">Full history by year</summary>
        <div className="mt-3"><StudentHistory studentId={child.id} /></div>
      </details>
    </div>
  );
}

function HomeworkTab({ child, cls }: { child: Student; cls: SchoolClass | null }) {
  const { data: homework = [] } = useChildHomework(child, cls);
  if (!cls) return <p className="pt-2 text-sm text-muted-foreground">Not in a class this year.</p>;
  const upcoming = homework.filter((h) => !h.due_on || h.due_on >= today()).reverse();
  const past = homework.filter((h) => h.due_on && h.due_on < today());
  const row = (h: (typeof homework)[number]) => (
    <div key={h.id} className="space-y-0.5 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{h.title} <span className="font-normal text-muted-foreground">· {h.subject}</span></span>
        <span className="flex items-center gap-2">
          <span className="tabular-nums text-muted-foreground">{h.due_on ? `due ${h.due_on}` : "no due date"}</span>
          {h.status && <Badge variant={h.status.status === "done" ? "default" : h.status.status === "missing" ? "destructive" : "secondary"}>{homeworkStateLabel[h.status.status]}</Badge>}
        </span>
      </div>
      {h.instructions && <div className="whitespace-pre-line text-muted-foreground">{h.instructions}</div>}
      {h.status?.note && <div className="text-xs">Teacher's note: {h.status.note}</div>}
      <ResourceChips resources={h.resources} />
    </div>
  );
  return (
    <div className="space-y-4 pt-2 text-sm">
      <div className="space-y-1">
        <div className="font-medium">Coming up</div>
        {upcoming.length === 0 ? <p className="text-muted-foreground">Nothing set.</p> : <div className="divide-y rounded-md border">{upcoming.map(row)}</div>}
      </div>
      {past.length > 0 && (
        <div className="space-y-1">
          <div className="font-medium">Earlier</div>
          <div className="divide-y rounded-md border">{past.map(row)}</div>
        </div>
      )}
    </div>
  );
}

function Teachers({ child }: { child: Student }) {
  const navigate = useNavigate();
  const { data: contacts = [] } = useQuery({
    queryKey: ["contacts", child.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("student_contacts", { _student_id: child.id });
      if (error) throw error;
      return (data ?? []) as { user_id: string; name: string; role: string }[];
    },
  });
  return (
    <div className="space-y-2 pt-2 text-sm">
      {contacts.length === 0 && <p className="text-muted-foreground">No teachers assigned yet.</p>}
      <div className="divide-y rounded-md border">
        {contacts.map((c) => (
          <div key={c.user_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <div><div className="font-medium">{c.name}</div><div className="text-xs text-muted-foreground">{c.role}</div></div>
            <Button size="sm" variant="outline" onClick={() => navigate(`/messages?student=${child.id}&to=${c.user_id}`)}>Message</Button>
          </div>
        ))}
      </div>
    </div>
  );
}
