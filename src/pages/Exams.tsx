import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { useClasses, useCurrentYear, useStaffPeople, useTerms } from "@/hooks/useSchoolData";
import {
  className, examKindLabel, hhmm, type AssessmentKind, type ClassSubject, type ExamKind, type ExamPeriod, type ExamSitting,
} from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NONE = "none";
const ALL = "all";
const MINE = "mine";
const dayLabel = (d: string) => format(new Date(`${d}T00:00:00`), "EEEE d MMMM");
const assessmentKind: Record<ExamKind, AssessmentKind> = { midterm: "midterm", final: "final", mock: "test", other: "test" };

export default function Exams() {
  const { school, isAdmin } = useSchool();
  const qc = useQueryClient();
  const { data: year } = useCurrentYear();
  const { data: terms = [] } = useTerms(year?.id);
  const [periodId, setPeriodId] = useState<string>();
  const [f, setF] = useState({ name: "", kind: "final" as ExamKind, term: NONE, start: "", end: "" });

  const { data: periods = [] } = useQuery({
    queryKey: ["exam-periods", year?.id],
    enabled: !!year,
    queryFn: async () => {
      const { data, error } = await supabase.from("exam_periods").select("*").eq("academic_year_id", year!.id).order("starts_on");
      if (error) throw error;
      return data as ExamPeriod[];
    },
  });
  useEffect(() => {
    if (periodId && periods.some((p) => p.id === periodId)) return;
    const today = new Date().toISOString().slice(0, 10);
    setPeriodId((periods.find((p) => p.ends_on >= today) ?? periods[periods.length - 1])?.id);
  }, [periods, periodId]);
  const period = periods.find((p) => p.id === periodId);
  const refresh = () => qc.invalidateQueries({ queryKey: ["exam-periods"] });

  const addPeriod = async (e: FormEvent) => {
    e.preventDefault();
    const { data, error } = await supabase.from("exam_periods").insert({
      school_id: school!.id, academic_year_id: year!.id, name: f.name.trim(), kind: f.kind,
      term_id: f.term === NONE ? null : f.term, starts_on: f.start, ends_on: f.end,
    }).select().single();
    if (error) return toast.error(error.code === "23514" ? "The end date must be on or after the start" : error.message);
    setF({ name: "", kind: "final", term: NONE, start: "", end: "" });
    setPeriodId(data.id);
    refresh();
  };

  const updatePeriod = async (patch: Partial<ExamPeriod>) => {
    const { error } = await supabase.from("exam_periods").update(patch).eq("id", period!.id);
    if (error) return toast.error(error.message);
    refresh();
  };

  const deletePeriod = async () => {
    if (!period || !confirm(`Delete ${period.name} and its whole schedule? Gradebook columns already created stay.`)) return;
    const { error } = await supabase.from("exam_periods").delete().eq("id", period.id);
    if (error) return toast.error(error.message);
    setPeriodId(undefined);
    refresh();
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Exams</h1>

      <div className="flex flex-wrap items-center gap-2">
        {periods.map((p) => (
          <Button key={p.id} size="sm" variant={p.id === periodId ? "default" : "outline"} onClick={() => setPeriodId(p.id)}>
            {p.name}
          </Button>
        ))}
        {periods.length === 0 && <p className="text-sm text-muted-foreground">No exam periods this year.</p>}
      </div>

      {period && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">{period.name}</CardTitle>
                <CardDescription>
                  {examKindLabel[period.kind]} · {period.starts_on} to {period.ends_on}
                  {period.term_id && ` · ${terms.find((t) => t.id === period.term_id)?.name ?? ""}`}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={period.published ? "default" : "outline"}>{period.published ? "Published to families" : "Staff only"}</Badge>
                {isAdmin && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => updatePeriod({ published: !period.published })}>
                      {period.published ? "Unpublish" : "Publish"}
                    </Button>
                    <Button size="icon" variant="ghost" aria-label="Delete exam period" onClick={deletePeriod}><Trash2 className="h-4 w-4" /></Button>
                  </>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent><Schedule period={period} /></CardContent>
        </Card>
      )}

      {isAdmin && year && (
        <Card>
          <CardHeader><CardTitle className="text-base">New exam period</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={addPeriod} className="flex flex-wrap items-end gap-2">
              <div className="space-y-1"><Label>Name</Label><Input required placeholder="Semester 1 finals" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
              <div className="space-y-1">
                <Label>Kind</Label>
                <Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v as ExamKind })}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>{(Object.keys(examKindLabel) as ExamKind[]).map((k) => <SelectItem key={k} value={k}>{examKindLabel[k]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Term</Label>
                <Select value={f.term} onValueChange={(v) => setF({ ...f, term: v })}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {terms.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>From</Label><Input type="date" required value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></div>
              <div className="space-y-1"><Label>To</Label><Input type="date" required min={f.start} value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></div>
              <Button type="submit">Create</Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Schedule({ period }: { period: ExamPeriod }) {
  const { school, isAdmin, session } = useSchool();
  const qc = useQueryClient();
  const { data: classes = [] } = useClasses(period.academic_year_id);
  const { data: staff = [] } = useStaffPeople();
  const [filter, setFilter] = useState(ALL);

  const { data } = useQuery({
    queryKey: ["exam-sittings", period.id, classes.map((c) => c.id).join()],
    queryFn: async () => {
      const { data: sittings, error } = await supabase.from("exam_sittings").select("*").eq("exam_period_id", period.id)
        .order("date").order("starts_at");
      if (error) throw error;
      const ids = (sittings as ExamSitting[]).map((s) => s.id);
      const [inv, subs] = await Promise.all([
        ids.length ? supabase.from("exam_invigilators").select("sitting_id, user_id").in("sitting_id", ids) : Promise.resolve({ data: [], error: null }),
        supabase.from("class_subjects").select("*").in("class_id", classes.map((c) => c.id)).order("subject_name"),
      ]);
      const err = inv.error ?? subs.error;
      if (err) throw err;
      return {
        sittings: sittings as ExamSitting[],
        invigilators: (inv.data ?? []) as { sitting_id: string; user_id: string }[],
        subjects: (subs.data ?? []) as ClassSubject[],
      };
    },
    enabled: classes.length > 0,
  });
  const sittings = data?.sittings ?? [];
  const invigilators = data?.invigilators ?? [];
  const subjects = data?.subjects ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: ["exam-sittings", period.id] });

  const visible = sittings.filter((s) =>
    filter === ALL || (filter === MINE ? invigilators.some((i) => i.sitting_id === s.id && i.user_id === session?.user.id) : s.class_id === filter));
  const days = [...new Set(visible.map((s) => s.date))];
  const nameOf = (id: string) => staff.find((p) => p.userId === id)?.name ?? "Staff";

  const removeSitting = async (s: ExamSitting) => {
    if (!confirm("Remove this exam from the schedule?")) return;
    const { error } = await supabase.from("exam_sittings").delete().eq("id", s.id);
    if (error) return toast.error(error.message);
    refresh();
  };
  const addInvigilator = async (s: ExamSitting, userId: string) => {
    const { error } = await supabase.from("exam_invigilators").insert({ sitting_id: s.id, user_id: userId, school_id: school!.id });
    if (error) return toast.error(error.message);
    refresh();
  };
  const removeInvigilator = async (s: ExamSitting, userId: string) => {
    const { error } = await supabase.from("exam_invigilators").delete().eq("sitting_id", s.id).eq("user_id", userId);
    if (error) return toast.error(error.message);
    refresh();
  };

  return (
    <div className="space-y-4">
      <Select value={filter} onValueChange={setFilter}>
        <SelectTrigger className="sm:w-56"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All classes</SelectItem>
          <SelectItem value={MINE}>My invigilation</SelectItem>
          {classes.map((c) => <SelectItem key={c.id} value={c.id}>{className(c)}</SelectItem>)}
        </SelectContent>
      </Select>

      {visible.length === 0 && <p className="text-sm text-muted-foreground">Nothing scheduled{filter !== ALL ? " for this selection" : ""}.</p>}
      {days.map((d) => (
        <div key={d} className="space-y-1">
          <div className="text-sm font-medium">{dayLabel(d)}</div>
          <div className="divide-y rounded-md border text-sm">
            {visible.filter((s) => s.date === d).map((s) => {
              const cls = classes.find((c) => c.id === s.class_id);
              const subject = subjects.find((x) => x.id === s.class_subject_id);
              const mine = invigilators.filter((i) => i.sitting_id === s.id);
              return (
                <div key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
                  <span className="w-24 tabular-nums text-muted-foreground">{hhmm(s.starts_at)}–{hhmm(s.ends_at)}</span>
                  <span className="w-20">{cls ? className(cls) : ""}</span>
                  <span className="min-w-28 flex-1 font-medium">{subject?.subject_name}</span>
                  <span className="w-24 text-muted-foreground">{s.room ?? "No room"}</span>
                  <span className="flex flex-wrap items-center gap-1">
                    {mine.map((i) => (
                      <Badge key={i.user_id} variant="secondary" className="gap-1">
                        {nameOf(i.user_id)}
                        {isAdmin && (
                          <button aria-label={`Remove ${nameOf(i.user_id)}`} onClick={() => removeInvigilator(s, i.user_id)}><X className="h-3 w-3" /></button>
                        )}
                      </Badge>
                    ))}
                    {isAdmin && (
                      <Select value="" onValueChange={(v) => addInvigilator(s, v)}>
                        <SelectTrigger className="h-7 w-32 text-xs"><SelectValue placeholder="+ Invigilator" /></SelectTrigger>
                        <SelectContent>
                          {staff.filter((p) => !mine.some((i) => i.user_id === p.userId)).map((p) => <SelectItem key={p.userId} value={p.userId}>{p.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  </span>
                  {s.assessment_id && <Badge variant="outline">In gradebook</Badge>}
                  {isAdmin && <Button variant="ghost" size="icon" aria-label="Remove exam" onClick={() => removeSitting(s)}><Trash2 className="h-4 w-4" /></Button>}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {isAdmin && <SittingForm period={period} subjects={subjects} onSaved={refresh} />}
    </div>
  );
}

function SittingForm({ period, subjects, onSaved }: { period: ExamPeriod; subjects: ClassSubject[]; onSaved: () => void }) {
  const { school } = useSchool();
  const { data: classes = [] } = useClasses(period.academic_year_id);
  const [f, setF] = useState({
    classId: "", subjectId: "", date: period.starts_on, start: "08:30", end: "10:30", room: "",
    gradebook: true, max: "100", weight: period.kind === "final" ? "50" : "20",
  });
  const [busy, setBusy] = useState(false);
  const classSubjects = subjects.filter((s) => s.class_id === f.classId);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.subjectId) return toast.error("Choose a subject");
    setBusy(true);
    try {
      const { data: sitting, error } = await supabase.from("exam_sittings").insert({
        school_id: school!.id, exam_period_id: period.id, class_id: f.classId, class_subject_id: f.subjectId,
        date: f.date, starts_at: f.start, ends_at: f.end, room: f.room.trim() || null,
      }).select().single();
      if (error) throw error.code === "23505" ? new Error("This subject is already scheduled in this exam period") : error;
      if (f.gradebook) {
        const { data: assessment, error: aError } = await supabase.from("assessments").insert({
          school_id: school!.id, class_subject_id: f.subjectId, term_id: period.term_id, title: period.name,
          kind: assessmentKind[period.kind], max_score: Number(f.max), weight: Number(f.weight), held_on: f.date,
        }).select().single();
        if (aError) throw new Error(`Scheduled, but the gradebook column was not created: ${aError.message}`);
        await supabase.from("exam_sittings").update({ assessment_id: assessment.id }).eq("id", sitting.id);
      }
      toast.success("Exam scheduled");
      setF({ ...f, subjectId: "" });
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-3 rounded-md border p-3">
      <div className="text-sm font-medium">Schedule an exam</div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label>Class</Label>
          <Select value={f.classId} onValueChange={(v) => setF({ ...f, classId: v, subjectId: "" })}>
            <SelectTrigger className="w-32"><SelectValue placeholder="Class" /></SelectTrigger>
            <SelectContent>{classes.map((c) => <SelectItem key={c.id} value={c.id}>{className(c)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Subject</Label>
          <Select value={f.subjectId} onValueChange={(v) => setF({ ...f, subjectId: v })} disabled={!f.classId}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Subject" /></SelectTrigger>
            <SelectContent>{classSubjects.map((s) => <SelectItem key={s.id} value={s.id}>{s.subject_name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1"><Label>Date</Label><Input type="date" required min={period.starts_on} max={period.ends_on} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
        <div className="space-y-1"><Label>From</Label><Input type="time" required value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></div>
        <div className="space-y-1"><Label>To</Label><Input type="time" required value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></div>
        <div className="space-y-1"><Label>Room</Label><Input className="w-28" value={f.room} onChange={(e) => setF({ ...f, room: e.target.value })} /></div>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <Checkbox checked={f.gradebook} onCheckedChange={(v) => setF({ ...f, gradebook: v === true })} />
          Add a gradebook column for its marks
        </label>
        {f.gradebook && (
          <>
            <span className="flex items-center gap-1">out of <Input className="h-8 w-16" inputMode="decimal" value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} /></span>
            <span className="flex items-center gap-1">weight <Input className="h-8 w-16" inputMode="decimal" value={f.weight} onChange={(e) => setF({ ...f, weight: e.target.value })} />%</span>
          </>
        )}
      </div>
      <Button type="submit" size="sm" disabled={busy || !f.classId}>Add to schedule</Button>
      <p className="text-xs text-muted-foreground">The app refuses an exam when the class, room or an invigilator is already busy at that time.</p>
    </form>
  );
}
