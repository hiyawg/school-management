import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Trash2 } from "lucide-react";
import { curriculum, supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { useClasses, useCurrentYear, useMyAssignments, useSubjects, useTeachers } from "@/hooks/useSchoolData";
import {
  className, type ClassSubject, type LessonPlan, type LessonStatus, type SchoolClass, type SyllabusTopic, type SyllabusUnit,
} from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const NONE = "none";
const gradeLabel = (g: number) => (g === 0 ? "KG" : `Grade ${g}`);
// "Unit 10" after "Unit 9", not after "Unit 1".
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

function useSyllabus(subjectId: string | undefined, grade: number | undefined) {
  const { school } = useSchool();
  return useQuery({
    queryKey: ["syllabus", subjectId, grade],
    enabled: !!school && !!subjectId && grade !== undefined,
    queryFn: async () => {
      const { data: units, error } = await supabase.from("syllabus_units").select("*")
        .eq("school_id", school!.id).eq("subject_id", subjectId!).eq("grade_level", grade!).order("position");
      if (error) throw error;
      const ids = (units as SyllabusUnit[]).map((u) => u.id);
      const { data: topics, error: topicError } = ids.length
        ? await supabase.from("syllabus_topics").select("*").in("unit_id", ids).order("position")
        : { data: [], error: null };
      if (topicError) throw topicError;
      return { units: units as SyllabusUnit[], topics: (topics ?? []) as SyllabusTopic[] };
    },
  });
}

export default function Syllabus() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Syllabus and lessons</h1>
      <Tabs defaultValue="lessons">
        <TabsList>
          <TabsTrigger value="lessons">Lesson plans</TabsTrigger>
          <TabsTrigger value="syllabus">Syllabus</TabsTrigger>
          <TabsTrigger value="coverage">Coverage</TabsTrigger>
        </TabsList>
        <TabsContent value="lessons"><Lessons /></TabsContent>
        <TabsContent value="syllabus"><SyllabusEditor /></TabsContent>
        <TabsContent value="coverage"><Coverage /></TabsContent>
      </Tabs>
    </div>
  );
}

// Syllabus --------------------------------------------------------------------

