import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { useClasses, useClassRoster, useCurrentYear, useMyAssignments } from "@/hooks/useSchoolData";
import {
  className, homeworkStateLabel, studentName,
  type ClassSubject, type Homework, type HomeworkState, type HomeworkStatus, type SchoolClass,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const TONE: Record<HomeworkState, string> = {
  done: "bg-emerald-600 text-white border-emerald-600",
  late: "bg-amber-500 text-white border-amber-500",
  missing: "bg-red-600 text-white border-red-600",
  excused: "bg-sky-600 text-white border-sky-600",
};

export default function HomeworkPage() {
  const { isAdmin } = useSchool();
  const { data: year } = useCurrentYear();
  const { data: classes = [] } = useClasses(year?.id);
  const mine = useMyAssignments(year?.id);
  const { data: allSubjects = [] } = useQuery({
    queryKey: ["year-subjects-all", year?.id, classes.map((c) => c.id).join()],
    enabled: isAdmin && classes.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("class_subjects").select("*").in("class_id", classes.map((c) => c.id));
      if (error) throw error;
      return data as ClassSubject[];
    },
  });
  const options = (isAdmin ? allSubjects : mine.subjects)
    .map((s) => ({ s, cls: classes.find((c) => c.id === s.class_id) }))
    .filter((o): o is { s: ClassSubject; cls: SchoolClass } => !!o.cls)
    .sort((a, b) => a.cls.grade_level - b.cls.grade_level || a.cls.section.localeCompare(b.cls.section) || a.s.subject_name.localeCompare(b.s.subject_name));
  const [csId, setCsId] = useState<string>();
  useEffect(() => { if (!csId && options[0]) setCsId(options[0].s.id); }, [options, csId]);
  const current = options.find((o) => o.s.id === csId);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Homework</h1>
      <Select value={csId} onValueChange={setCsId}>
        <SelectTrigger className="sm:w-72"><SelectValue placeholder={options.length ? "Class and subject" : "No subjects assigned to you"} /></SelectTrigger>
        <SelectContent>{options.map((o) => <SelectItem key={o.s.id} value={o.s.id}>{className(o.cls)} · {o.s.subject_name}</SelectItem>)}</SelectContent>
      </Select>
      {current && <SubjectHomework key={current.s.id} cs={current.s} cls={current.cls} />}
    </div>
  );
}

function SubjectHomework({ cs, cls }: { cs: ClassSubject; cls: SchoolClass }) {
  const { school } = useSchool();
  const qc = useQueryClient();
  const [f, setF] = useState({ title: "", instructions: "", due: "" });
  const [marking, setMarking] = useState<Homework | null>(null);
  const { data: homework = [] } = useQuery({
    queryKey: ["homework", cs.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("homework").select("*").eq("class_subject_id", cs.id).order("assigned_on", { ascending: false });
      if (error) throw error;
      return data as Homework[];
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["homework", cs.id] });

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("homework").insert({
      school_id: school!.id, class_subject_id: cs.id, title: f.title.trim(), instructions: f.instructions.trim() || null, due_on: f.due || null,
    });
    if (error) return toast.error(error.code === "23514" ? "The due date can't be before today" : error.message);
    toast.success(`Set for ${className(cls)}. Families can see it now.`);
    setF({ title: "", instructions: "", due: "" });
    refresh();
  };

  const remove = async (h: Homework) => {
    if (!confirm(`Delete "${h.title}" and its marks?`)) return;
    const { error } = await supabase.from("homework").delete().eq("id", h.id);
    if (error) return toast.error(error.message);
    if (marking?.id === h.id) setMarking(null);
    refresh();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Set homework</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={add} className="grid gap-3 sm:grid-cols-[1fr_180px]">
            <div className="space-y-1"><Label>Title</Label><Input required placeholder="Exercise 3.1, questions 1–10" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
            <div className="space-y-1"><Label>Due</Label><Input type="date" min={new Date().toISOString().slice(0, 10)} value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Instructions</Label>
              <textarea className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} />
            </div>
            <div><Button type="submit">Set homework</Button></div>
          </form>
        </CardContent>
      </Card>

      {homework.length === 0 && <p className="text-sm text-muted-foreground">No homework set yet.</p>}
      {homework.length > 0 && (
        <div className="divide-y rounded-md border text-sm">
          {homework.map((h) => (
            <div key={h.id} className={cn("flex flex-wrap items-center justify-between gap-2 px-4 py-2", marking?.id === h.id && "bg-accent")}>
              <div>
                <div className="font-medium">{h.title}</div>
                <div className="text-xs text-muted-foreground">Set {h.assigned_on}{h.due_on && ` · due ${h.due_on}`}</div>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => setMarking(h)}>Mark</Button>
                <Button size="icon" variant="ghost" aria-label={`Delete ${h.title}`} onClick={() => remove(h)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {marking && <MarkHomework key={marking.id} homework={marking} cls={cls} />}
    </div>
  );
}

function MarkHomework({ homework, cls }: { homework: Homework; cls: SchoolClass }) {
  const { school } = useSchool();
  const qc = useQueryClient();
  const { data: roster = [] } = useClassRoster(cls.id);
  const [marks, setMarks] = useState<Record<string, HomeworkState>>({});
  const [busy, setBusy] = useState(false);
  const { data: saved } = useQuery({
    queryKey: ["homework-status", homework.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("homework_status").select("*").eq("homework_id", homework.id);
      if (error) throw error;
      return data as HomeworkStatus[];
    },
  });
  useEffect(() => { setMarks(Object.fromEntries((saved ?? []).map((s) => [s.student_id, s.status]))); }, [saved]);

  const save = async () => {
    const rows = Object.entries(marks).map(([student_id, status]) => ({ homework_id: homework.id, student_id, school_id: school!.id, status }));
    if (!rows.length) return toast.error("Mark at least one student");
    setBusy(true);
    const { error } = await supabase.from("homework_status").upsert(rows, { onConflict: "homework_id,student_id" });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Saved ${rows.length} of ${roster.length}`);
    qc.invalidateQueries({ queryKey: ["homework-status", homework.id] });
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">{homework.title}</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setMarks(Object.fromEntries(roster.map((s) => [s.id, marks[s.id] ?? "done"])))}>Mark the rest done</Button>
      </CardHeader>
      <CardContent className="space-y-3 p-0">
        <div className="divide-y">
          {roster.length === 0 && <p className="p-4 text-sm text-muted-foreground">No students in this class.</p>}
          {roster.map((s, i) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
              <span><span className="mr-2 tabular-nums text-muted-foreground">{i + 1}.</span>{studentName(s)}</span>
              <div className="flex gap-1">
                {(Object.keys(homeworkStateLabel) as HomeworkState[]).map((st) => (
                  <button key={st} onClick={() => setMarks({ ...marks, [s.id]: st })}
                    className={cn("h-8 rounded-md border px-2 text-xs font-medium", marks[s.id] === st ? TONE[st] : "text-muted-foreground hover:bg-muted")}>
                    {homeworkStateLabel[st]}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="px-4 pb-4"><Button onClick={save} disabled={busy || !roster.length}>Save marks</Button></div>
      </CardContent>
    </Card>
  );
}
