import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { curriculum, supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { useClasses, useCurrentYear, useSubjects } from "@/hooks/useSchoolData";
import type { Subject } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NONE = "none";

// Subjects in the learning app, for linking a school subject to its curriculum at every grade.
function useCurriculumSubjects() {
  return useQuery({
    queryKey: ["curriculum-subjects"],
    enabled: !!curriculum,
    staleTime: 60 * 60_000,
    queryFn: async () => {
      const { data, error } = await curriculum!.from("subjects").select("subject_id, name").order("name");
      if (error) throw error;
      return data as { subject_id: string; name: string }[];
    },
  });
}

export default function SubjectList() {
  const { school } = useSchool();
  const qc = useQueryClient();
  const { data: subjects = [] } = useSubjects();
  const { data: curriculumSubjects = [] } = useCurriculumSubjects();
  const { data: year } = useCurrentYear();
  const { data: classes = [] } = useClasses(year?.id);
  const [f, setF] = useState({ name: "", code: "", periods: "", curriculum: NONE });
  const [applying, setApplying] = useState<{ subject: string; grade: string }>({ subject: "", grade: "" });
  const grades = [...new Set(classes.map((c) => c.grade_level))].sort((a, b) => a - b);
  const refresh = () => qc.invalidateQueries({ queryKey: ["subjects"] });

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("subjects").insert({
      school_id: school!.id, name: f.name.trim(), code: f.code.trim() || null,
      default_periods_per_week: f.periods === "" ? null : Number(f.periods),
      curriculum_subject_id: f.curriculum === NONE ? null : f.curriculum,
    });
    if (error) return toast.error(error.code === "23505" ? "That subject is already in the list" : error.message);
    setF({ name: "", code: "", periods: "", curriculum: NONE });
    refresh();
  };

  const update = async (s: Subject, patch: Partial<Subject>) => {
    const { error } = await supabase.from("subjects").update(patch).eq("id", s.id);
    if (error) return toast.error(error.message);
    refresh();
  };

  const remove = async (s: Subject) => {
    if (!confirm(`Remove ${s.name} from the list? Classes that teach it keep it, and its syllabus is deleted.`)) return;
    const { error } = await supabase.from("subjects").delete().eq("id", s.id);
    if (error) return toast.error(error.message);
    refresh();
  };

  // Adds the subject to every section of a grade this year; sections that already have it are left as they are.
  const applyToGrade = async () => {
    const s = subjects.find((x) => x.id === applying.subject);
    const grade = Number(applying.grade);
    const targets = classes.filter((c) => c.grade_level === grade);
    if (!s || !targets.length) return;
    let curriculumGradeId: string | null = null;
    if (s.curriculum_subject_id && curriculum) {
      const { data } = await curriculum.from("grades").select("grade_id").eq("subject_id", s.curriculum_subject_id).eq("grade_level", grade).maybeSingle();
      curriculumGradeId = (data?.grade_id as string | undefined) ?? null;
    }
    const { data, error } = await supabase.from("class_subjects").upsert(
      targets.map((c) => ({
        school_id: school!.id, class_id: c.id, subject_name: s.name, subject_id: s.id,
        periods_per_week: s.default_periods_per_week, curriculum_grade_id: curriculumGradeId,
      })),
      { onConflict: "class_id,subject_name", ignoreDuplicates: true },
    ).select("id");
    if (error) return toast.error(error.message);
    const added = data?.length ?? 0;
    toast.success(added ? `${s.name} added to ${added} class${added > 1 ? "es" : ""}` : `Every Grade ${grade} class already has ${s.name}`);
    qc.invalidateQueries({ queryKey: ["class_subjects"] });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">School subjects</CardTitle>
        <CardDescription>
          Define each subject once, then add it to all sections of a grade. Linking it to the learning-app subject
          connects every grade's curriculum automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="divide-y rounded-md border">
          {subjects.length === 0 && <p className="p-3 text-sm text-muted-foreground">No subjects yet.</p>}
          {subjects.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <span className="min-w-32 flex-1 font-medium">{s.name}</span>
              <Input key={`c-${s.id}-${s.code}`} className="h-8 w-20" placeholder="Code" aria-label={`${s.name} code`} defaultValue={s.code ?? ""}
                onBlur={(e) => e.target.value.trim() !== (s.code ?? "") && update(s, { code: e.target.value.trim() || null })} />
              <Input key={`p-${s.id}-${s.default_periods_per_week}`} className="h-8 w-20" inputMode="numeric" placeholder="/week" aria-label={`${s.name} periods per week`}
                defaultValue={s.default_periods_per_week ?? ""}
                onBlur={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  if (v !== s.default_periods_per_week) update(s, { default_periods_per_week: v });
                }} />
              {curriculum && (
                <Select value={s.curriculum_subject_id ?? NONE} onValueChange={(v) => update(s, { curriculum_subject_id: v === NONE ? null : v })}>
                  <SelectTrigger className="h-8 w-44" aria-label={`${s.name} learning-app subject`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not linked</SelectItem>
                    {curriculumSubjects.map((c) => <SelectItem key={c.subject_id} value={c.subject_id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <Button variant="ghost" size="icon" aria-label={`Remove ${s.name}`} onClick={() => remove(s)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>

        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label>New subject</Label><Input required placeholder="Mathematics" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="space-y-1"><Label>Code</Label><Input className="w-20" placeholder="MATH" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></div>
          <div className="space-y-1"><Label>Periods / week</Label><Input className="w-24" inputMode="numeric" value={f.periods} onChange={(e) => setF({ ...f, periods: e.target.value })} /></div>
          {curriculum && (
            <div className="space-y-1">
              <Label>Learning-app subject</Label>
              <Select value={f.curriculum} onValueChange={(v) => setF({ ...f, curriculum: v })}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not linked</SelectItem>
                  {curriculumSubjects.map((c) => <SelectItem key={c.subject_id} value={c.subject_id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button type="submit">Add</Button>
        </form>

        {subjects.length > 0 && (
          <div className="flex flex-wrap items-end gap-2 border-t pt-4">
            <div className="space-y-1">
              <Label>Add subject</Label>
              <Select value={applying.subject} onValueChange={(v) => setApplying({ ...applying, subject: v })}>
                <SelectTrigger className="w-44"><SelectValue placeholder="Subject" /></SelectTrigger>
                <SelectContent>{subjects.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>to every section of</Label>
              <Select value={applying.grade} onValueChange={(v) => setApplying({ ...applying, grade: v })}>
                <SelectTrigger className="w-32"><SelectValue placeholder={grades.length ? "Grade" : "No classes"} /></SelectTrigger>
                <SelectContent>{grades.map((g) => <SelectItem key={g} value={String(g)}>{g === 0 ? "KG" : `Grade ${g}`}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button variant="outline" disabled={!applying.subject || applying.grade === ""} onClick={applyToGrade}>Add to classes</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