function SyllabusEditor() {
  const { school, isAdmin } = useSchool();
  const qc = useQueryClient();
  const { data: subjects = [] } = useSubjects();
  const { data: year } = useCurrentYear();
  const { data: classes = [] } = useClasses(year?.id);
  const mine = useMyAssignments(year?.id);
  const [subjectId, setSubjectId] = useState<string>();
  const [grade, setGrade] = useState<number>();
  const { data } = useSyllabus(subjectId, grade);
  const units = useMemo(() => [...(data?.units ?? [])].sort((a, b) => a.position - b.position || natural(a.title, b.title)), [data]);
  const topics = data?.topics ?? [];
  const [unitTitle, setUnitTitle] = useState("");
  const [importing, setImporting] = useState(false);

  // Teachers start on a subject and grade they teach.
  useEffect(() => {
    if (subjectId || !mine.subjects.length) return;
    const first = mine.subjects.find((s) => s.subject_id);
    const cls = first && classes.find((c) => c.id === first.class_id);
    if (first?.subject_id && cls) { setSubjectId(first.subject_id); setGrade(cls.grade_level); }
  }, [mine.subjects, classes, subjectId]);

  const subject = subjects.find((s) => s.id === subjectId);
  const canEdit = isAdmin || mine.subjects.some((s) => s.subject_id === subjectId && classes.find((c) => c.id === s.class_id)?.grade_level === grade);
  const refresh = () => qc.invalidateQueries({ queryKey: ["syllabus", subjectId, grade] });

  const addUnit = async (e: FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("syllabus_units").insert({
      school_id: school!.id, subject_id: subjectId, grade_level: grade, title: unitTitle.trim(), position: units.length + 1,
    });
    if (error) return toast.error(error.message);
    setUnitTitle("");
    refresh();
  };

  // Copies the learning app's units and topics for this subject and grade; already imported ones are skipped.
  const importCurriculum = async () => {
    if (!curriculum || !subject?.curriculum_subject_id || grade === undefined) return;
    setImporting(true);
    try {
      const { data: g, error: gError } = await curriculum.from("grades").select("grade_id")
        .eq("subject_id", subject.curriculum_subject_id).eq("grade_level", grade).maybeSingle();
      if (gError) throw gError;
      if (!g) throw new Error(`The learning app has no ${subject.name} curriculum for ${gradeLabel(grade)}`);
      const { data: cUnits, error: uError } = await curriculum.from("unit").select("unit_id, name, description").eq("grade_id", g.grade_id);
      if (uError) throw uError;
      const { data: cTopics, error: tError } = cUnits?.length
        ? await curriculum.from("topic").select("topic_id, unit_id, name, created_at").in("unit_id", cUnits.map((u) => u.unit_id))
        : { data: [], error: null };
      if (tError) throw tError;
      const have = new Set(units.map((u) => u.curriculum_unit_id));
      const sorted = [...(cUnits ?? [])].sort((a, b) => natural(a.name, b.name));
      let added = 0;
      for (const [i, u] of sorted.entries()) {
        if (have.has(u.unit_id)) continue;
        const { data: unit, error } = await supabase.from("syllabus_units").insert({
          school_id: school!.id, subject_id: subjectId, grade_level: grade, title: u.name, description: u.description,
          position: units.length + i + 1, curriculum_unit_id: u.unit_id,
        }).select().single();
        if (error) throw error;
        // The learning app has no topic order; topics were entered in textbook order, so creation time is the best guide.
        const unitTopics = (cTopics ?? []).filter((t) => t.unit_id === u.unit_id)
          .sort((a, b) => (a.created_at as string).localeCompare(b.created_at as string) || natural(a.name, b.name));
        if (unitTopics.length) {
          const { error: topicError } = await supabase.from("syllabus_topics").insert(unitTopics.map((t, j) => ({
            school_id: school!.id, unit_id: unit.id, title: t.name, position: j + 1, curriculum_topic_id: t.topic_id,
          })));
          if (topicError) throw topicError;
        }
        added++;
      }
      toast.success(added ? `Imported ${added} unit${added > 1 ? "s" : ""}` : "Everything is already imported");
      refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select value={subjectId} onValueChange={setSubjectId}>
          <SelectTrigger className="sm:w-48"><SelectValue placeholder="Subject" /></SelectTrigger>
          <SelectContent>{subjects.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={grade?.toString()} onValueChange={(v) => setGrade(Number(v))}>
          <SelectTrigger className="sm:w-36"><SelectValue placeholder="Grade" /></SelectTrigger>
          <SelectContent>{Array.from({ length: 13 }, (_, g) => <SelectItem key={g} value={String(g)}>{gradeLabel(g)}</SelectItem>)}</SelectContent>
        </Select>
        {canEdit && subject?.curriculum_subject_id && curriculum && grade !== undefined && (
          <Button variant="outline" onClick={importCurriculum} disabled={importing}>
            <Download className="mr-2 h-4 w-4" /> {importing ? "Importing…" : "Import from learning app"}
          </Button>
        )}
      </div>
      {subjects.length === 0 && <p className="text-sm text-muted-foreground">Add subjects to the school list in School setup first.</p>}
      {subjectId && grade !== undefined && (
        <>
          {units.length === 0 && <p className="text-sm text-muted-foreground">No units yet.{canEdit && " Add one below, or import from the learning app if the subject is linked."}</p>}
          {units.map((u, i) => (
            <UnitCard key={u.id} unit={u} number={i + 1} topics={topics.filter((t) => t.unit_id === u.id)} canEdit={canEdit} onChange={refresh} />
          ))}
          {canEdit && (
            <form onSubmit={addUnit} className="flex flex-wrap gap-2">
              <Input className="sm:w-80" required placeholder="Unit title" value={unitTitle} onChange={(e) => setUnitTitle(e.target.value)} />
              <Button type="submit" variant="outline">Add unit</Button>
            </form>
          )}
          {!canEdit && <p className="text-xs text-muted-foreground">Administrators and teachers of {subject?.name} in {gradeLabel(grade)} can edit this syllabus.</p>}
        </>
      )}
    </div>
  );
}

function UnitCard({ unit, number, topics, canEdit, onChange }: {
  unit: SyllabusUnit; number: number; topics: SyllabusTopic[]; canEdit: boolean; onChange: () => void;
}) {
  const { school } = useSchool();
  const [title, setTitle] = useState("");
  const sorted = [...topics].sort((a, b) => a.position - b.position || natural(a.title, b.title));
  const planned = topics.reduce((n, t) => n + (t.planned_periods ?? 0), 0);

  const act = async (op: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await op;
    if (error) return toast.error(error.message);
    onChange();
  };

  return (
    <Card>
      <CardContent className="space-y-2 p-4 text-sm">
        <div className="flex items-center justify-between gap-2">
          {canEdit ? (
            <Input key={unit.title} className="h-8 font-medium" defaultValue={unit.title} aria-label={`Unit ${number} title`}
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== unit.title && act(supabase.from("syllabus_units").update({ title: e.target.value.trim() }).eq("id", unit.id))} />
          ) : <div className="font-medium">{unit.title}</div>}
          <span className="shrink-0 text-xs text-muted-foreground">{topics.length} topics{planned ? ` · ${planned} periods` : ""}</span>
          {canEdit && (
            <Button variant="ghost" size="icon" aria-label={`Delete ${unit.title}`}
              onClick={() => confirm(`Delete ${unit.title} and its topics? Lesson plans keep their text but lose the topic link.`)
                && act(supabase.from("syllabus_units").delete().eq("id", unit.id))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
        <ol className="space-y-1 pl-1">
          {sorted.map((t, i) => (
            <li key={t.id} className="flex items-center gap-2">
              <span className="w-8 shrink-0 tabular-nums text-muted-foreground">{number}.{i + 1}</span>
              {canEdit ? (
                <>
                  <Input key={t.title} className="h-8" defaultValue={t.title} aria-label="Topic title"
                    onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== t.title && act(supabase.from("syllabus_topics").update({ title: e.target.value.trim() }).eq("id", t.id))} />
                  <Input key={`p${t.planned_periods}`} className="h-8 w-20" inputMode="numeric" placeholder="periods" aria-label={`${t.title} planned periods`}
                    defaultValue={t.planned_periods ?? ""}
                    onBlur={(e) => {
                      const v = e.target.value === "" ? null : Number(e.target.value);
                      if (v !== t.planned_periods) act(supabase.from("syllabus_topics").update({ planned_periods: v }).eq("id", t.id));
                    }} />
                  <Button variant="ghost" size="icon" aria-label={`Delete ${t.title}`} onClick={() => act(supabase.from("syllabus_topics").delete().eq("id", t.id))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <span className="flex-1">{t.title}{t.planned_periods ? <span className="text-muted-foreground"> · {t.planned_periods} periods</span> : null}</span>
              )}
            </li>
          ))}
        </ol>
        {canEdit && (
          <form className="flex gap-2 pl-10" onSubmit={(e) => {
            e.preventDefault();
            act(supabase.from("syllabus_topics").insert({ school_id: school!.id, unit_id: unit.id, title: title.trim(), position: topics.length + 1 }));
            setTitle("");
          }}>
            <Input className="h-8" required placeholder="New topic" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Button type="submit" size="sm" variant="outline">Add</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

// Lesson plans --------------------------------------------------------------------

function Lessons() {
  const { isAdmin, session } = useSchool();
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
  const canEdit = !!current && (isAdmin || current.s.teacher_id === session?.user.id);

  return (
    <div className="space-y-4">
      <Select value={csId} onValueChange={setCsId}>
        <SelectTrigger className="sm:w-72"><SelectValue placeholder={options.length ? "Class and subject" : "No subjects assigned to you"} /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.s.id} value={o.s.id}>{className(o.cls)} · {o.s.subject_name}</SelectItem>)}
        </SelectContent>
      </Select>
      {current && <LessonList cs={current.s} cls={current.cls} canEdit={canEdit} />}
    </div>
  );
}

const STATUS: Record<LessonStatus, { label: string; variant: "default" | "secondary" | "outline" }> = {
  planned: { label: "Planned", variant: "outline" },
  taught: { label: "Taught", variant: "default" },
  skipped: { label: "Skipped", variant: "secondary" },
};

function LessonList({ cs, cls, canEdit }: { cs: ClassSubject; cls: SchoolClass; canEdit: boolean }) {
  const qc = useQueryClient();
  const { data: syllabus } = useSyllabus(cs.subject_id ?? undefined, cls.grade_level);
  const [editing, setEditing] = useState<LessonPlan | "new" | null>(null);
  const { data: lessons = [] } = useQuery({
    queryKey: ["lessons", cs.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("lesson_plans").select("*").eq("class_subject_id", cs.id)
        .order("planned_on", { ascending: false, nullsFirst: true });
      if (error) throw error;
      return data as LessonPlan[];
    },
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["lessons", cs.id] });
    qc.invalidateQueries({ queryKey: ["coverage"] });
  };
  const units = syllabus?.units ?? [];
  const topics = syllabus?.topics ?? [];
  const topicLabel = (id: string | null) => {
    const t = topics.find((x) => x.id === id);
    const u = t && units.find((x) => x.id === t.unit_id);
    return t ? `${u ? `${u.title} › ` : ""}${t.title}` : null;
  };
  const taughtTopics = new Set(lessons.filter((l) => l.status === "taught" && l.topic_id).map((l) => l.topic_id));

  const setStatus = async (l: LessonPlan, status: LessonStatus) => {
    const { error } = await supabase.from("lesson_plans").update({
      status, taught_on: status === "taught" ? l.taught_on ?? new Date().toISOString().slice(0, 10) : null,
    }).eq("id", l.id);
    if (error) return toast.error(error.message);
    refresh();
  };

  return (
    <div className="space-y-3">
      <div className="text-sm text-muted-foreground">
        {topics.length > 0
          ? <>Syllabus coverage: <b className="text-foreground">{taughtTopics.size} of {topics.length}</b> topics taught</>
          : "No syllabus for this subject and grade yet. Lessons can still be planned without a topic."}
      </div>
      {canEdit && editing === null && <Button size="sm" onClick={() => setEditing("new")}>Plan a lesson</Button>}
      {editing && (
        <LessonForm key={editing === "new" ? "new" : editing.id} cs={cs} lesson={editing === "new" ? undefined : editing}
          units={units} topics={topics} taught={taughtTopics} onDone={() => { setEditing(null); refresh(); }} />
      )}
      {lessons.length === 0 && <p className="text-sm text-muted-foreground">No lessons yet.</p>}
      {lessons.length > 0 && <div className="divide-y rounded-md border text-sm">
        {lessons.map((l) => (
          <div key={l.id} className="space-y-1 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-medium">{l.title}</span>
                <span className="text-muted-foreground"> · {l.status === "taught" ? `taught ${l.taught_on}` : l.planned_on ?? "no date"}</span>
              </div>
              <div className="flex items-center gap-1">
                <Badge variant={STATUS[l.status].variant}>{STATUS[l.status].label}</Badge>
                {canEdit && l.status !== "taught" && <Button size="sm" variant="ghost" onClick={() => setStatus(l, "taught")}>Mark taught</Button>}
                {canEdit && l.status === "planned" && <Button size="sm" variant="ghost" onClick={() => setStatus(l, "skipped")}>Skip</Button>}
                {canEdit && l.status !== "planned" && <Button size="sm" variant="ghost" onClick={() => setStatus(l, "planned")}>Undo</Button>}
                {canEdit && <Button size="sm" variant="ghost" onClick={() => setEditing(l)}>Edit</Button>}
              </div>
            </div>
            {topicLabel(l.topic_id) && <div className="text-xs text-muted-foreground">{topicLabel(l.topic_id)}</div>}
            {l.objectives && <div><span className="text-muted-foreground">Objectives:</span> {l.objectives}</div>}
            {l.activities && <div><span className="text-muted-foreground">Activities:</span> {l.activities}</div>}
            {l.homework && <div><span className="text-muted-foreground">Homework:</span> {l.homework}</div>}
            {l.notes && <div><span className="text-muted-foreground">Notes:</span> {l.notes}</div>}
          </div>
        ))}
      </div>}
    </div>
  );
}

function LessonForm({ cs, lesson, units, topics, taught, onDone }: {
  cs: ClassSubject; lesson?: LessonPlan; units: SyllabusUnit[]; topics: SyllabusTopic[]; taught: Set<string | null>; onDone: () => void;
}) {
  const { school } = useSchool();
  const [f, setF] = useState({
    topic: lesson?.topic_id ?? NONE, date: lesson?.planned_on ?? "", title: lesson?.title ?? "",
    objectives: lesson?.objectives ?? "", activities: lesson?.activities ?? "", homework: lesson?.homework ?? "", notes: lesson?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const sortedUnits = [...units].sort((a, b) => a.position - b.position || natural(a.title, b.title));

  const pickTopic = (id: string) => {
    const t = topics.find((x) => x.id === id);
    setF({ ...f, topic: id, title: f.title || t?.title || "" });
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const row = {
      topic_id: f.topic === NONE ? null : f.topic, planned_on: f.date || null, title: f.title.trim(),
      objectives: f.objectives.trim() || null, activities: f.activities.trim() || null,
      homework: f.homework.trim() || null, notes: f.notes.trim() || null,
    };
    const { error } = lesson
      ? await supabase.from("lesson_plans").update(row).eq("id", lesson.id)
      : await supabase.from("lesson_plans").insert({ ...row, school_id: school!.id, class_subject_id: cs.id });
    setBusy(false);
    if (error) return toast.error(error.message);
    onDone();
  };

  const remove = async () => {
    if (!lesson || !confirm("Delete this lesson plan?")) return;
    const { error } = await supabase.from("lesson_plans").delete().eq("id", lesson.id);
    if (error) return toast.error(error.message);
    onDone();
  };

  return (
    <form onSubmit={save} className="grid gap-3 rounded-md border p-3 sm:grid-cols-3">
      <div className="space-y-1 sm:col-span-2">
        <Label>Topic</Label>
        <Select value={f.topic} onValueChange={pickTopic}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>No topic</SelectItem>
            {sortedUnits.flatMap((u) =>
              topics.filter((t) => t.unit_id === u.id).sort((a, b) => a.position - b.position).map((t) => (
                <SelectItem key={t.id} value={t.id}>{taught.has(t.id) ? "✓ " : ""}{u.title} › {t.title}</SelectItem>
              )))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1"><Label>Date</Label><Input type="date" value={f.date} onChange={set("date")} /></div>
      <div className="space-y-1 sm:col-span-3"><Label>Title</Label><Input required value={f.title} onChange={set("title")} /></div>
      <div className="space-y-1 sm:col-span-3"><Label>Objectives</Label><Input placeholder="Students will be able to…" value={f.objectives} onChange={set("objectives")} /></div>
      <div className="space-y-1 sm:col-span-3"><Label>Activities</Label><Input value={f.activities} onChange={set("activities")} /></div>
      <div className="space-y-1 sm:col-span-2"><Label>Homework</Label><Input value={f.homework} onChange={set("homework")} /></div>
      <div className="space-y-1"><Label>Notes</Label><Input value={f.notes} onChange={set("notes")} /></div>
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" size="sm" disabled={busy}>Save</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
        {lesson && <Button type="button" size="sm" variant="ghost" className="ml-auto text-destructive" onClick={remove}>Delete</Button>}
      </div>
    </form>
  );
}

// Coverage -----------------------------------------------------------------------

function Coverage() {
  const { school } = useSchool();
  const { data: year } = useCurrentYear();
  const { data: classes = [] } = useClasses(year?.id);
  const { data: teachers = [] } = useTeachers();
  const { data: rows = [] } = useQuery({
    queryKey: ["coverage", school?.id, classes.map((c) => c.id).join()],
    enabled: classes.length > 0,
    queryFn: async () => {
      const [cov, subs] = await Promise.all([
        supabase.from("syllabus_coverage").select("*").in("class_id", classes.map((c) => c.id)),
        supabase.from("class_subjects").select("*").in("class_id", classes.map((c) => c.id)),
      ]);
      const err = cov.error ?? subs.error;
      if (err) throw err;
      return (subs.data as ClassSubject[]).map((s) => {
        const c = (cov.data ?? []).find((x) => x.class_subject_id === s.id);
        return { s, topics: Number(c?.topics ?? 0), taught: Number(c?.topics_taught ?? 0), lessons: Number(c?.lessons_taught ?? 0) };
      });
    },
  });
  const teacherName = (id: string | null) => {
    const t = teachers.find((x) => x.user_id === id);
    return t?.full_name ?? t?.email ?? (id ? "Teacher" : "No teacher");
  };

  return (
    <Card>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-4 py-2 font-normal">Class</th>
              <th className="px-2 py-2 font-normal">Subject</th>
              <th className="px-2 py-2 font-normal">Teacher</th>
              <th className="px-2 py-2 text-right font-normal">Lessons taught</th>
              <th className="px-4 py-2 font-normal">Topics covered</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">No subjects this year</td></tr>}
            {[...rows]
              .map((r) => ({ ...r, cls: classes.find((c) => c.id === r.s.class_id)! }))
              .sort((a, b) => a.cls.grade_level - b.cls.grade_level || a.cls.section.localeCompare(b.cls.section) || a.s.subject_name.localeCompare(b.s.subject_name))
              .map((r) => {
                const pct = r.topics ? Math.round((r.taught / r.topics) * 100) : null;
                return (
                  <tr key={r.s.id} className="border-b last:border-0">
                    <td className="px-4 py-2">{className(r.cls)}</td>
                    <td className="px-2 py-2">{r.s.subject_name}</td>
                    <td className="px-2 py-2 text-muted-foreground">{teacherName(r.s.teacher_id)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.lessons}</td>
                    <td className="px-4 py-2">
                      {pct === null ? <span className="text-xs text-muted-foreground">No syllabus</span> : (
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-28 overflow-hidden rounded bg-muted">
                            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="tabular-nums">{r.taught}/{r.topics}</span>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
