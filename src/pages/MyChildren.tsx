import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { className, studentName, type Student } from "@/lib/types";
import StudentHistory from "@/components/StudentHistory";
import { StudentDocuments, StudentPhoto } from "@/components/StudentFiles";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function MyChildren() {
  const { school, session } = useSchool();

  const { data: children = [], isLoading } = useQuery({
    queryKey: ["my-children", school?.id, session?.user.id],
    enabled: !!school && !!session,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("guardians")
        .select("student:students(*)")
        .eq("school_id", school!.id)
        .eq("user_id", session!.user.id);
      if (error) throw error;
      return (data ?? []).map((r) => (r as unknown as { student: Student }).student).filter(Boolean);
    },
  });

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">My children</h1>
      {children.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No children are linked to your account at {school?.name}. Ask the school to add your email as a guardian.
        </p>
      )}
      {children.map((c) => <ChildCard key={c.id} child={c} />)}
    </div>
  );
}

function ChildCard({ child }: { child: Student }) {

  const { data } = useQuery({
    queryKey: ["child-summary", child.id],
    queryFn: async () => {
      const [enr, att, sc] = await Promise.all([
        supabase.from("enrollments").select("class:classes(id, grade_level, section, academic_year:academic_years(is_current))")
          .eq("student_id", child.id).eq("status", "active"),
        supabase.from("attendance").select("status, date").eq("student_id", child.id).order("date", { ascending: false }).limit(60),
        supabase.from("scores").select("score, assessment:assessments(title, max_score, kind, class_subject:class_subjects(subject_name))")
          .eq("student_id", child.id).order("updated_at", { ascending: false }).limit(15),
      ]);
      const err = enr.error ?? att.error ?? sc.error;
      if (err) throw err;
      // The current year's class; a promoted student keeps last year's enrollment for history.
      const rows = (enr.data ?? []) as unknown as { class: { id: string; grade_level: number; section: string; academic_year: { is_current: boolean } } }[];
      const cls = (rows.find((r) => r.class.academic_year?.is_current) ?? rows[0])?.class;
      const exams = cls
        ? await supabase.from("exam_sittings")
          .select("id, date, starts_at, ends_at, room, class_subject:class_subjects(subject_name), period:exam_periods(name)")
          .eq("class_id", cls.id).gte("date", new Date().toISOString().slice(0, 10)).order("date").order("starts_at").limit(20)
        : { data: [], error: null };
      if (exams.error) throw exams.error;
      return {
        cls,
        exams: (exams.data ?? []) as unknown as {
          id: string; date: string; starts_at: string; ends_at: string; room: string | null;
          class_subject: { subject_name: string }; period: { name: string };
        }[],
        attendance: (att.data ?? []) as { status: string; date: string }[],
        scores: (sc.data ?? []) as unknown as {
          score: number | null;
          assessment: { title: string; max_score: number; kind: string; class_subject: { subject_name: string } };
        }[],
      };
    },
  });

  const att = data?.attendance ?? [];
  const present = att.filter((a) => a.status === "present" || a.status === "late").length;

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-4 space-y-0">
        <StudentPhoto student={child} size={64} />
        <div>
          <CardTitle className="text-lg">{studentName(child)}</CardTitle>
          <CardDescription>{data?.cls ? className(data.cls) : "Not enrolled in a class"}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-3">
        <div>
          <div className="text-sm text-muted-foreground">Attendance (last {att.length} days marked)</div>
          <div className="text-2xl font-semibold tabular-nums">{att.length ? `${Math.round((present / att.length) * 100)}%` : "—"}</div>
          <div className="mt-2 flex flex-wrap gap-1">
            {att.slice(0, 20).map((a) => (
              <span
                key={a.date}
                title={`${a.date}: ${a.status}`}
                className={`h-3 w-3 rounded-sm ${
                  a.status === "present" ? "bg-emerald-500" : a.status === "late" ? "bg-amber-400" : a.status === "excused" ? "bg-sky-500" : "bg-red-500"
                }`}
              />
            ))}
          </div>
        </div>

        <div className="md:col-span-2">
          <div className="mb-2 text-sm text-muted-foreground">Recent results</div>
          {(data?.scores ?? []).length === 0 && <p className="text-sm text-muted-foreground">No results yet.</p>}
          <div className="divide-y text-sm">
            {(data?.scores ?? []).map((s, i) => (
              <div key={i} className="flex justify-between py-1.5">
                <span>
                  <span className="text-muted-foreground">{s.assessment.class_subject.subject_name} · </span>
                  {s.assessment.title}
                </span>
                <span className="tabular-nums">{s.score ?? "—"}/{s.assessment.max_score}</span>
              </div>
            ))}
          </div>
        </div>

        {(data?.exams ?? []).length > 0 && (
          <div className="md:col-span-3">
            <div className="mb-2 text-sm text-muted-foreground">Upcoming exams</div>
            <div className="divide-y text-sm">
              {data!.exams.map((e) => (
                <div key={e.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                  <span>{e.class_subject.subject_name} <span className="text-muted-foreground">· {e.period.name}</span></span>
                  <span className="tabular-nums text-muted-foreground">{e.date} · {e.starts_at.slice(0, 5)}–{e.ends_at.slice(0, 5)}{e.room && ` · ${e.room}`}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <details className="md:col-span-3">
          <summary className="cursor-pointer text-sm font-medium">Full history by year</summary>
          <div className="mt-3"><StudentHistory studentId={child.id} /></div>
        </details>

        <details className="md:col-span-3">
          <summary className="cursor-pointer text-sm font-medium">Documents</summary>
          <div className="mt-3"><StudentDocuments student={child} /></div>
        </details>

        <div className="space-y-1 rounded-md border p-3 md:col-span-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            Learning app {child.learning_student_id ? <Badge>Linked</Badge> : <Badge variant="outline">Not linked</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">
            Connecting this child to their learning-app profile is coming soon. You will approve it from the learning app,
            and only then can the school see practice results.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
