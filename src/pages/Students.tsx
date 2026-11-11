import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { IdCard, Link2, Plus } from "lucide-react";
import { printStudentCards } from "@/components/student/idCardData";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { useClasses, useCurrentYear, useStudents } from "@/hooks/useSchoolData";
import { className, studentName, studentStatusLabel } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Field } from "@/components/student/StudentPanels";

const ALL = "all";
const NONE = "none";
const LEFT = "left";
const today = () => new Date().toISOString().slice(0, 10);

export default function Students() {
  const { canManageStudents, school } = useSchool();
  const [printing, setPrinting] = useState(false);
  const { data: year } = useCurrentYear();
  const { data: classes = [] } = useClasses(year?.id);
  const { data: students = [] } = useStudents();
  const [filter, setFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [search, setSearch] = useState("");
  // The ribbon's "Register student" opens the form (?register=1).
  const [params, setParams] = useSearchParams();
  const [adding, setAddingState] = useState(params.has("register"));
  const setAdding = (v: boolean) => { setAddingState(v); if (!v && params.has("register")) setParams({}, { replace: true }); };
  useEffect(() => { if (params.has("register")) setAddingState(true); }, [params]);
  const navigate = useNavigate();

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
        <Button variant="outline" className="sm:ml-auto" disabled={printing || visible.length === 0} onClick={async () => {
          setPrinting(true);
          try {
            await printStudentCards(visible, school!, year?.name ?? null, (id) => {
              const c = classes.find((x) => x.id === classOf.get(id));
              return c ? className(c) : null;
            });
          } catch (e) {
            toast.error((e as Error).message);
          } finally {
            setPrinting(false);
          }
        }}>
          <IdCard className="mr-2 h-4 w-4" /> {printing ? "Preparing…" : `Print ID cards (${visible.length})`}
        </Button>
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
                  <TableRow key={s.id} className="cursor-pointer" onClick={() => navigate(`/students/${s.id}`)}>
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
