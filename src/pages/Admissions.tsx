import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { useClasses, useCurrentYear } from "@/hooks/useSchoolData";
import { admissionStatusLabel, className, type AdmissionStatus, type Application } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePrompt } from "@/components/PromptDialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const OPEN: AdmissionStatus[] = ["applied", "interview", "accepted"];
const FILTERS: { value: string; label: string; match: (s: AdmissionStatus) => boolean }[] = [
  { value: "open", label: "In progress", match: (s) => OPEN.includes(s) },
  { value: "applied", label: "Applied", match: (s) => s === "applied" },
  { value: "interview", label: "Interview", match: (s) => s === "interview" },
  { value: "accepted", label: "Accepted", match: (s) => s === "accepted" },
  { value: "enrolled", label: "Enrolled", match: (s) => s === "enrolled" },
  { value: "closed", label: "Rejected / withdrawn", match: (s) => s === "rejected" || s === "withdrawn" },
  { value: "all", label: "All", match: () => true },
];
const badgeVariant = (s: AdmissionStatus) =>
  s === "enrolled" ? "default" : s === "accepted" ? "secondary" : s === "rejected" || s === "withdrawn" ? "destructive" : "outline";
const gradeLabel = (g: number) => (g === 0 ? "KG" : `Grade ${g}`);

