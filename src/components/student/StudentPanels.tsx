import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { useClasses, useCurrentYear } from "@/hooks/useSchoolData";
import { className, studentStatusLabel, type Guardian, type Student, type StudentStatus } from "@/lib/types";
import { StudentPhoto } from "@/components/StudentFiles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const today = () => new Date().toISOString().slice(0, 10);

// Pieces of a student's record, shared by the student record page.
export function ProfileTab({ student, currentClassId, onClose }: { student: Student; currentClassId?: string; onClose: () => void }) {
  const { school, canManageStudents } = useSchool();
  const qc = useQueryClient();
  const { data: year } = useCurrentYear();
  const { data: classes = [] } = useClasses(year?.id);
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState<string>("");
  const [moving, setMoving] = useState(false);

  const moveTo = async (classId: string) => {
    if (!classId || classId === currentClassId) return;
    setMoving(true);
    if (currentClassId) {
      const { error } = await supabase.from("enrollments").update({ status: "transferred" })
        .eq("student_id", student.id).eq("class_id", currentClassId);
      if (error) { setMoving(false); return toast.error(error.message); }
    }
    const { error } = await supabase.from("enrollments")
      .upsert({ school_id: school!.id, class_id: classId, student_id: student.id, status: "active" }, { onConflict: "class_id,student_id" });
    setMoving(false);
    if (error) return toast.error(error.message);
    const cls = classes.find((c) => c.id === classId);
    toast.success(`${student.first_name} ${currentClassId ? "moved to" : "enrolled in"} ${cls ? className(cls) : "the class"}`);
    setTarget("");
    qc.invalidateQueries({ queryKey: ["students"] });
    qc.invalidateQueries({ queryKey: ["enrollments"] });
    qc.invalidateQueries({ queryKey: ["roster"] });
    qc.invalidateQueries({ queryKey: ["student-history", student.id] });
    onClose();
  };

  if (editing) return <ProfileForm student={student} currentClassId={currentClassId} onDone={() => setEditing(false)} />;

  const row = (label: string, value: React.ReactNode) => (
    <div><span className="text-muted-foreground">{label}:</span> {value || "—"}</div>
  );

  const current = classes.find((c) => c.id === currentClassId);

  return (
    <div className="space-y-4 text-sm">
      {/* Class enrollment first: it's what a new student needs before anything else works. */}
      <div className={`space-y-2 rounded-sm border p-3 ${current ? "" : "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40"}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span><span className="text-muted-foreground">Class{year ? ` (${year.name})` : ""}:</span>{" "}
            {current ? <b>{className(current)}</b> : <b className="text-amber-700 dark:text-amber-400">Not enrolled</b>}</span>
        </div>
        {canManageStudents && student.status === "active" ? (
          classes.length === 0 ? (
            <p className="text-xs text-muted-foreground">There are no classes this year yet. Add them in School setup.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger className="w-48"><SelectValue placeholder={current ? "Move to class…" : "Choose a class…"} /></SelectTrigger>
                <SelectContent>
                  {classes.filter((c) => c.id !== currentClassId).map((c) => <SelectItem key={c.id} value={c.id}>{className(c)}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" disabled={!target || moving} onClick={() => moveTo(target)}>{current ? "Move" : "Enroll"}</Button>
            </div>
          )
        ) : !current && (
          <p className="text-xs text-muted-foreground">Only an administrator or registrar can enroll students in a class.</p>
        )}
      </div>

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
      {canManageStudents && <StudentLogin student={student} />}
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

export function GuardiansTab({ student }: { student: Student }) {
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

export function Field({ label, className: cls, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`space-y-1 ${cls ?? ""}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

// Links the student's own account (they sign up first), so they can use the portal themselves.
export function StudentLogin({ student }: { student: Student }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const link = async (value: string) => {
    setBusy(true);
    const { error } = await supabase.rpc("link_student_account", { _student_id: student.id, _email: value });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(value ? `${student.first_name} can now sign in to the portal` : "Student login removed");
    setEmail("");
    qc.invalidateQueries({ queryKey: ["students"] });
  };

  return (
    <div className="space-y-1 rounded-md border p-3">
      <div className="font-medium">Student login</div>
      {student.user_id ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground">{student.first_name} has their own login and sees their attendance, results, homework and messages.</span>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => confirm("Remove the student's login access?") && link("")}>Remove</Button>
        </div>
      ) : (
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); link(email); }}>
          <Input className="sm:w-72" type="email" required placeholder="Student's email (they sign up first)" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" size="sm" variant="outline" disabled={busy}>Give portal access</Button>
        </form>
      )}
    </div>
  );
}
