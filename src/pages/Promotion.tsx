import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useClasses, useCurrentYear, useYears } from "@/hooks/useSchoolData";
import { className, PASS_MARK, resultLabel, studentName, type PromotionResult, type SchoolClass, type Student } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const SKIP = "skip";
type Outcome = PromotionResult | typeof SKIP;
type Decision = { result: Outcome; toClass: string };
type Row = {
  student: Pick<Student, "id" | "first_name" | "father_name" | "grandfather_name" | "student_code" | "status">;
  cls: SchoolClass;
  result: PromotionResult | null;
  average: number | null;
  placedIn: string | undefined;
};

export default function Promotion() {
  const qc = useQueryClient();
  const { data: years = [] } = useYears();
  const { data: current } = useCurrentYear();
  // Years are sorted newest first: by default close the year before the current one.
  const [toYear, setToYear] = useState<string>();
  const [fromYear, setFromYear] = useState<string>();
  useEffect(() => {
    if (!current || toYear) return;
    setToYear(current.id);
    setFromYear(years[years.findIndex((y) => y.id === current.id) + 1]?.id);
  }, [current, years, toYear]);

  const { data: fromClasses = [] } = useClasses(fromYear);
  const { data: toClasses = [] } = useClasses(toYear);

  // Loaded class by class so a large school stays under the API's row limit per request.
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["promotion", fromYear, toYear, fromClasses.map((c) => c.id).join(), toClasses.map((c) => c.id).join()],
    enabled: fromClasses.length > 0,
    queryFn: async () => {
      const placed = new Map<string, string>();
      await Promise.all(toClasses.map(async (c) => {
        const { data, error } = await supabase.from("enrollments").select("student_id").eq("class_id", c.id).eq("status", "active");
        if (error) throw error;
        for (const e of data) placed.set(e.student_id, c.id);
      }));
      const perClass = await Promise.all(fromClasses.map(async (cls) => {
        const [enr, res] = await Promise.all([
          supabase.from("enrollments")
            .select("result, student:students(id, first_name, father_name, grandfather_name, student_code, status)")
            .eq("class_id", cls.id).eq("status", "active"),
          supabase.from("class_results").select("student_id, average").eq("class_id", cls.id),
        ]);
        const err = enr.error ?? res.error;
        if (err) throw err;
        const avg = new Map((res.data ?? []).map((r) => [r.student_id as string, Number(r.average)]));
        return ((enr.data ?? []) as unknown as { result: PromotionResult | null; student: Row["student"] }[])
          .filter((e) => e.student.status === "active" || e.student.status === "graduated")
          .map((e): Row => ({ ...e, cls, average: avg.get(e.student.id) ?? null, placedIn: placed.get(e.student.id) }))
          .sort((a, b) => a.student.first_name.localeCompare(b.student.first_name));
      }));
      return perClass.flat();
    },
  });

  const [decisions, setDecisions] = useState<Record<string, Decision>>({});

  // A suggestion for each student: an earlier decision if there is one, otherwise by grade and average.
  const suggested = useMemo(() => {
    const classFor = (grade: number, section: string) =>
      (toClasses.find((c) => c.grade_level === grade && c.section === section) ?? toClasses.find((c) => c.grade_level === grade))?.id ?? "";
    const out: Record<string, Decision> = {};
    for (const r of rows) {
      const result: PromotionResult = r.result
        ?? (r.cls.grade_level === 12 ? "graduated" : r.average !== null && r.average < PASS_MARK ? "repeated" : "promoted");
      const grade = result === "promoted" ? r.cls.grade_level + 1 : r.cls.grade_level;
      out[r.student.id] = { result, toClass: result === "graduated" ? "" : r.placedIn ?? classFor(grade, r.cls.section) };
    }
    return out;
  }, [rows, toClasses]);
  useEffect(() => setDecisions(suggested), [suggested]);

  const decide = (id: string, patch: Partial<Decision>) => setDecisions((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  const chosen = rows.filter((r) => decisions[r.student.id] && decisions[r.student.id].result !== SKIP);
  const missingClass = chosen.filter((r) => decisions[r.student.id].result !== "graduated" && !decisions[r.student.id].toClass);
  const count = (o: Outcome) => chosen.filter((r) => decisions[r.student.id].result === o).length;
  const [saving, setSaving] = useState(false);

  const apply = async () => {
    const from = years.find((y) => y.id === fromYear)?.name;
    const to = years.find((y) => y.id === toYear)?.name;
    if (!confirm(`Apply outcomes for ${chosen.length} students from ${from} into ${to}?`)) return;
    setSaving(true);
    const { error } = await supabase.rpc("promote_students", {
      _from_year: fromYear,
      _to_year: toYear,
      _decisions: chosen.map((r) => ({
        student_id: r.student.id, result: decisions[r.student.id].result, to_class_id: decisions[r.student.id].toClass || null,
      })),
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`${chosen.length} students moved to ${to}`);
    for (const k of ["promotion", "students", "enrollments", "roster", "student-history"]) qc.invalidateQueries({ queryKey: [k] });
  };

  if (years.length < 2) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Year-end promotion</h1>
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Promotion moves students from a finished year into the next one. First create the new academic year in{" "}
            <Link to="/setup" className="underline">School setup</Link>, make it current and add its classes.
          </CardContent>
        </Card>
      </div>
    );
  }

  const yearSelect = (value: string | undefined, onChange: (v: string) => void) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="sm:w-48"><SelectValue placeholder="Select year" /></SelectTrigger>
      <SelectContent>{years.map((y) => <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>)}</SelectContent>
    </Select>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Year-end promotion</h1>
        <p className="text-sm text-muted-foreground">
          Suggestions: grade 12 graduates, a year average below {PASS_MARK} repeats, everyone else moves up a grade in the same section.
          Change any of them before applying. You can apply again later to correct a decision.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="space-y-1"><Label>Closing year</Label>{yearSelect(fromYear, setFromYear)}</div>
        <div className="space-y-1"><Label>Into year</Label>{yearSelect(toYear, setToYear)}</div>
      </div>

      {fromYear && fromYear === toYear && <p className="text-sm text-destructive">Choose two different years.</p>}
      {toYear && fromYear !== toYear && toClasses.length === 0 && (
        <p className="text-sm text-amber-600">
          The new year has no classes yet. Add them in <Link to="/setup" className="underline">School setup</Link> first.
        </p>
      )}
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {fromYear && fromClasses.length === 0 && <p className="text-sm text-muted-foreground">The closing year has no classes.</p>}

      {fromClasses.map((cls) => {
        const classRows = rows.filter((r) => r.cls.id === cls.id);
        if (classRows.length === 0) return null;
        return (
          <Card key={cls.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{className(cls)}</CardTitle>
              <CardDescription>{classRows.length} students</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2 font-normal">Student</th>
                    <th className="px-2 py-2 text-right font-normal">Average</th>
                    <th className="px-2 py-2 font-normal">Outcome</th>
                    <th className="px-4 py-2 font-normal">Next class</th>
                  </tr>
                </thead>
                <tbody>
                  {classRows.map((r) => {
                    const d = decisions[r.student.id];
                    if (!d) return null;
                    return (
                      <tr key={r.student.id} className="border-b last:border-0">
                        <td className="px-4 py-2">
                          {studentName(r.student)} {r.student.grandfather_name}
                          <div className="text-xs text-muted-foreground">
                            {r.student.student_code}
                            {r.result && <> · <Badge variant="outline" className="ml-1">Done: {resultLabel[r.result]}</Badge></>}
                          </div>
                        </td>
                        <td className={`px-2 py-2 text-right tabular-nums ${r.average !== null && r.average < PASS_MARK ? "text-destructive" : ""}`}>
                          {r.average ?? "—"}
                        </td>
                        <td className="px-2 py-2">
                          <Select value={d.result} onValueChange={(v) => decide(r.student.id, { result: v as Outcome })}>
                            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="promoted">Promote</SelectItem>
                              <SelectItem value="repeated">Repeat</SelectItem>
                              <SelectItem value="graduated">Graduate</SelectItem>
                              <SelectItem value={SKIP}>Decide later</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-4 py-2">
                          {d.result === "promoted" || d.result === "repeated" ? (
                            <Select value={d.toClass || undefined} onValueChange={(v) => decide(r.student.id, { toClass: v })}>
                              <SelectTrigger className={`w-36 ${d.toClass ? "" : "border-destructive"}`}><SelectValue placeholder="Choose class" /></SelectTrigger>
                              <SelectContent>
                                {toClasses.map((c) => <SelectItem key={c.id} value={c.id}>{className(c)}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        );
      })}

      {rows.length > 0 && (
        <div className="sticky bottom-0 flex flex-col gap-2 border-t bg-background py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm">
            {count("promoted")} promoted · {count("repeated")} repeating · {count("graduated")} graduating
            {missingClass.length > 0 && <span className="text-destructive"> · {missingClass.length} still need a class</span>}
          </div>
          <Button onClick={apply} disabled={saving || chosen.length === 0 || missingClass.length > 0 || !fromYear || fromYear === toYear}>
            Apply to {chosen.length} students
          </Button>
        </div>
      )}
    </div>
  );
}
