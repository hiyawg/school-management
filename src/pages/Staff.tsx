import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { useClasses, useCurrentYear, useMembers } from "@/hooks/useSchoolData";
import {
  className, employmentLabel, roleLabel,
  type ClassSubject, type EmploymentType, type Member, type SchoolClass, type SchoolRole, type StaffProfile,
} from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import StaffPerformance from "@/components/StaffPerformance";

// One row per person: school_members has a row per role.
type Person = { userId: string; name: string; email: string | null; phone: string | null; rows: Member[]; roles: SchoolRole[]; isStaff: boolean };
type Load = { homeroom: SchoolClass[]; subjects: (ClassSubject & { cls?: SchoolClass })[] };

export default function Staff() {
  const { school } = useSchool();
  const qc = useQueryClient();
  const { data: members = [] } = useMembers();
  const { data: year } = useCurrentYear();
  const { data: classes = [] } = useClasses(year?.id);
  const [form, setForm] = useState({ email: "", name: "", phone: "", role: "teacher" as SchoolRole });
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState<"staff" | "parents" | "all">("staff");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: profiles = [] } = useQuery({
    queryKey: ["staff-profiles", school?.id],
    enabled: !!school,
    queryFn: async () => {
      const { data, error } = await supabase.from("staff_profiles").select("*").eq("school_id", school!.id);
      if (error) throw error;
      return data as StaffProfile[];
    },
  });

  const { data: subjects = [] } = useQuery({
    queryKey: ["year-subjects", year?.id, classes.map((c) => c.id).join()],
    enabled: classes.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("class_subjects").select("*").in("class_id", classes.map((c) => c.id));
      if (error) throw error;
      return data as ClassSubject[];
    },
  });

  const people = useMemo(() => {
    const byUser = new Map<string, Person>();
    // Staff rows first, so a person's name is the one the school gave them as staff, not a guardian name.
    const ordered = [...members].sort((a, b) => Number(a.role === "parent") - Number(b.role === "parent"));
    for (const m of ordered) {
      const p = byUser.get(m.user_id) ?? { userId: m.user_id, name: "", email: m.email, phone: null, rows: [], roles: [], isStaff: false };
      p.rows.push(m);
      p.roles.push(m.role);
      p.name ||= m.full_name ?? "";
      p.phone ??= m.phone;
      p.email ??= m.email;
      p.isStaff ||= m.role !== "parent" && m.role !== "student";
      byUser.set(m.user_id, p);
    }
    return [...byUser.values()].sort((a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || ""));
  }, [members]);

  const loadOf = (userId: string): Load => ({
    homeroom: classes.filter((c) => c.homeroom_teacher_id === userId),
    subjects: subjects.filter((s) => s.teacher_id === userId).map((s) => ({ ...s, cls: classes.find((c) => c.id === s.class_id) })),
  });

  const visible = people.filter((p) => show === "all" || (show === "staff" ? p.isStaff : p.roles.includes("parent")));
  const selected = people.find((p) => p.userId === selectedId) ?? null;

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc("add_member_by_email", {
      _school_id: school!.id,
      _email: form.email,
      _role: form.role,
      _full_name: form.name || null,
      _phone: form.phone || null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`${form.name || form.email} added as ${roleLabel[form.role]}`);
    setForm({ ...form, email: "", name: "", phone: "" });
    qc.invalidateQueries({ queryKey: ["members"] });
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">People</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add a person</CardTitle>
          <CardDescription>
            They need an account first (in this app or the learning app). Parents added here also need to be listed as a
            guardian on their child's record.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={add} className="grid gap-3 md:grid-cols-[1.4fr_1fr_1fr_160px_auto] md:items-end">
            <div className="space-y-1">
              <Label>Email</Label>
              <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Full name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as SchoolRole })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(roleLabel) as SchoolRole[]).map((r) => <SelectItem key={r} value={r}>{roleLabel[r]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={busy}>Add</Button>
          </form>
        </CardContent>
      </Card>

      <Select value={show} onValueChange={(v) => setShow(v as typeof show)}>
        <SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="staff">Staff</SelectItem>
          <SelectItem value="parents">Parents</SelectItem>
          <SelectItem value="all">Everyone</SelectItem>
        </SelectContent>
      </Select>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                {show !== "parents" && <TableHead>Employee ID</TableHead>}
                {show !== "parents" && <TableHead>Teaching this year</TableHead>}
                <TableHead>Phone</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Nobody yet</TableCell></TableRow>
              )}
              {visible.map((p) => {
                const load = loadOf(p.userId);
                return (
                  <TableRow key={p.userId} className="cursor-pointer" onClick={() => setSelectedId(p.userId)}>
                    <TableCell>
                      <div className="font-medium">{p.name || p.email || p.userId.slice(0, 8)}</div>
                      {p.name && p.email && <div className="text-xs text-muted-foreground">{p.email}</div>}
                    </TableCell>
                    <TableCell className="space-x-1">{p.roles.map((r) => <Badge key={r} variant="secondary">{roleLabel[r]}</Badge>)}</TableCell>
                    {show !== "parents" && <TableCell>{profiles.find((x) => x.user_id === p.userId)?.employee_id ?? "—"}</TableCell>}
                    {show !== "parents" && (
                      <TableCell className="text-sm">
                        {p.isStaff ? loadSummary(load) : "—"}
                      </TableCell>
                    )}
                    <TableCell>{p.phone ?? "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <PersonDialog
        person={selected}
        profile={profiles.find((x) => x.user_id === selectedId)}
        load={selected ? loadOf(selected.userId) : { homeroom: [], subjects: [] }}
        yearName={year?.name}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}

function loadSummary(load: Load) {
  if (!load.homeroom.length && !load.subjects.length) return <span className="text-muted-foreground">Not assigned</span>;
  const classCount = new Set(load.subjects.map((s) => s.class_id)).size;
  return (
    <>
      {load.subjects.length > 0 && `${load.subjects.length} subject${load.subjects.length > 1 ? "s" : ""} in ${classCount} class${classCount > 1 ? "es" : ""}`}
      {load.homeroom.length > 0 && <span className="text-muted-foreground">{load.subjects.length ? " · " : ""}Homeroom {load.homeroom.map(className).join(", ")}</span>}
    </>
  );
}

function PersonDialog({ person, profile, load, yearName, onClose }: {
  person: Person | null; profile?: StaffProfile; load: Load; yearName?: string; onClose: () => void;
}) {
  return (
    <Dialog open={!!person} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="top-[5vh] max-h-[90vh] translate-y-0 overflow-y-auto sm:max-w-2xl">
        {person && (
          <>
            <DialogHeader>
              <DialogTitle>{person.name || person.email}</DialogTitle>
              {person.name && <p className="text-sm text-muted-foreground">{person.email}</p>}
            </DialogHeader>
            <Tabs defaultValue={person.isStaff ? "profile" : "access"}>
              <TabsList>
                {person.isStaff && <TabsTrigger value="profile">Profile</TabsTrigger>}
                {person.isStaff && <TabsTrigger value="load">Teaching</TabsTrigger>}
                {person.isStaff && <TabsTrigger value="performance">Performance</TabsTrigger>}
                <TabsTrigger value="access">Access</TabsTrigger>
              </TabsList>
              {person.isStaff && <TabsContent value="profile"><ProfileForm key={profile?.id ?? "new"} person={person} profile={profile} /></TabsContent>}
              {person.isStaff && <TabsContent value="load"><LoadTab load={load} yearName={yearName} /></TabsContent>}
              {person.isStaff && <TabsContent value="performance"><StaffPerformance userId={person.userId} /></TabsContent>}
              <TabsContent value="access"><AccessTab person={person} onClose={onClose} /></TabsContent>
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProfileForm({ person, profile }: { person: Person; profile?: StaffProfile }) {
  const { school } = useSchool();
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: person.name, phone: person.phone ?? "",
    employeeId: profile?.employee_id ?? "", gender: profile?.gender ?? "", dob: profile?.date_of_birth ?? "",
    qualification: profile?.qualification ?? "", specialization: profile?.specialization ?? "",
    hired: profile?.hire_date ?? "", type: profile?.employment_type ?? ("full_time" as EmploymentType),
    address: profile?.address ?? "", emName: profile?.emergency_contact_name ?? "", emPhone: profile?.emergency_contact_phone ?? "",
    notes: profile?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const text = (v: string) => v.trim() || null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { error: memberError } = await supabase.from("school_members")
        .update({ full_name: text(f.name), phone: text(f.phone) })
        .eq("school_id", school!.id).eq("user_id", person.userId);
      if (memberError) throw memberError;
      const { error } = await supabase.from("staff_profiles").upsert({
        school_id: school!.id,
        user_id: person.userId,
        employee_id: text(f.employeeId),
        gender: f.gender || null,
        date_of_birth: f.dob || null,
        qualification: text(f.qualification),
        specialization: text(f.specialization),
        hire_date: f.hired || null,
        employment_type: f.type,
        address: text(f.address),
        emergency_contact_name: text(f.emName),
        emergency_contact_phone: text(f.emPhone),
        notes: text(f.notes),
      }, { onConflict: "school_id,user_id" });
      if (error) throw error.code === "23505" ? new Error(`Employee ID ${f.employeeId} is already used by someone else`) : error;
      toast.success("Profile saved");
      qc.invalidateQueries({ queryKey: ["staff-profiles"] });
      qc.invalidateQueries({ queryKey: ["members"] });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
      <Field label="Full name" className="sm:col-span-2"><Input value={f.name} onChange={set("name")} /></Field>
      <Field label="Phone"><Input value={f.phone} onChange={set("phone")} /></Field>
      <Field label="Employee ID"><Input value={f.employeeId} onChange={set("employeeId")} /></Field>
      <Field label="Gender">
        <Select value={f.gender} onValueChange={(v) => setF({ ...f, gender: v })}>
          <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
          <SelectContent><SelectItem value="M">Male</SelectItem><SelectItem value="F">Female</SelectItem></SelectContent>
        </Select>
      </Field>
      <Field label="Date of birth"><Input type="date" value={f.dob} onChange={set("dob")} /></Field>
      <Field label="Qualification" className="sm:col-span-2"><Input placeholder="BEd Mathematics" value={f.qualification} onChange={set("qualification")} /></Field>
      <Field label="Hire date"><Input type="date" value={f.hired} onChange={set("hired")} /></Field>
      <Field label="Can teach" className="sm:col-span-2"><Input placeholder="Mathematics, Physics" value={f.specialization} onChange={set("specialization")} /></Field>
      <Field label="Employment">
        <Select value={f.type} onValueChange={(v) => setF({ ...f, type: v as EmploymentType })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(employmentLabel) as EmploymentType[]).map((t) => <SelectItem key={t} value={t}>{employmentLabel[t]}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Address" className="sm:col-span-3"><Input value={f.address} onChange={set("address")} /></Field>
      <Field label="Emergency contact" className="sm:col-span-2"><Input value={f.emName} onChange={set("emName")} /></Field>
      <Field label="Emergency phone"><Input value={f.emPhone} onChange={set("emPhone")} /></Field>
      <Field label="Notes" className="sm:col-span-3"><Input value={f.notes} onChange={set("notes")} /></Field>
      <p className="text-xs text-muted-foreground sm:col-span-3">
        Only administrators and this person can see these details.
      </p>
      <div className="sm:col-span-3"><Button type="submit" disabled={busy}>Save</Button></div>
    </form>
  );
}

function LoadTab({ load, yearName }: { load: Load; yearName?: string }) {
  const classCount = new Set(load.subjects.map((s) => s.class_id)).size;
  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { label: "Subjects", value: load.subjects.length },
          { label: "Classes", value: classCount },
          { label: "Homeroom", value: load.homeroom.length },
        ].map((s) => (
          <div key={s.label} className="rounded-md border p-2">
            <div className="text-2xl font-semibold tabular-nums">{s.value}</div>
            <div className="text-xs text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>
      {load.homeroom.length > 0 && (
        <div><span className="text-muted-foreground">Homeroom teacher of:</span> {load.homeroom.map(className).join(", ")}</div>
      )}
      {load.subjects.length > 0 ? (
        <div className="divide-y rounded-md border">
          {load.subjects
            .sort((a, b) => (a.cls?.grade_level ?? 0) - (b.cls?.grade_level ?? 0) || a.subject_name.localeCompare(b.subject_name))
            .map((s) => (
              <div key={s.id} className="flex justify-between px-3 py-1.5">
                <span>{s.subject_name}</span>
                <span className="text-muted-foreground">{s.cls ? className(s.cls) : ""}</span>
              </div>
            ))}
        </div>
      ) : (
        <p className="text-muted-foreground">No subjects assigned{yearName ? ` in ${yearName}` : ""}.</p>
      )}
      <p className="text-xs text-muted-foreground">
        Assign homeroom classes and subjects in <Link to="/setup" className="underline">School setup</Link>.
        Teachers can only take attendance and enter grades for what they are assigned to.
      </p>
    </div>
  );
}

function AccessTab({ person, onClose }: { person: Person; onClose: () => void }) {
  const { session } = useSchool();
  const qc = useQueryClient();

  const remove = async (m: Member) => {
    if (m.user_id === session?.user.id && m.role === "school_admin") return toast.error("You can't remove your own administrator access");
    if (!confirm(`Remove ${roleLabel[m.role].toLowerCase()} access for ${person.name || person.email}?`)) return;
    const { error } = await supabase.from("school_members").delete().eq("id", m.id);
    if (error) return toast.error(error.message);
    toast.success("Access removed");
    qc.invalidateQueries({ queryKey: ["members"] });
    if (person.rows.length === 1) onClose();
  };

  return (
    <div className="space-y-3 text-sm">
      {person.rows.map((m) => (
        <div key={m.id} className="flex items-center justify-between border-b py-1.5">
          <Badge variant="secondary">{roleLabel[m.role]}</Badge>
          <Button variant="ghost" size="sm" onClick={() => remove(m)}><Trash2 className="mr-2 h-4 w-4" /> Remove</Button>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        Removing access does not delete their account or the records they made. To give another role, add the same email again above.
      </p>
    </div>
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