export default function Admissions() {
  const { school } = useSchool();
  const [filter, setFilter] = useState("open");
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: apps = [] } = useQuery({
    queryKey: ["applications", school?.id],
    enabled: !!school,
    queryFn: async () => {
      const { data, error } = await supabase.from("admission_applications").select("*").eq("school_id", school!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Application[];
    },
  });

  const f = FILTERS.find((x) => x.value === filter)!;
  const visible = apps.filter((a) => f.match(a.status));
  const selected = apps.find((a) => a.id === selectedId) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Admissions</h1>
        <Button onClick={() => setCreating(true)}><Plus className="mr-2 h-4 w-4" /> New application</Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((x) => (
          <Button key={x.value} size="sm" variant={filter === x.value ? "default" : "outline"} onClick={() => setFilter(x.value)}>
            {x.label} <span className="ml-1.5 tabular-nums opacity-70">{apps.filter((a) => x.match(a.status)).length}</span>
          </Button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Applicant</TableHead>
                <TableHead>For</TableHead>
                <TableHead>Guardian</TableHead>
                <TableHead>Applied</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No applications</TableCell></TableRow>
              )}
              {visible.map((a) => (
                <TableRow key={a.id} className="cursor-pointer" onClick={() => setSelectedId(a.id)}>
                  <TableCell className="font-medium">{a.first_name} {a.father_name} {a.grandfather_name}</TableCell>
                  <TableCell>{gradeLabel(a.grade_applied)}</TableCell>
                  <TableCell>
                    {a.guardian_name ?? "—"}
                    {a.guardian_phone && <div className="text-xs text-muted-foreground">{a.guardian_phone}</div>}
                  </TableCell>
                  <TableCell className="tabular-nums">{a.created_at.slice(0, 10)}</TableCell>
                  <TableCell>
                    <Badge variant={badgeVariant(a.status)}>{admissionStatusLabel[a.status]}</Badge>
                    {a.status === "interview" && a.interview_on && <div className="text-xs text-muted-foreground">{a.interview_on}</div>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>New application</DialogTitle></DialogHeader>
          <ApplicationForm onDone={() => setCreating(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!selected} onOpenChange={(v) => !v && setSelectedId(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {selected && <ApplicationDetail app={selected} onClose={() => setSelectedId(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ApplicationForm({ app, onDone }: { app?: Application; onDone: () => void }) {
  const { school } = useSchool();
  const qc = useQueryClient();
  const { data: year } = useCurrentYear();
  const [f, setF] = useState({
    first: app?.first_name ?? "", father: app?.father_name ?? "", grandfather: app?.grandfather_name ?? "",
    gender: app?.gender ?? "", dob: app?.date_of_birth ?? "", grade: String(app?.grade_applied ?? 1),
    previous: app?.previous_school ?? "", address: app?.address ?? "",
    gName: app?.guardian_name ?? "", gPhone: app?.guardian_phone ?? "", gRel: app?.guardian_relationship ?? "", gEmail: app?.guardian_email ?? "",
    notes: app?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const text = (v: string) => v.trim() || null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const row = {
      grade_applied: Number(f.grade), first_name: f.first.trim(), father_name: f.father.trim(), grandfather_name: text(f.grandfather),
      gender: f.gender || null, date_of_birth: f.dob || null, previous_school: text(f.previous), address: text(f.address),
      guardian_name: text(f.gName), guardian_phone: text(f.gPhone), guardian_relationship: text(f.gRel), guardian_email: text(f.gEmail),
      notes: text(f.notes),
    };
    const { error } = app
      ? await supabase.from("admission_applications").update(row).eq("id", app.id)
      : await supabase.from("admission_applications").insert({ ...row, school_id: school!.id, academic_year_id: year?.id ?? null });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(app ? "Application updated" : "Application recorded");
    qc.invalidateQueries({ queryKey: ["applications"] });
    onDone();
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
      <Field label="Applying for">
        <Select value={f.grade} onValueChange={(v) => setF({ ...f, grade: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{Array.from({ length: 13 }, (_, g) => <SelectItem key={g} value={String(g)}>{gradeLabel(g)}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label="Previous school" className="sm:col-span-2"><Input value={f.previous} onChange={set("previous")} /></Field>
      <Field label="Address"><Input value={f.address} onChange={set("address")} /></Field>
      <div className="pt-2 text-sm font-medium sm:col-span-3">Guardian</div>
      <Field label="Full name"><Input value={f.gName} onChange={set("gName")} /></Field>
      <Field label="Phone"><Input value={f.gPhone} onChange={set("gPhone")} /></Field>
      <Field label="Relationship"><Input placeholder="Mother" value={f.gRel} onChange={set("gRel")} /></Field>
      <Field label="Email (gives parent access once enrolled, if they have an account)" className="sm:col-span-3">
        <Input type="email" value={f.gEmail} onChange={set("gEmail")} />
      </Field>
      <Field label="Notes" className="sm:col-span-3"><Input value={f.notes} onChange={set("notes")} /></Field>
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" disabled={busy}>Save</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

function ApplicationDetail({ app, onClose }: { app: Application; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: year } = useCurrentYear();
  const { data: classes = [] } = useClasses(year?.id);
  const [editing, setEditing] = useState(false);
  const [interviewOn, setInterviewOn] = useState(app.interview_on ?? "");
  const [classId, setClassId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [promptDialog, ask] = usePrompt();
  const matching = classes.filter((c) => c.grade_level === app.grade_applied);
  const others = classes.filter((c) => c.grade_level !== app.grade_applied);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["applications"] });
    qc.invalidateQueries({ queryKey: ["students"] });
    qc.invalidateQueries({ queryKey: ["enrollments"] });
  };

  const setStatus = async (status: AdmissionStatus, extra: Partial<Application> = {}) => {
    let note: string | null = null;
    if (status === "rejected" || status === "withdrawn") {
      note = await ask(status === "rejected"
        ? { title: `Reject ${app.first_name}'s application`, label: "Reason (optional)", confirmLabel: "Reject" }
        : { title: `${app.first_name} withdrawn by family`, label: "Note (optional)", confirmLabel: "Mark withdrawn" });
      if (note === null) return;
    }
    setBusy(true);
    const { error } = await supabase.from("admission_applications")
      .update({ status, ...extra, ...(note !== null ? { decision_note: note.trim() || null } : {}) }).eq("id", app.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Marked ${admissionStatusLabel[status].toLowerCase()}`);
    refresh();
  };

  const enroll = async () => {
    if (!classId) return toast.error("Choose a class");
    setBusy(true);
    const { data: studentId, error } = await supabase.rpc("enroll_applicant", { _application_id: app.id, _class_id: classId });
    if (error) {
      setBusy(false);
      return toast.error(error.message);
    }
    const { data: student } = await supabase.from("students").select("student_code").eq("id", studentId as string).maybeSingle();
    setBusy(false);
    toast.success(`${app.first_name} enrolled${student?.student_code ? ` with ID ${student.student_code}` : ""}`);
    refresh();
    onClose();
  };

  if (editing) {
    return (
      <>
        <DialogHeader><DialogTitle>Edit application</DialogTitle></DialogHeader>
        <ApplicationForm app={app} onDone={() => setEditing(false)} />
      </>
    );
  }

  const row = (label: string, value: React.ReactNode) => <div><span className="text-muted-foreground">{label}:</span> {value || "—"}</div>;
  const open = OPEN.includes(app.status);

  return (
    <>
      {promptDialog}
      <DialogHeader>
        <DialogTitle>
          {app.first_name} {app.father_name} {app.grandfather_name}
          <Badge variant={badgeVariant(app.status)} className="ml-2 align-middle">{admissionStatusLabel[app.status]}</Badge>
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-4 text-sm">
        <div className="grid gap-2 sm:grid-cols-2">
          {row("Applying for", gradeLabel(app.grade_applied))}
          {row("Applied on", app.created_at.slice(0, 10))}
          {row("Gender", app.gender === "M" ? "Male" : app.gender === "F" ? "Female" : null)}
          {row("Born", app.date_of_birth)}
          {row("Previous school", app.previous_school)}
          {row("Address", app.address)}
          {row("Guardian", [app.guardian_name, app.guardian_relationship && `(${app.guardian_relationship})`].filter(Boolean).join(" "))}
          {row("Guardian phone", app.guardian_phone)}
          {row("Guardian email", app.guardian_email)}
          {row("Interview", app.interview_on)}
          <div className="sm:col-span-2">{row("Notes", app.notes)}</div>
          {app.decision_note && <div className="sm:col-span-2">{row("Decision note", app.decision_note)}</div>}
        </div>

        {open && (
          <div className="space-y-3 rounded-md border p-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label>Interview date</Label>
                <Input type="date" value={interviewOn} onChange={(e) => setInterviewOn(e.target.value)} className="w-44" />
              </div>
              <Button variant="outline" disabled={busy || !interviewOn} onClick={() => setStatus("interview", { interview_on: interviewOn })}>
                {app.status === "interview" ? "Change interview date" : "Schedule interview"}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {app.status !== "accepted" && <Button disabled={busy} onClick={() => setStatus("accepted")}>Accept</Button>}
              <Button variant="outline" disabled={busy} onClick={() => setStatus("rejected")}>Reject</Button>
              <Button variant="ghost" disabled={busy} onClick={() => setStatus("withdrawn")}>Withdrawn by family</Button>
            </div>
          </div>
        )}

        {app.status === "accepted" && (
          <div className="space-y-2 rounded-md border border-primary/40 p-3">
            <div className="font-medium">Enroll</div>
            <p className="text-xs text-muted-foreground">Creates the student record with an ID, puts them in the class and adds the guardian.</p>
            <div className="flex flex-wrap items-end gap-2">
              <Select value={classId} onValueChange={setClassId}>
                <SelectTrigger className="w-48"><SelectValue placeholder={classes.length ? "Choose class" : "No classes this year"} /></SelectTrigger>
                <SelectContent>
                  {[...matching, ...others].map((c) => <SelectItem key={c.id} value={c.id}>{className(c)}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button disabled={busy || !classId} onClick={enroll}>Enroll student</Button>
            </div>
          </div>
        )}

        {(open || app.status === "rejected" || app.status === "withdrawn") && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Edit details</Button>
            {!open && <Button variant="ghost" size="sm" disabled={busy} onClick={() => setStatus("applied")}>Reopen</Button>}
          </div>
        )}
        {app.status === "enrolled" && <p className="text-muted-foreground">Enrolled. Find the student under Students.</p>}
      </div>
    </>
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
