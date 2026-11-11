import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { useClasses, useClassRoster, useCurrentYear, useMyAssignments } from "@/hooks/useSchoolData";
import { className, studentName, type AttendanceStatus } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const STATUSES: { value: AttendanceStatus; label: string; short: string; tone: string }[] = [
  { value: "present", label: "Present", short: "P", tone: "bg-emerald-600 text-white border-emerald-600" },
  { value: "late", label: "Late", short: "L", tone: "bg-amber-500 text-white border-amber-500" },
  { value: "absent", label: "Absent", short: "A", tone: "bg-red-600 text-white border-red-600" },
  { value: "excused", label: "Excused", short: "E", tone: "bg-sky-600 text-white border-sky-600" },
];

export default function Attendance() {
  const { school, isAdmin } = useSchool();
  const qc = useQueryClient();
  const { data: year } = useCurrentYear();
  const { data: allClasses = [] } = useClasses(year?.id);
  const mine = useMyAssignments(year?.id);
  // Teachers mark their homeroom classes first, then classes where they teach a subject.
  const classes = isAdmin ? allClasses : [...mine.homeroom, ...mine.teaching.filter((c) => !mine.homeroom.includes(c))];
  const [classId, setClassId] = useState<string>();
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const { data: roster = [] } = useClassRoster(classId);
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!classId && classes[0]) setClassId(classes[0].id);
  }, [classes, classId]);

  const { data: saved } = useQuery({
    queryKey: ["attendance", classId, date],
    enabled: !!classId,
    queryFn: async () => {
      const { data, error } = await supabase.from("attendance").select("student_id, status").eq("class_id", classId!).eq("date", date);
      if (error) throw error;
      return data as { student_id: string; status: AttendanceStatus }[];
    },
  });

  useEffect(() => {
    setMarks(Object.fromEntries((saved ?? []).map((r) => [r.student_id, r.status])));
  }, [saved]);

  const markAll = (status: AttendanceStatus) => setMarks(Object.fromEntries(roster.map((s) => [s.id, status])));

  const save = async () => {
    const rows = roster
      .filter((s) => marks[s.id])
      .map((s) => ({ school_id: school!.id, class_id: classId!, student_id: s.id, date, status: marks[s.id] }));
    if (rows.length < roster.length) return toast.error(`Mark all ${roster.length} students before saving`);
    setSaving(true);
    const { error } = await supabase.from("attendance").upsert(rows, { onConflict: "class_id,student_id,date" });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Attendance saved");
    qc.invalidateQueries({ queryKey: ["attendance", classId, date] });
    qc.invalidateQueries({ queryKey: ["attendance-today"] });
  };

  const counts = STATUSES.map((s) => ({ ...s, n: Object.values(marks).filter((m) => m === s.value).length }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Attendance</h1>
      {!isAdmin && !mine.isLoading && classes.length === 0 && (
        <p className="text-sm text-muted-foreground">
          You are not assigned to any class this year. An administrator can make you a homeroom or subject teacher in School setup.
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select value={classId} onValueChange={setClassId}>
          <SelectTrigger className="sm:w-48"><SelectValue placeholder="Select class" /></SelectTrigger>
          <SelectContent>{classes.map((c) => <SelectItem key={c.id} value={c.id}>{className(c)}</SelectItem>)}</SelectContent>
        </Select>
        <Input type="date" value={date} max={format(new Date(), "yyyy-MM-dd")} onChange={(e) => setDate(e.target.value)} className="sm:w-44" />
        <Button variant="outline" onClick={() => markAll("present")} disabled={!roster.length}>Mark all present</Button>
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        {counts.map((c) => <span key={c.value}><b className="tabular-nums">{c.n}</b> {c.label}</span>)}
        <span className="text-muted-foreground">of {roster.length}</span>
      </div>

      <Card>
        <CardContent className="divide-y p-0">
          {roster.length === 0 && <p className="p-4 text-sm text-muted-foreground">No students enrolled in this class.</p>}
          {roster.map((s, i) => (
            <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-2">
              <div className="min-w-0 truncate text-sm">
                <span className="mr-2 text-muted-foreground tabular-nums">{i + 1}.</span>
                {studentName(s)}
              </div>
              <div className="flex shrink-0 gap-1">
                {STATUSES.map((st) => (
                  <button
                    key={st.value}
                    title={st.label}
                    onClick={() => setMarks({ ...marks, [s.id]: st.value })}
                    className={cn(
                      "h-8 w-8 rounded-md border text-xs font-semibold",
                      marks[s.id] === st.value ? st.tone : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {st.short}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Button onClick={save} disabled={saving || !roster.length}>Save attendance</Button>
    </div>
  );
}
