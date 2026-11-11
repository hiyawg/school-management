import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { className, resultLabel, type PromotionResult } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

type EnrollmentRow = {
  id: string;
  class_id: string;
  status: "active" | "transferred" | "withdrawn";
  result: PromotionResult | null;
  class: { grade_level: number; section: string; academic_year: { name: string } };
};
type ResultRow = { class_id: string; class_subject_id: string; subject_name: string; term_id: string | null; total: number };
type AttendanceRow = { class_id: string; present: number; late: number; absent: number; excused: number; days: number };

const average = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + Number(b), 0) / xs.length) * 10) / 10 : null);

// Every class the student has been in, newest year first, with attendance and results per subject and term.
export default function StudentHistory({ studentId }: { studentId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["student-history", studentId],
    queryFn: async () => {
      const [enr, res, att] = await Promise.all([
        supabase.from("enrollments")
          .select("id, class_id, status, result, class:classes(grade_level, section, academic_year:academic_years(name))")
          .eq("student_id", studentId),
        supabase.from("subject_results").select("class_id, class_subject_id, subject_name, term_id, total").eq("student_id", studentId),
        supabase.from("attendance_summary").select("class_id, present, late, absent, excused, days").eq("student_id", studentId),
      ]);
      const err = enr.error ?? res.error ?? att.error;
      if (err) throw err;
      const results = (res.data ?? []) as ResultRow[];
      const termIds = [...new Set(results.map((r) => r.term_id).filter(Boolean))] as string[];
      const terms = termIds.length
        ? await supabase.from("terms").select("id, name").in("id", termIds)
        : { data: [] as { id: string; name: string }[], error: null };
      if (terms.error) throw terms.error;
      return {
        enrollments: ((enr.data ?? []) as unknown as EnrollmentRow[])
          .sort((a, b) => b.class.academic_year.name.localeCompare(a.class.academic_year.name)),
        results,
        attendance: (att.data ?? []) as AttendanceRow[],
        termName: new Map((terms.data ?? []).map((t) => [t.id, t.name])),
      };
    },
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  if (!data?.enrollments.length) return <p className="text-sm text-muted-foreground">No classes yet.</p>;

  return (
    <div className="space-y-4">
      {data.enrollments.map((e) => {
        const results = data.results.filter((r) => r.class_id === e.class_id);
        const att = data.attendance.find((a) => a.class_id === e.class_id);
        const termIds = [...new Set(results.map((r) => r.term_id ?? ""))].sort((a, b) =>
          (data.termName.get(a) ?? "").localeCompare(data.termName.get(b) ?? ""));
        const subjects = [...new Map(results.map((r) => [r.class_subject_id, r.subject_name])).entries()]
          .sort((a, b) => a[1].localeCompare(b[1]));
        const yearAverage = average(results.map((r) => r.total));

        return (
          <div key={e.id} className="rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-medium">{e.class.academic_year.name} · {className(e.class)}</div>
              <div className="flex gap-1">
                {e.status !== "active" && <Badge variant="outline">{e.status === "transferred" ? "Moved to another class" : "Withdrawn"}</Badge>}
                {e.result && <Badge variant={e.result === "repeated" ? "destructive" : "secondary"}>{resultLabel[e.result]}</Badge>}
              </div>
            </div>

            <div className="mt-1 text-muted-foreground">
              {att ? (
                <>
                  Attendance: {att.present} present · {att.late} late · {att.absent} absent · {att.excused} excused
                  {" "}({Math.round(((Number(att.present) + Number(att.late)) / Number(att.days)) * 100)}% attended)
                </>
              ) : "No attendance recorded."}
            </div>

            {subjects.length > 0 ? (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-1 pr-2 font-normal">Subject</th>
                      {termIds.map((t) => <th key={t} className="px-2 py-1 text-right font-normal">{data.termName.get(t) ?? "No term"}</th>)}
                      <th className="py-1 pl-2 text-right font-normal">Average</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subjects.map(([id, name]) => {
                      const rows = results.filter((r) => r.class_subject_id === id);
                      return (
                        <tr key={id} className="border-b last:border-0">
                          <td className="py-1 pr-2">{name}</td>
                          {termIds.map((t) => (
                            <td key={t} className="px-2 py-1 text-right tabular-nums">
                              {rows.find((r) => (r.term_id ?? "") === t)?.total ?? "—"}
                            </td>
                          ))}
                          <td className="py-1 pl-2 text-right tabular-nums">{average(rows.map((r) => r.total)) ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="mt-1 text-right font-medium">Year average: <span className="tabular-nums">{yearAverage ?? "—"}</span></div>
              </div>
            ) : (
              <div className="mt-1 text-muted-foreground">No results recorded.</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
