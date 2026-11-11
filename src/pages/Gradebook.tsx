import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Plus, Sparkles } from "lucide-react";
import { curriculum, supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { useClasses, useClassRoster, useClassSubjects, useCurrentYear, useMyAssignments, useTerms } from "@/hooks/useSchoolData";
import { className, isLearningKind, studentName, type Assessment, type AssessmentKind, type ClassSubject, type SchoolClass } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type ScoreMap = Record<string, Record<string, string>>; // assessment → student → score text

const KIND_LABEL: Record<AssessmentKind, string> = {
  quiz: "Quiz",
  test: "Test",
  assignment: "Assignment",
  midterm: "Mid-exam",
  final: "Final exam",
  learning_skill: "Learning-app skill",
  learning_exam: "Learning-app exam",
};

export default function Gradebook() {
  const { isAdmin, session } = useSchool();
  const { data: year } = useCurrentYear();
  const { data: allClasses = [] } = useClasses(year?.id);
  const mine = useMyAssignments(year?.id);
  const { data: terms = [] } = useTerms(year?.id);
  const [classId, setClassId] = useState<string>();
  const [subjectId, setSubjectId] = useState<string>();
  const [termId, setTermId] = useState<string>();
  const { data: classSubjects = [] } = useClassSubjects(classId);
  // Teachers only see the classes and subjects they teach.
  const classes = useMemo(
    () => (isAdmin ? allClasses : allClasses.filter((c) => mine.subjects.some((s) => s.class_id === c.id))),
    [isAdmin, allClasses, mine.subjects],
  );
  const subjects = useMemo(
    () => (isAdmin ? classSubjects : classSubjects.filter((s) => s.teacher_id === session?.user.id)),
    [isAdmin, classSubjects, session],
  );
  const cls = classes.find((c) => c.id === classId);
  const subject = subjects.find((s) => s.id === subjectId);

  useEffect(() => { if (!classId && classes[0]) setClassId(classes[0].id); }, [classes, classId]);
  useEffect(() => { setSubjectId(subjects[0]?.id); }, [subjects]);
  useEffect(() => { if (!termId && terms[0]) setTermId(terms[0].id); }, [terms, termId]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Gradebook</h1>
      {!isAdmin && !mine.isLoading && classes.length === 0 && (
        <p className="text-sm text-muted-foreground">
          You are not assigned to teach any subject this year. An administrator can assign you in School setup.
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select value={classId} onValueChange={setClassId}>
          <SelectTrigger className="sm:w-40"><SelectValue placeholder="Class" /></SelectTrigger>
          <SelectContent>{classes.map((c) => <SelectItem key={c.id} value={c.id}>{className(c)}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={subjectId} onValueChange={setSubjectId}>
          <SelectTrigger className="sm:w-48"><SelectValue placeholder="Subject" /></SelectTrigger>
          <SelectContent>{subjects.map((s) => <SelectItem key={s.id} value={s.id}>{s.subject_name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={termId} onValueChange={setTermId}>
          <SelectTrigger className="sm:w-40"><SelectValue placeholder="Term" /></SelectTrigger>
          <SelectContent>{terms.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {cls && subject ? (
        <GradeTable cls={cls} subject={subject} termId={termId} />
      ) : (
        <p className="text-sm text-muted-foreground">Pick a class and subject. Subjects are added under School setup.</p>
      )}
    </div>
  );
}

function GradeTable({ cls, subject, termId }: { cls: SchoolClass; subject: ClassSubject; termId?: string }) {
  const qc = useQueryClient();
  const { data: roster = [] } = useClassRoster(cls.id);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<ScoreMap>({});
  const [saving, setSaving] = useState(false);

  const { data: assessments = [] } = useQuery({
    queryKey: ["assessments", subject.id, termId],
    queryFn: async () => {
      let q = supabase.from("assessments").select("*").eq("class_subject_id", subject.id);
      if (termId) q = q.eq("term_id", termId);
      const { data, error } = await q.order("held_on", { nullsFirst: false }).order("created_at");
      if (error) throw error;
      return data as Assessment[];
    },
  });

  const { data: scores = [] } = useQuery({
    queryKey: ["scores", assessments.map((a) => a.id).join()],
    enabled: assessments.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("scores").select("assessment_id, student_id, score").in("assessment_id", assessments.map((a) => a.id));
      if (error) throw error;
      return data as { assessment_id: string; student_id: string; score: number | null }[];
    },
  });

  useEffect(() => {
    const next: ScoreMap = {};
    for (const s of scores) (next[s.assessment_id] ??= {})[s.student_id] = s.score?.toString() ?? "";
    setDraft(next);
  }, [scores]);

  const totalWeight = assessments.reduce((sum, a) => sum + Number(a.weight), 0);

  // Weighted total out of the summed weights (e.g. out of 100 when weights add to 100).
  const totals = useMemo(() => {
    const out: Record<string, number | null> = {};
    for (const s of roster) {
      let sum = 0, any = false;
      for (const a of assessments) {
        const v = draft[a.id]?.[s.id];
        if (v === undefined || v === "") continue;
        any = true;
        sum += (Number(v) / Number(a.max_score)) * Number(a.weight);
      }
      out[s.id] = any ? Math.round(sum * 10) / 10 : null;
    }
    return out;
  }, [draft, roster, assessments]);

  const setScore = (aid: string, sid: string, v: string) => setDraft({ ...draft, [aid]: { ...draft[aid], [sid]: v } });

  const save = async () => {
    const rows = assessments.flatMap((a) =>
      roster
        .filter((s) => draft[a.id]?.[s.id] !== undefined && draft[a.id][s.id] !== "")
        .map((s) => ({ school_id: cls.school_id, assessment_id: a.id, student_id: s.id, score: Number(draft[a.id][s.id]) })),
    );
    const bad = rows.find((r) => Number.isNaN(r.score) || r.score < 0 || r.score > Number(assessments.find((a) => a.id === r.assessment_id)!.max_score));
    if (bad) return toast.error("Each score must be a number between 0 and the assessment's maximum");
    setSaving(true);
    const { error } = await supabase.from("scores").upsert(rows, { onConflict: "assessment_id,student_id" });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Scores saved");
    qc.invalidateQueries({ queryKey: ["scores"] });
  };

  // Results live in the education project; importing them needs the server-side bridge (not built yet).
  const importFromLearningApp = () =>
    toast.info("Importing learning-app results arrives with the learning bridge. Enter scores by hand for now.");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          {assessments.length} assessments · weights total <b className={totalWeight === 100 ? "text-foreground" : "text-amber-600"}>{totalWeight}</b>
          {totalWeight !== 100 && assessments.length > 0 && " (usually 100)"}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setCreating(true)}><Plus className="mr-2 h-4 w-4" />Assessment</Button>
          <Button onClick={save} disabled={saving || !assessments.length}>Save scores</Button>
        </div>
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="sticky left-0 z-10 bg-muted/40 p-2 text-left font-medium">Student</th>
                {assessments.map((a) => (
                  <th key={a.id} className="min-w-[110px] p-2 text-left align-top font-medium">
                    <div className="leading-tight">{a.title}</div>
                    <div className="text-xs font-normal text-muted-foreground">/{a.max_score} · {a.weight}%</div>
                    {isLearningKind(a.kind) && (
                      <button className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline" onClick={importFromLearningApp}>
                        <Download className="h-3 w-3" />Import
                      </button>
                    )}
                  </th>
                ))}
                <th className="p-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {roster.length === 0 && (
                <tr><td colSpan={assessments.length + 2} className="p-4 text-center text-muted-foreground">No students enrolled.</td></tr>
              )}
              {roster.map((s) => (
                <tr key={s.id} className="border-b last:border-0">
                  <td className="sticky left-0 z-10 bg-card p-2 whitespace-nowrap">
                    {studentName(s)}
                    {s.learning_student_id && <Sparkles className="ml-1 inline h-3 w-3 text-primary" aria-label="Linked to learning app" />}
                  </td>
                  {assessments.map((a) => (
                    <td key={a.id} className="p-1">
                      <Input
                        inputMode="decimal"
                        className="h-8 w-20 tabular-nums"
                        value={draft[a.id]?.[s.id] ?? ""}
                        onChange={(e) => setScore(a.id, s.id, e.target.value)}
                      />
                    </td>
                  ))}
                  <td className="p-2 text-right font-semibold tabular-nums">{totals[s.id] ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <NewAssessmentDialog open={creating} onOpenChange={setCreating} cls={cls} subject={subject} termId={termId} />
    </div>
  );
}

function NewAssessmentDialog({ open, onOpenChange, cls, subject, termId }: {
  open: boolean; onOpenChange: (v: boolean) => void; cls: SchoolClass; subject: ClassSubject; termId?: string;
}) {
  const { school } = useSchool();
  const qc = useQueryClient();
  const [f, setF] = useState({ title: "", kind: "test" as AssessmentKind, max: "10", weight: "10", heldOn: "", dueOn: "", skillId: "", examId: "" });

  const { data: skills = [] } = useQuery({
    queryKey: ["curriculum-skills", subject.curriculum_grade_id],
    enabled: open && f.kind === "learning_skill" && !!subject.curriculum_grade_id && !!curriculum,
    queryFn: async () => {
      const { data, error } = await curriculum!
        .from("skills")
        .select("skill_id, name, code, topic!inner(name, unit!inner(name, grade_id))")
        .eq("topic.unit.grade_id", subject.curriculum_grade_id!)
        .order("name");
      if (error) throw error;
      return (data ?? []) as unknown as { skill_id: string; name: string; code: string | null; topic: { name: string; unit: { name: string } } }[];
    },
  });

  const { data: exams = [] } = useQuery({
    queryKey: ["curriculum-exams", cls.grade_level],
    enabled: open && f.kind === "learning_exam" && !!curriculum,
    queryFn: async () => {
      const { data, error } = await curriculum!
        .from("exam_sets")
        .select("id, title, subject_name, year")
        .eq("grade_level", cls.grade_level)
        .eq("is_published", true)
        .order("subject_name");
      if (error) throw error;
      return (data ?? []) as { id: string; title: string; subject_name: string; year: number | null }[];
    },
  });

  const submit = async () => {
    const skill = skills.find((s) => s.skill_id === f.skillId);
    const exam = exams.find((e) => e.id === f.examId);
    const title = f.title.trim() || skill?.name || exam?.title;
    if (!title) return toast.error("Give the assessment a title");
    if (f.kind === "learning_skill" && !f.skillId) return toast.error("Choose a skill");
    if (f.kind === "learning_exam" && !f.examId) return toast.error("Choose an exam set");
    const { error } = await supabase.from("assessments").insert({
      school_id: school!.id,
      class_subject_id: subject.id,
      term_id: termId ?? null,
      title,
      kind: f.kind,
      max_score: Number(f.max),
      weight: Number(f.weight),
      held_on: f.heldOn || null,
      due_on: f.dueOn || null,
      skill_id: f.kind === "learning_skill" ? f.skillId : null,
      exam_set_id: f.kind === "learning_exam" ? f.examId : null,
    });
    if (error) return toast.error(error.message);
    toast.success(isLearningKind(f.kind) ? "Assigned to the class" : "Assessment added");
    setF({ ...f, title: "", skillId: "", examId: "" });
    onOpenChange(false);
    qc.invalidateQueries({ queryKey: ["assessments", subject.id] });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New assessment · {subject.subject_name}</DialogTitle>
          <DialogDescription>Learning-app types record which skill or exam from the learning app the class should practise.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label>Type</Label>
            <Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v as AssessmentKind })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(KIND_LABEL) as AssessmentKind[]).map((k) => <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {f.kind === "learning_skill" && (
            <div className="space-y-1 sm:col-span-2">
              <Label>Skill</Label>
              {!subject.curriculum_grade_id ? (
                <p className="text-sm text-muted-foreground">Link this subject to the learning-app curriculum in School setup first.</p>
              ) : (
                <Select value={f.skillId} onValueChange={(v) => setF({ ...f, skillId: v })}>
                  <SelectTrigger><SelectValue placeholder={skills.length ? "Choose a skill" : "No skills found"} /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {skills.map((s) => (
                      <SelectItem key={s.skill_id} value={s.skill_id}>
                        {s.topic.unit.name} › {s.code ? `${s.code} ` : ""}{s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
          {f.kind === "learning_exam" && (
            <div className="space-y-1 sm:col-span-2">
              <Label>Exam set</Label>
              <Select value={f.examId} onValueChange={(v) => setF({ ...f, examId: v })}>
                <SelectTrigger><SelectValue placeholder={exams.length ? "Choose an exam" : "No exams for this grade"} /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {exams.map((e) => <SelectItem key={e.id} value={e.id}>{e.subject_name} · {e.title}{e.year ? ` (${e.year})` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1 sm:col-span-2">
            <Label>Title</Label>
            <Input placeholder={isLearningKind(f.kind) ? "Defaults to the skill or exam name" : "Quiz 1"} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Out of</Label>
            <Input inputMode="decimal" value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Weight (%)</Label>
            <Input inputMode="decimal" value={f.weight} onChange={(e) => setF({ ...f, weight: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>{isLearningKind(f.kind) ? "Assigned on" : "Date"}</Label>
            <Input type="date" value={f.heldOn} onChange={(e) => setF({ ...f, heldOn: e.target.value })} />
          </div>
          {isLearningKind(f.kind) && (
            <div className="space-y-1">
              <Label>Due</Label>
              <Input type="date" value={f.dueOn} onChange={(e) => setF({ ...f, dueOn: e.target.value })} />
            </div>
          )}
        </div>
        {!termId && <Badge variant="outline" className="w-fit">No term selected; add terms in School setup</Badge>}
        <Button onClick={submit}>{isLearningKind(f.kind) ? "Assign to class" : "Add assessment"}</Button>
      </DialogContent>
    </Dialog>
  );
}
