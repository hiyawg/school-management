import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { curriculum, supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { useClasses, useClassSubjects, useCurrentYear, useSubjects, useTeachers, useTerms, useYears } from "@/hooks/useSchoolData";
import { className, type Member, type SchoolClass, type Term } from "@/lib/types";
import SubjectList from "@/components/SubjectList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NONE = "none";

export default function Setup() {
  const { school } = useSchool();
  const qc = useQueryClient();
  const { data: years = [] } = useYears();
  const { data: year } = useCurrentYear();
  const { data: terms = [] } = useTerms(year?.id);
  const { data: classes = [] } = useClasses(year?.id);
  const { data: teachers = [] } = useTeachers();

  const [yearName, setYearName] = useState("");
  const [yearStart, setYearStart] = useState("");
  const [yearEnd, setYearEnd] = useState("");
  const [term, setTerm] = useState({ name: "", start: "", end: "" });
  const [grade, setGrade] = useState("1");
  const [section, setSection] = useState("A");
  const [homeroom, setHomeroom] = useState(NONE);
  const [selectedClass, setSelectedClass] = useState<SchoolClass | null>(null);

  const run = async (op: PromiseLike<{ error: { message: string } | null }>, ok: string, keys: unknown[][]) => {
    const { error } = await op;
    if (error) return toast.error(error.message);
    toast.success(ok);
    keys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
  };

  const addYear = async () => {
    if (!yearName.trim()) return;
    if (years.length) await supabase.from("academic_years").update({ is_current: false }).eq("school_id", school!.id);
    await run(
      supabase.from("academic_years").insert({
        school_id: school!.id, name: yearName.trim(), is_current: true, starts_on: yearStart || null, ends_on: yearEnd || null,
      }),
      "Academic year added",
      [["years"]],
    );
    setYearName("");
    setYearStart("");
    setYearEnd("");
  };

  const setYearDate = (field: "starts_on" | "ends_on", value: string) =>
    run(supabase.from("academic_years").update({ [field]: value || null }).eq("id", year!.id), "Year dates saved", [["years"]]);

  const makeCurrent = async (id: string) => {
    await supabase.from("academic_years").update({ is_current: false }).eq("school_id", school!.id);
    await run(supabase.from("academic_years").update({ is_current: true }).eq("id", id), "Current year changed", [["years"]]);
  };

  const teacherName = (id: string | null) => teacherOptions(teachers).find((t) => t.userId === id)?.name ?? "—";

  // Open the first class so its subjects and teachers are visible without hunting for them.
  useEffect(() => {
    if (!classes.length) return setSelectedClass(null);
    setSelectedClass((c) => classes.find((x) => x.id === c?.id) ?? classes[0]);
  }, [classes]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">School setup</h1>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Academic years</CardTitle>
            <CardDescription>Classes and attendance belong to the current year.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {years.map((y) => (
                <button key={y.id} onClick={() => !y.is_current && makeCurrent(y.id)}>
                  <Badge variant={y.is_current ? "default" : "outline"}>{y.name}{y.is_current && " · current"}</Badge>
                </button>
              ))}
            </div>
            {year && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>{year.name} starts</Label>
                  <Input key={`s-${year.id}-${year.starts_on}`} type="date" defaultValue={year.starts_on ?? ""}
                    onBlur={(e) => e.target.value !== (year.starts_on ?? "") && setYearDate("starts_on", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>{year.name} ends</Label>
                  <Input key={`e-${year.id}-${year.ends_on}`} type="date" defaultValue={year.ends_on ?? ""}
                    onBlur={(e) => e.target.value !== (year.ends_on ?? "") && setYearDate("ends_on", e.target.value)} />
                </div>
                <p className="col-span-2 text-xs text-muted-foreground">Dates set when leave balances reset and when graduates are recorded as leaving.</p>
              </div>
            )}
            <div className="space-y-2 border-t pt-3">
              <Label>New academic year (becomes current)</Label>
              <div className="flex flex-wrap gap-2">
                <Input className="w-36" placeholder="2019 E.C." value={yearName} onChange={(e) => setYearName(e.target.value)} />
                <Input className="w-40" type="date" aria-label="Starts" title="Starts" value={yearStart} onChange={(e) => setYearStart(e.target.value)} />
                <Input className="w-40" type="date" aria-label="Ends" title="Ends" value={yearEnd} onChange={(e) => setYearEnd(e.target.value)} />
                <Button onClick={addYear}>Add</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Terms {year && `· ${year.name}`}</CardTitle>
            <CardDescription>Used to group gradebook assessments and report cards.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="divide-y rounded-md border">
              {terms.length === 0 && <p className="p-3 text-sm text-muted-foreground">No terms yet.</p>}
              {terms.map((t) => <TermRow key={t.id} term={t} />)}
            </div>
            <div className="flex flex-wrap gap-2">
              <Input className="w-36" placeholder="Semester 1" value={term.name} disabled={!year} onChange={(e) => setTerm({ ...term, name: e.target.value })} />
              <Input className="w-40" type="date" aria-label="Starts" title="Starts" value={term.start} disabled={!year} onChange={(e) => setTerm({ ...term, start: e.target.value })} />
              <Input className="w-40" type="date" aria-label="Ends" title="Ends" value={term.end} disabled={!year} onChange={(e) => setTerm({ ...term, end: e.target.value })} />
              <Button
                disabled={!year || !term.name.trim()}
                onClick={async () => {
                  await run(
                    supabase.from("terms").insert({
                      school_id: school!.id, academic_year_id: year!.id, name: term.name.trim(),
                      starts_on: term.start || null, ends_on: term.end || null,
                    }),
                    "Term added",
                    [["terms"]],
                  );
                  setTerm({ name: "", start: "", end: "" });
                }}
              >
                Add
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Classes</CardTitle>
          <CardDescription>Click a class below to change its homeroom teacher and manage its subjects and subject teachers.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-[100px_100px_1fr_auto] sm:items-end">
            <div className="space-y-1">
              <Label>Grade</Label>
              <Select value={grade} onValueChange={setGrade}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 13 }, (_, g) => (
                    <SelectItem key={g} value={String(g)}>{g === 0 ? "KG" : g}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Section</Label>
              <Input value={section} onChange={(e) => setSection(e.target.value.toUpperCase())} />
            </div>
            <div className="space-y-1">
              <Label>Homeroom teacher</Label>
              <Select value={homeroom} onValueChange={setHomeroom}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {teacherOptions(teachers).map((t) => <SelectItem key={t.userId} value={t.userId}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button
              disabled={!year || !section.trim()}
              onClick={() =>
                run(
                  supabase.from("classes").insert({
                    school_id: school!.id,
                    academic_year_id: year!.id,
                    grade_level: Number(grade),
                    section: section.trim(),
                    homeroom_teacher_id: homeroom === NONE ? null : homeroom,
                  }),
                  "Class added",
                  [["classes"]],
                )
              }
            >
              Add class
            </Button>
          </div>
          {!year && <p className="text-sm text-muted-foreground">Add an academic year first.</p>}
          <div className="flex flex-wrap gap-2">
            {classes.map((c) => (
              <Button
                key={c.id}
                size="sm"
                variant={selectedClass?.id === c.id ? "default" : "outline"}
                onClick={() => setSelectedClass(c)}
                title={`Homeroom: ${teacherName(c.homeroom_teacher_id)}`}
              >
                {className(c)}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {selectedClass && <ClassSubjectsCard key={selectedClass.id} cls={selectedClass} />}

      <SubjectList />
    </div>
  );
}

function ClassSubjectsCard({ cls }: { cls: SchoolClass }) {
  const qc = useQueryClient();
  const { data: subjects = [] } = useClassSubjects(cls.id);
  const { data: teachers = [] } = useTeachers();
  const { data: schoolSubjects = [] } = useSubjects();
  const [subjectId, setSubjectId] = useState("");
  const [curriculumId, setCurriculumId] = useState(NONE);
  const [teacher, setTeacher] = useState(NONE);
  const [section, setSection] = useState(cls.section);
  const [capacity, setCapacity] = useState(cls.capacity?.toString() ?? "");

  // Curriculum read from the education project: public.grades rows are one subject at one grade level.
  const { data: curriculumOptions = [] } = useQuery({
    queryKey: ["curriculum-grades", cls.grade_level],
    enabled: !!curriculum,
    queryFn: async () => {
      const { data, error } = await curriculum!
        .from("grades")
        .select("grade_id, grade_name, subject_id, subjects(name)")
        .eq("grade_level", cls.grade_level);
      if (error) throw error;
      return (data ?? []) as unknown as { grade_id: string; grade_name: string | null; subject_id: string; subjects: { name: string } | null }[];
    },
  });

  // Picking a list subject also picks its learning-app curriculum for this grade when it is linked.
  const pickSubject = (id: string) => {
    setSubjectId(id);
    const s = schoolSubjects.find((x) => x.id === id);
    const match = s?.curriculum_subject_id && curriculumOptions.find((c) => c.subject_id === s.curriculum_subject_id);
    if (match) setCurriculumId(match.grade_id);
  };

  const add = async () => {
    const s = schoolSubjects.find((x) => x.id === subjectId);
    if (!s) return toast.error("Choose a subject from the school list");
    const { error } = await supabase.from("class_subjects").insert({
      school_id: cls.school_id,
      class_id: cls.id,
      subject_name: s.name,
      subject_id: s.id,
      periods_per_week: s.default_periods_per_week,
      curriculum_grade_id: curriculumId === NONE ? null : curriculumId,
      teacher_id: teacher === NONE ? null : teacher,
    });
    if (error) return toast.error(error.code === "23505" ? `${className(cls)} already has ${s.name}` : error.message);
    setSubjectId("");
    setCurriculumId(NONE);
    qc.invalidateQueries({ queryKey: ["class_subjects", cls.id] });
  };

  const saveDetails = async () => {
    const { error } = await supabase.from("classes").update({
      section: section.trim().toUpperCase(), capacity: capacity === "" ? null : Number(capacity),
    }).eq("id", cls.id);
    if (error) return toast.error(error.code === "23505" ? `There is already a section ${section.trim().toUpperCase()} in this grade` : error.message);
    toast.success("Class saved");
    qc.invalidateQueries({ queryKey: ["classes"] });
  };

  const deleteClass = async () => {
    if (!confirm(`Delete ${className(cls)}? Its subjects, timetable and gradebook are deleted too.`)) return;
    const { error } = await supabase.from("classes").delete().eq("id", cls.id);
    if (error) return toast.error(error.message);
    toast.success("Class deleted");
    qc.invalidateQueries({ queryKey: ["classes"] });
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("class_subjects").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["class_subjects", cls.id] });
  };

  // The database refuses a teacher who would be double-booked in the timetable; the message says where.
  const setSubjectTeacher = async (id: string, value: string) => {
    const { error } = await supabase.from("class_subjects").update({ teacher_id: value === NONE ? null : value }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Subject teacher changed");
    qc.invalidateQueries({ queryKey: ["class_subjects", cls.id] });
    qc.invalidateQueries({ queryKey: ["my-assignments"] });
  };

  const setHomeroom = async (value: string) => {
    const { error } = await supabase.from("classes").update({ homeroom_teacher_id: value === NONE ? null : value }).eq("id", cls.id);
    if (error) return toast.error(error.message);
    toast.success("Homeroom teacher changed");
    qc.invalidateQueries({ queryKey: ["classes"] });
  };

  const options = teacherOptions(teachers);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{className(cls)} · teachers and subjects</CardTitle>
        <CardDescription>
          The homeroom teacher takes attendance; each subject's teacher enters its grades (and can also take attendance).
          Linking a subject to the learning-app curriculum lets teachers assign its skills to this class.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label>Section</Label><Input className="w-20" value={section} onChange={(e) => setSection(e.target.value)} /></div>
          <div className="space-y-1"><Label>Capacity</Label><Input className="w-24" inputMode="numeric" placeholder="No limit" value={capacity} onChange={(e) => setCapacity(e.target.value)} /></div>
          <Button variant="outline" onClick={saveDetails}>Save</Button>
          <Button variant="ghost" className="text-destructive" onClick={deleteClass}><Trash2 className="mr-2 h-4 w-4" /> Delete class</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Label>Homeroom teacher</Label>
          <Select value={cls.homeroom_teacher_id ?? NONE} onValueChange={setHomeroom}>
            <SelectTrigger className="w-60"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None</SelectItem>
              {options.map((t) => <SelectItem key={t.userId} value={t.userId}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
          <div className="space-y-1">
            <Label>Subject</Label>
            <Select value={subjectId} onValueChange={pickSubject}>
              <SelectTrigger><SelectValue placeholder={schoolSubjects.length ? "Choose" : "Add subjects below first"} /></SelectTrigger>
              <SelectContent>{schoolSubjects.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Learning-app curriculum</Label>
            <Select value={curriculumId} onValueChange={setCurriculumId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not linked</SelectItem>
                {curriculumOptions.map((c) => (
                  <SelectItem key={c.grade_id} value={c.grade_id}>{c.subjects?.name ?? c.grade_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Teacher</Label>
            <Select value={teacher} onValueChange={setTeacher}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Unassigned</SelectItem>
                {options.map((t) => <SelectItem key={t.userId} value={t.userId}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={add}>Add subject</Button>
        </div>
        <div className="divide-y rounded-md border">
          {subjects.length === 0 && <p className="p-3 text-sm text-muted-foreground">No subjects yet.</p>}
          {subjects.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2 p-3 text-sm">
              <div>
                <div className="font-medium">{s.subject_name}</div>
                {s.curriculum_grade_id && <div className="text-xs text-muted-foreground">Linked to learning app</div>}
              </div>
              <div className="flex items-center gap-1">
                <Select value={s.teacher_id ?? NONE} onValueChange={(v) => setSubjectTeacher(s.id, v)}>
                  <SelectTrigger className="h-8 w-48" aria-label={`${s.subject_name} teacher`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No teacher</SelectItem>
                    {options.map((t) => <SelectItem key={t.userId} value={t.userId}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="icon" onClick={() => remove(s.id)} aria-label="Remove subject">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// One entry per person (a teacher who is also an administrator has two member rows), named by name or email.
function teacherOptions(members: Member[]) {
  const byUser = new Map<string, { userId: string; name: string }>();
  for (const m of members) {
    const prev = byUser.get(m.user_id);
    byUser.set(m.user_id, { userId: m.user_id, name: prev?.name || m.full_name || m.email || m.user_id.slice(0, 8) });
  }
  return [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function TermRow({ term }: { term: Term }) {
  const qc = useQueryClient();
  const save = async (patch: Partial<Term>) => {
    const { error } = await supabase.from("terms").update(patch).eq("id", term.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["terms"] });
  };
  const remove = async () => {
    if (!confirm(`Delete ${term.name}? Assessments in it stay in the gradebook without a term.`)) return;
    const { error } = await supabase.from("terms").delete().eq("id", term.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["terms"] });
  };
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
      <Input key={`n-${term.name}`} className="h-8 w-36" aria-label="Term name" defaultValue={term.name}
        onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== term.name && save({ name: e.target.value.trim() })} />
      <Input key={`s-${term.starts_on}`} className="h-8 w-40" type="date" aria-label={`${term.name} starts`} defaultValue={term.starts_on ?? ""}
        onBlur={(e) => e.target.value !== (term.starts_on ?? "") && save({ starts_on: e.target.value || null })} />
      <Input key={`e-${term.ends_on}`} className="h-8 w-40" type="date" aria-label={`${term.name} ends`} defaultValue={term.ends_on ?? ""}
        onBlur={(e) => e.target.value !== (term.ends_on ?? "") && save({ ends_on: e.target.value || null })} />
      <Button variant="ghost" size="icon" aria-label={`Delete ${term.name}`} onClick={remove}><Trash2 className="h-4 w-4" /></Button>
    </div>
  );
}
