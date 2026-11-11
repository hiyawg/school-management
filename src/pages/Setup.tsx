import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { curriculum, supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { useClasses, useClassSubjects, useCurrentYear, useTeachers, useTerms, useYears } from "@/hooks/useSchoolData";
import { className, type Member, type SchoolClass } from "@/lib/types";
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
  const [termName, setTermName] = useState("");
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
            <div className="flex flex-wrap gap-2">
              {terms.map((t) => <Badge key={t.id} variant="secondary">{t.name}</Badge>)}
            </div>
            <div className="flex gap-2">
              <Input placeholder="Semester 1" value={termName} disabled={!year} onChange={(e) => setTermName(e.target.value)} />
              <Button
                disabled={!year || !termName.trim()}
                onClick={async () => {
                  await run(
                    supabase.from("terms").insert({ school_id: school!.id, academic_year_id: year!.id, name: termName.trim() }),
                    "Term added",
                    [["terms"]],
                  );
                  setTermName("");
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

      {selectedClass && <ClassSubjectsCard cls={selectedClass} />}
    </div>
  );
}

function ClassSubjectsCard({ cls }: { cls: SchoolClass }) {
  const qc = useQueryClient();
  const { data: subjects = [] } = useClassSubjects(cls.id);
  const { data: teachers = [] } = useTeachers();
  const [name, setName] = useState("");
  const [curriculumId, setCurriculumId] = useState(NONE);
  const [teacher, setTeacher] = useState(NONE);

  // Curriculum read from the education project: public.grades rows are one subject at one grade level.
  const { data: curriculumOptions = [] } = useQuery({
    queryKey: ["curriculum-grades", cls.grade_level],
    enabled: !!curriculum,
    queryFn: async () => {
      const { data, error } = await curriculum!
        .from("grades")
        .select("grade_id, grade_name, subjects(name)")
        .eq("grade_level", cls.grade_level);
      if (error) throw error;
      return (data ?? []) as unknown as { grade_id: string; grade_name: string | null; subjects: { name: string } | null }[];
    },
  });

  const add = async () => {
    const linked = curriculumOptions.find((c) => c.grade_id === curriculumId);
    const subjectName = name.trim() || linked?.subjects?.name;
    if (!subjectName) return toast.error("Enter a subject name or pick a curriculum subject");
    const { error } = await supabase.from("class_subjects").insert({
      school_id: cls.school_id,
      class_id: cls.id,
      subject_name: subjectName,
      curriculum_grade_id: curriculumId === NONE ? null : curriculumId,
      teacher_id: teacher === NONE ? null : teacher,
    });
    if (error) return toast.error(error.message);
    setName("");
    setCurriculumId(NONE);
    qc.invalidateQueries({ queryKey: ["class_subjects", cls.id] });
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
            <Label>Subject name</Label>
            <Input placeholder="Uses curriculum name if empty" value={name} onChange={(e) => setName(e.target.value)} />
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
