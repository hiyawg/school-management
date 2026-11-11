import { useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link2, Pencil, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { useClasses, useCurrentYear, useStudents } from "@/hooks/useSchoolData";
import {
  className, studentName, studentStatusLabel,
  type Guardian, type Student, type StudentStatus,
} from "@/lib/types";
import StudentHistory from "@/components/StudentHistory";
import { StudentDocuments, StudentPhoto } from "@/components/StudentFiles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const ALL = "all";
const NONE = "none";
const LEFT = "left";
const today = () => new Date().toISOString().slice(0, 10);

export default function Students() {
  const { canManageStudents } = useSchool();
  const { data: year } = useCurrentYear();
  const { data: classes = [] } = useClasses(year?.id);
  const { data: students = [] } = useStudents();
  const [filter, setFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Looked up from the list so the dialog shows fresh data after an edit.
  const selected = students.find((s) => s.id === selectedId) ?? null;

  const { data: enrollments = [] } = useQuery({
    queryKey: ["enrollments", year?.id, classes.map((c) => c.id).join()],
    enabled: classes.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("enrollments")
        .select("student_id, class_id")
        .in("class_id", classes.map((c) => c.id))
        .eq("status", "active");
      if (error) throw error;
      return data as { student_id: string; class_id: string }[];
    },
  });

  const classOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of enrollments) map.set(e.student_id, e.class_id);
    return map;
  }, [enrollments]);

  const visible = students.filter((s) => {
    if (statusFilter === LEFT && s.status !== "withdrawn" && s.status !== "transferred_out") return false;
    if (statusFilter !== ALL && statusFilter !== LEFT && s.status !== statusFilter) return false;
    if (filter === NONE && classOf.has(s.id)) return false;
    if (filter !== ALL && filter !== NONE && classOf.get(s.id) !== filter) return false;
    const q = search.trim().toLowerCase();
    return !q || `${s.first_name} ${s.father_name} ${s.student_code ?? ""}`.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Students</h1>
        {canManageStudents && (
          <Button onClick={() => setAdding(true)} disabled={!year}>
            <Plus className="mr-2 h-4 w-4" /> Register student
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input placeholder="Search name or ID" value={search} onChange={(e) => setSearch(e.target.value)} className="sm:max-w-xs" />
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All classes</SelectItem>
            <SelectItem value={NONE}>Not enrolled</SelectItem>
            {classes.map((c) => <SelectItem key={c.id} value={c.id}>{className(c)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Current students</SelectItem>
            <SelectItem value="graduated">Graduated</SelectItem>
            <SelectItem value={LEFT}>Left the school</SelectItem>
            <SelectItem value={ALL}>Everyone</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>ID</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Learning app</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No students</TableCell></TableRow>
              )}
              {visible.map((s) => {
                const cls = classes.find((c) => c.id === classOf.get(s.id));
                return (
                  <TableRow key={s.id} className="cursor-pointer" onClick={() => setSelectedId(s.id)}>
                    <TableCell className="font-medium">
                      {studentName(s)} {s.grandfather_name}
                      {s.status !== "active" && <Badge variant="outline" className="ml-2">{studentStatusLabel[s.status]}</Badge>}
                    </TableCell>
                    <TableCell>{s.student_code ?? "—"}</TableCell>
                    <TableCell>{cls ? className(cls) : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>
                      {s.learning_student_id ? (
                        <Badge variant="secondary"><Link2 className="mr-1 h-3 w-3" />Linked</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not linked</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AddStudentDialog open={adding} onOpenChange={setAdding} />
      <StudentDialog student={selected} currentClassId={selected ? classOf.get(selected.id) : undefined} onClose={() => setSelectedId(null)} />
    </div>
  );
}

function AddStudentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { school } = useSchool();
  const qc = useQueryClient();
  const { data: year } = useCurrentYear();
  const { data: classes = [] } = useClasses(year?.id);
  const empty = {
    first: "", father: "", grandfather: "", gender: "", dob: "", code: "", admitted: today(), address: "", previous: "",
    classId: NONE, gName: "", gPhone: "", gRel: "", gEmail: "",
  };
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data: student, error } = await supabase
        .from("students")
        .insert({
          school_id: school!.id,
          first_name: f.first.trim(),
          father_name: f.father.trim(),
          grandfather_name: f.grandfather.trim() || null,
          gender: f.gender || null,
          date_of_birth: f.dob || null,
          student_code: f.code.trim() || null,
          admission_date: f.admitted || null,
          address: f.address.trim() || null,
          previous_school: f.previous.trim() || null,
        })
        .select()
        .single();
      if (error) throw error;
      if (f.classId !== NONE) {
        const { error: enrollError } = await supabase
          .from("enrollments")
          .insert({ school_id: school!.id, class_id: f.classId, student_id: student.id });
        if (enrollError) throw enrollError;
      }
      if (f.gName.trim()) {
        const { error: gError } = await supabase.rpc("add_guardian", {
          _student_id: student.id,
          _full_name: f.gName.trim(),
          _phone: f.gPhone.trim() || null,
          _relationship: f.gRel.trim() || null,
          _email: f.gEmail.trim() || null,
        });
        if (gError) toast.warning(`Student saved, but guardian was not: ${gError.message}`);
      }
      toast.success(`${f.first} registered with ID ${student.student_code}`);
      setF(empty);
      onOpenChange(false);
      qc.invalidateQueries({ queryKey: ["students"] });
      qc.invalidateQueries({ queryKey: ["enrollments"] });
      qc.invalidateQueries({ queryKey: ["members"] });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Register student</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
          <Field label="First name"><Input required value={f.first} onChange={set("first")} /></Field>
          <Field label="Father's name"><Input required value={f.father} onChange={set("father")} /></Field>
          <Field label="Grandfather's name"><Input value={f.grandfather} onChange={set("grandfather")} /></Field>
          <Field label="Gender">
            <Select value={f.gender} onValueChange={(v) => setF({ ...f, gender: v })}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent><SelectItem value="M">Male</SelectItem><SelectItem value="F">Female</SelectItem></SelectContent>
            </Select>
          </Field>
          <Field label="Date of birth"><Input type="date" value={f.dob} onChange={set("dob")} /></Field>
          <Field label="Student ID"><Input placeholder="Automatic" value={f.code} onChange={set("code")} /></Field>
          <Field label="Admission date"><Input type="date" value={f.admitted} onChange={set("admitted")} /></Field>
          <Field label="Address" className="sm:col-span-2"><Input value={f.address} onChange={set("address")} /></Field>
          <Field label="Previous school" className="sm:col-span-3"><Input value={f.previous} onChange={set("previous")} /></Field>
          <Field label="Class" className="sm:col-span-3">
            <Select value={f.classId} onValueChange={(v) => setF({ ...f, classId: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Enroll later</SelectItem>
                {classes.map((c) => <SelectItem key={c.id} value={c.id}>{className(c)}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <div className="pt-2 text-sm font-medium sm:col-span-3">Guardian</div>
          <Field label="Full name"><Input value={f.gName} onChange={set("gName")} /></Field>
          <Field label="Phone"><Input value={f.gPhone} onChange={set("gPhone")} /></Field>
          <Field label="Relationship"><Input placeholder="Mother" value={f.gRel} onChange={set("gRel")} /></Field>
          <Field label="Email (gives parent access)" className="sm:col-span-3">
            <Input type="email" value={f.gEmail} onChange={set("gEmail")} />
          </Field>
          <div className="sm:col-span-3">
            <Button type="submit" disabled={busy}>Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StudentDialog({ student, currentClassId, onClose }: { student: Student | null; currentClassId?: string; onClose: () => void }) {
  return (
    <Dialog open={!!student} onOpenChange={(v) => !v && onClose()}>
      {/* Anchored near the top: tabs have different heights and a centred dialog would jump. */}
      <DialogContent className="top-[5vh] max-h-[90vh] translate-y-0 overflow-y-auto sm:max-w-2xl">
        {student && (
          <>
            <DialogHeader>
              <DialogTitle>
                {studentName(student)} {student.grandfather_name}
                {student.status !== "active" && <Badge variant="outline" className="ml-2 align-middle">{studentStatusLabel[student.status]}</Badge>}
              </DialogTitle>
            </DialogHeader>
            <Tabs defaultValue="profile">
              <TabsList>
                <TabsTrigger value="profile">Profile</TabsTrigger>
                <TabsTrigger value="guardians">Guardians</TabsTrigger>
                <TabsTrigger value="documents">Documents</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
              </TabsList>
              <TabsContent value="profile"><ProfileTab student={student} currentClassId={currentClassId} onClose={onClose} /></TabsContent>
              <TabsContent value="guardians"><GuardiansTab student={student} /></TabsContent>
              <TabsContent value="documents"><StudentDocuments student={student} /></TabsContent>
              <TabsContent value="history"><StudentHistory studentId={student.id} /></TabsContent>
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProfileTab({ student, currentClassId, onClose }: { student: Student; currentClassId?: string; onClose: () => void }) {
  const { school, canManageStudents } = useSchool();
  const qc = useQueryClient();
  const { data: year } = useCurrentYear();
  const { data: classes = [] } = useClasses(year?.id);
  const [editing, setEditing] = useState(false);

  const moveTo = async (classId: string) => {
    if (currentClassId) {
      const { error } = await supabase.from("enrollments").update({ status: "transferred" })
        .eq("student_id", student.id).eq("class_id", currentClassId);
      if (error) return toast.error(error.message);
    }
    const { error } = await supabase.from("enrollments")
      .upsert({ school_id: school!.id, class_id: classId, student_id: student.id, status: "active" }, { onConflict: "class_id,student_id" });
    if (error) return toast.error(error.message);
    toast.success("Enrollment updated");
    qc.invalidateQueries({ queryKey: ["enrollments"] });
    qc.invalidateQueries({ queryKey: ["roster"] });
    qc.invalidateQueries({ queryKey: ["student-history", student.id] });
    onClose();
  };

  if (editing) return <ProfileForm student={student} currentClassId={currentClassId} onDone={() => setEditing(false)} />;

  const row = (label: string, value: React.ReactNode) => (
    <div><span className="text-muted-foreground">{label}:</span> {value || "—"}</div>
  );

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-col gap-4 sm:flex-row">
        <StudentPhoto student={student} />
        <div className="grid flex-1 content-start gap-2 sm:grid-cols-2">
          {row("ID", student.student_code)}
          {row("Gender", student.gender === "M" ? "Male" : student.gender === "F" ? "Female" : null)}
          {row("Born", student.date_of_birth)}
          {row("Admitted", student.admission_date)}
          {row("Address", student.address)}
          {row("Previous school", student.previous_school)}
          {row("Status", studentStatusLabel[student.status] + (student.left_on ? ` (${student.left_on})` : ""))}
          {row("Learning app", student.learning_student_id ? "Linked" : "Not linked")}
          <div className="sm:col-span-2">{row("Medical notes", student.medical_notes)}</div>
        </div>
      </div>
      {canManageStudents && (
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          <Pencil className="mr-2 h-4 w-4" /> Edit profile
        </Button>
      )}
      {canManageStudents && student.status === "active" && (
        <div className="space-y-1">
          <Label>{currentClassId ? "Move to class" : "Enroll in class"}</Label>
          <Select value={currentClassId} onValueChange={moveTo}>
            <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
            <SelectContent>
              {classes.map((c) => <SelectItem key={c.id} value={c.id}>{className(c)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

function ProfileForm({ student, currentClassId, onDone }: { student: Student; currentClassId?: string; onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    first: student.first_name, father: student.father_name, grandfather: student.grandfather_name ?? "",
    gender: student.gender ?? "", dob: student.date_of_birth ?? "", code: student.student_code ?? "",
    admitted: student.admission_date ?? "", address: student.address ?? "", previous: student.previous_school ?? "",
    medical: student.medical_notes ?? "", status: student.status, leftOn: student.left_on ?? today(),
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const leaving = f.status === "withdrawn" || f.status === "transferred_out";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.from("students").update({
        first_name: f.first.trim(),
        father_name: f.father.trim(),
        grandfather_name: f.grandfather.trim() || null,
        gender: f.gender || null,
        date_of_birth: f.dob || null,
        student_code: f.code.trim() || null,
        admission_date: f.admitted || null,
        address: f.address.trim() || null,
        previous_school: f.previous.trim() || null,
        medical_notes: f.medical.trim() || null,
        status: f.status,
        left_on: f.status === "active" ? null : f.status === "graduated" ? student.left_on ?? today() : f.leftOn || today(),
      }).eq("id", student.id);
      if (error) throw error;
      // A student who leaves is taken off this year's class register.
      if (leaving && currentClassId) {
        const { error: enrollError } = await supabase.from("enrollments").update({ status: "withdrawn" })
          .eq("student_id", student.id).eq("class_id", currentClassId);
        if (enrollError) throw enrollError;
      }
      toast.success("Profile saved");
      qc.invalidateQueries({ queryKey: ["students"] });
      qc.invalidateQueries({ queryKey: ["enrollments"] });
      qc.invalidateQueries({ queryKey: ["roster"] });
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
      <Field label="First name"><Input required value={f.first} onChange={set("first")} /></Field>
      <Field label="Father's name"><Input required value={f.father} onChange={set("father")} /></Field>
      <Field label="Grandfather's name"><Input value={f.grandfather} onChange={set("grandfather")} /></Field>
      <Field label="Gender">
        <Select value={f.gender} onValueChange={(v) => setF({ ...f, gender: v })}>
          <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
          <SelectContent><SelectItem value="M">Male</SelectItem><SelectItem value="F">Female</SelectItem></SelectContent>
        </Select>
      </Field>
      <Field label="Date of birth"><Input type="date" value={f.dob} onChange={set("dob")} /></Field>
      <Field label="Student ID"><Input required value={f.code} onChange={set("code")} /></Field>
      <Field label="Admission date"><Input type="date" value={f.admitted} onChange={set("admitted")} /></Field>
      <Field label="Address" className="sm:col-span-2"><Input value={f.address} onChange={set("address")} /></Field>
      <Field label="Previous school" className="sm:col-span-3"><Input value={f.previous} onChange={set("previous")} /></Field>
      <Field label="Medical notes (allergies, conditions)" className="sm:col-span-3"><Input value={f.medical} onChange={set("medical")} /></Field>
      <Field label="Status" className={leaving ? "" : "sm:col-span-3"}>
        <Select value={f.status} onValueChange={(v) => setF({ ...f, status: v as StudentStatus })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(studentStatusLabel) as StudentStatus[]).map((s) => (
              <SelectItem key={s} value={s}>{studentStatusLabel[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {leaving && <Field label="Left on" className="sm:col-span-2"><Input type="date" value={f.leftOn} onChange={set("leftOn")} /></Field>}
      {leaving && currentClassId && student.status === "active" && (
        <p className="text-xs text-muted-foreground sm:col-span-3">Saving takes the student off this year's class register. Their records are kept.</p>
      )}
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" disabled={busy}>Save</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

function GuardiansTab({ student }: { student: Student }) {
  const { canManageStudents } = useSchool();
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const { data: guardians = [] } = useQuery({
    queryKey: ["guardians", student.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("guardians").select("*").eq("student_id", student.id).order("created_at");
      if (error) throw error;
      return data as Guardian[];
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["guardians", student.id] });

  const remove = async (g: Guardian) => {
    if (!confirm(`Remove ${g.full_name} as a guardian of ${student.first_name}?`)) return;
    const { error } = await supabase.from("guardians").delete().eq("id", g.id);
    if (error) return toast.error(error.message);
    toast.success("Guardian removed");
    refresh();
  };

  return (
    <div className="space-y-3 text-sm">
      {guardians.length === 0 && <p className="text-muted-foreground">None recorded.</p>}
      {guardians.map((g) =>
        editingId === g.id ? (
          <GuardianForm key={g.id} studentId={student.id} guardian={g} onDone={() => { setEditingId(null); refresh(); }} />
        ) : (
          <div key={g.id} className="flex items-center justify-between gap-2 border-b py-1.5">
            <div>
              <div>{g.full_name}{g.relationship && <span className="text-muted-foreground"> ({g.relationship})</span>}</div>
              <div className="text-xs text-muted-foreground">{g.phone ?? "No phone"}{g.user_id && " · can see this student in the app"}</div>
            </div>
            {canManageStudents && (
              <div className="flex shrink-0">
                <Button variant="ghost" size="icon" aria-label="Edit guardian" onClick={() => setEditingId(g.id)}><Pencil className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" aria-label="Remove guardian" onClick={() => remove(g)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            )}
          </div>
        ),
      )}
      {canManageStudents && (adding ? (
        <GuardianForm studentId={student.id} onDone={() => { setAdding(false); refresh(); qc.invalidateQueries({ queryKey: ["members"] }); }} />
      ) : (
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}><Plus className="mr-2 h-4 w-4" /> Add guardian</Button>
      ))}
    </div>
  );
}

// Without a guardian, adds one (an email also gives parent access); with one, edits its details.
function GuardianForm({ studentId, guardian, onDone }: { studentId: string; guardian?: Guardian; onDone: () => void }) {
  const [f, setF] = useState({ name: guardian?.full_name ?? "", phone: guardian?.phone ?? "", rel: guardian?.relationship ?? "", email: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = guardian
      ? await supabase.from("guardians").update({
          full_name: f.name.trim(), phone: f.phone.trim() || null, relationship: f.rel.trim() || null,
        }).eq("id", guardian.id)
      : await supabase.rpc("add_guardian", {
          _student_id: studentId, _full_name: f.name.trim(), _phone: f.phone.trim() || null,
          _relationship: f.rel.trim() || null, _email: f.email.trim() || null,
        });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(guardian ? "Guardian updated" : "Guardian added");
    onDone();
  };

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-md border p-3 sm:grid-cols-3">
      <Field label="Full name"><Input required value={f.name} onChange={set("name")} /></Field>
      <Field label="Phone"><Input value={f.phone} onChange={set("phone")} /></Field>
      <Field label="Relationship"><Input placeholder="Mother" value={f.rel} onChange={set("rel")} /></Field>
      {!guardian && (
        <Field label="Email (gives parent access)" className="sm:col-span-3">
          <Input type="email" value={f.email} onChange={set("email")} />
        </Field>
      )}
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" size="sm" disabled={busy}>Save</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

function Field({ label, className: cls, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`space-y-1 ${cls ?? ""}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
