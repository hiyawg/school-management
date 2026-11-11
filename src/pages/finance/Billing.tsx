import { useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { useSchool } from "@/contexts/SchoolContext";
import { useStudents, useTerms } from "@/hooks/useSchoolData";
import {
  birr, feeKindLabel, frequencyLabel, invoiceStateLabel, studentName,
  type FeeFrequency, type FeeItem, type FeeKind, type FeeStructure, type InvoiceBalance, type InvoiceState, type Student,
} from "@/lib/types";
import StudentFees from "@/components/finance/StudentFees";
import { invalidateFinance, stateVariant } from "@/components/finance/financeData";
import { usePrompt } from "@/components/PromptDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ALL = "all";
const gradeLabel = (g: number | null) => (g === null ? "All other grades" : g === 0 ? "KG" : `Grade ${g}`);

// Fee structures ------------------------------------------------------------------------

export function FeeStructures({ yearId }: { yearId: string }) {
  const { school } = useSchool();
  const qc = useQueryClient();
  const [grade, setGrade] = useState<string>("");
  const { data } = useQuery({
    queryKey: ["fee-structures", yearId],
    queryFn: async () => {
      const { data: structures, error } = await supabase.from("fee_structures").select("*").eq("academic_year_id", yearId).order("grade_level", { nullsFirst: false });
      if (error) throw error;
      const ids = (structures as FeeStructure[]).map((s) => s.id);
      const items = ids.length ? await supabase.from("fee_items").select("*").in("structure_id", ids).order("created_at") : { data: [], error: null };
      if (items.error) throw items.error;
      return { structures: structures as FeeStructure[], items: (items.data ?? []) as FeeItem[] };
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["fee-structures", yearId] });
  const structures = data?.structures ?? [];
  const taken = new Set(structures.map((s) => String(s.grade_level)));

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const g = grade === ALL ? null : Number(grade);
    const { error } = await supabase.from("fee_structures").insert({ school_id: school!.id, academic_year_id: yearId, grade_level: g, name: gradeLabel(g) });
    if (error) return toast.error(error.message);
    setGrade("");
    refresh();
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        One fee structure per grade, plus an optional one for all other grades. Each line is billed once (e.g. registration),
        once per term, or monthly.
      </p>
      {structures.map((s) => (
        <StructureCard key={s.id} structure={s} items={(data?.items ?? []).filter((i) => i.structure_id === s.id)} onChange={refresh} />
      ))}
      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label>New fee structure for</Label>
          <Select value={grade} onValueChange={setGrade}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Choose grade" /></SelectTrigger>
            <SelectContent>
              {!taken.has("null") && <SelectItem value={ALL}>All other grades</SelectItem>}
              {Array.from({ length: 13 }, (_, g) => g).filter((g) => !taken.has(String(g))).map((g) => (
                <SelectItem key={g} value={String(g)}>{gradeLabel(g)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={!grade}>Add</Button>
      </form>
    </div>
  );
}

function StructureCard({ structure, items, onChange }: { structure: FeeStructure; items: FeeItem[]; onChange: () => void }) {
  const { school } = useSchool();
  const [f, setF] = useState({ name: "", kind: "tuition" as FeeKind, frequency: "monthly" as FeeFrequency, amount: "" });
  const yearly = (i: FeeItem) => Number(i.amount) * (i.frequency === "monthly" ? 10 : i.frequency === "per_term" ? 2 : 1);

  const act = async (op: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await op;
    if (error) return toast.error(error.message);
    onChange();
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">{gradeLabel(structure.grade_level)}</CardTitle>
        <Button variant="ghost" size="icon" aria-label={`Delete ${structure.name} fees`}
          onClick={() => confirm(`Delete the ${structure.name} fee structure? Invoices already made keep their lines.`) && act(supabase.from("fee_structures").delete().eq("id", structure.id))}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {items.length === 0 && <p className="text-muted-foreground">No fees yet.</p>}
        {items.map((i) => (
          <div key={i.id} className="flex items-center justify-between gap-2 border-b py-1.5 last:border-0">
            <span>
              {i.name}{" "}
              <span className="text-muted-foreground">
                · {i.name.toLowerCase() === feeKindLabel[i.kind].toLowerCase() ? "" : `${feeKindLabel[i.kind]} · `}{frequencyLabel[i.frequency]}
              </span>
            </span>
            <span className="flex items-center gap-1 tabular-nums">
              {birr(i.amount)}
              <Button variant="ghost" size="icon" aria-label={`Remove ${i.name}`} onClick={() => act(supabase.from("fee_items").delete().eq("id", i.id))}><Trash2 className="h-4 w-4" /></Button>
            </span>
          </div>
        ))}
        {items.length > 0 && (
          <p className="text-xs text-muted-foreground">About {birr(items.reduce((n, i) => n + yearly(i), 0))} per student per year (counting 10 months and 2 terms), before discounts.</p>
        )}
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => {
          e.preventDefault();
          act(supabase.from("fee_items").insert({ school_id: school!.id, structure_id: structure.id, name: f.name.trim(), kind: f.kind, frequency: f.frequency, amount: Number(f.amount) }));
          setF({ ...f, name: "", amount: "" });
        }}>
          <Input className="w-36" required placeholder="Tuition" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v as FeeKind })}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>{(Object.keys(feeKindLabel) as FeeKind[]).map((k) => <SelectItem key={k} value={k}>{feeKindLabel[k]}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={f.frequency} onValueChange={(v) => setF({ ...f, frequency: v as FeeFrequency })}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>{(Object.keys(frequencyLabel) as FeeFrequency[]).map((k) => <SelectItem key={k} value={k}>{frequencyLabel[k]}</SelectItem>)}</SelectContent>
          </Select>
          <Input className="w-28" required inputMode="decimal" placeholder="Amount" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          <Button type="submit" size="sm" variant="outline">Add fee</Button>
        </form>
      </CardContent>
    </Card>
  );
}

// Billing run + invoice list ------------------------------------------------------------

export function Invoices({ yearId }: { yearId: string }) {
  const qc = useQueryClient();
  const { data: terms = [] } = useTerms(yearId);
  const { data: students = [] } = useStudents();
  const [run, setRun] = useState({ frequency: "monthly" as FeeFrequency, month: format(new Date(), "yyyy-MM"), term: "", due: "" });
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<InvoiceState | "owing" | typeof ALL>("owing");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Student | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: invoices = [] } = useQuery({
    queryKey: ["finance-invoices", yearId],
    queryFn: async () => {
      return fetchAll<InvoiceBalance>((a, b) => supabase.from("invoice_balances").select("*").eq("academic_year_id", yearId)
        .order("issued_on", { ascending: false }).order("number").range(a, b));
    },
  });
  const byId = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const q = search.trim().toLowerCase();
  const visible = invoices.filter((i) => {
    if (filter === "owing" ? !(Number(i.balance) > 0 && i.state !== "void") : filter !== ALL && i.state !== filter) return false;
    const s = byId.get(i.student_id);
    return !q || `${s ? studentName(s) : ""} ${s?.student_code ?? ""} ${i.number}`.toLowerCase().includes(q);
  });
  const owing = invoices.filter((i) => i.state !== "void").reduce((n, i) => n + Number(i.balance), 0);

  const generate = async () => {
    const term = terms.find((t) => t.id === run.term);
    const [key, title] = run.frequency === "monthly"
      ? [run.month, `Monthly fees · ${format(new Date(`${run.month}-01T00:00:00`), "MMMM yyyy")}`]
      : run.frequency === "per_term" ? [run.term, `Term fees · ${term?.name ?? ""}`] : ["once", "Registration and one-time fees"];
    if (!key) return toast.error("Choose the month or term");
    setBusy(true);
    const { data, error } = await supabase.rpc("generate_invoices", {
      _year_id: yearId, _frequency: run.frequency, _period_key: key, _title: title, _due_on: run.due || null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(data ? `${data} invoice${data === 1 ? "" : "s"} created` : "Nothing new to bill: everyone already has this invoice, or no fee lines match");
    invalidateFinance(qc);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Bill students</CardTitle>
          <CardDescription>Creates an invoice for every enrolled student from their grade's fee structure, with their discounts. Safe to run again.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label>Bill</Label>
            <Select value={run.frequency} onValueChange={(v) => setRun({ ...run, frequency: v as FeeFrequency })}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Monthly fees</SelectItem>
                <SelectItem value="per_term">Term fees</SelectItem>
                <SelectItem value="once">One-time fees</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {run.frequency === "monthly" && (
            <div className="space-y-1"><Label>Month</Label><Input type="month" className="w-44" value={run.month} onChange={(e) => setRun({ ...run, month: e.target.value })} /></div>
          )}
          {run.frequency === "per_term" && (
            <div className="space-y-1">
              <Label>Term</Label>
              <Select value={run.term} onValueChange={(v) => setRun({ ...run, term: v })}>
                <SelectTrigger className="w-40"><SelectValue placeholder="Choose" /></SelectTrigger>
                <SelectContent>{terms.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1"><Label>Due date</Label><Input type="date" className="w-44" value={run.due} onChange={(e) => setRun({ ...run, due: e.target.value })} /></div>
          <Button onClick={generate} disabled={busy}>{busy ? "Creating…" : "Create invoices"}</Button>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Input className="sm:w-64" placeholder="Search student, ID or invoice no." value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="owing">Not fully paid</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="void">Void</SelectItem>
            <SelectItem value={ALL}>All</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => setCreating(true)}>New invoice</Button>
        <span className="ml-auto text-sm text-muted-foreground">Outstanding this year: <b className="text-foreground tabular-nums">{birr(owing)}</b></span>
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-normal">Student</th>
                <th className="px-2 py-2 font-normal">Invoice</th>
                <th className="px-2 py-2 text-right font-normal">Total</th>
                <th className="px-2 py-2 text-right font-normal">Balance</th>
                <th className="px-4 py-2 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">No invoices</td></tr>}
              {visible.slice(0, 300).map((i) => {
                const s = byId.get(i.student_id);
                return (
                  <tr key={i.invoice_id} className="cursor-pointer border-b last:border-0 hover:bg-muted/50" onClick={() => s && setOpen(s)}>
                    <td className="px-4 py-2">{s ? studentName(s) : "Former student"}<div className="text-xs text-muted-foreground">{s?.student_code}</div></td>
                    <td className="px-2 py-2">{i.title}<div className="text-xs text-muted-foreground">{i.number}{i.due_on && ` · due ${i.due_on}`}</div></td>
                    <td className="px-2 py-2 text-right tabular-nums">{birr(i.total)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{birr(i.balance)}</td>
                    <td className="px-4 py-2"><Badge variant={stateVariant(i.state)}>{invoiceStateLabel[i.state]}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {visible.length > 300 && <p className="text-xs text-muted-foreground">Showing the first 300. Search to narrow down.</p>}

      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="top-[5vh] max-h-[90vh] translate-y-0 overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{open && studentName(open)} · fees</DialogTitle></DialogHeader>
          {open && <StudentFees student={open} />}
          {open && <InvoiceActions studentId={open.id} yearId={yearId} />}
        </DialogContent>
      </Dialog>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>New invoice</DialogTitle></DialogHeader>
          <ManualInvoice yearId={yearId} students={students.filter((s) => s.status === "active")} onDone={() => { setCreating(false); invalidateFinance(qc); }} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Voiding an unpaid invoice, from the student's fee dialog.
function InvoiceActions({ studentId, yearId }: { studentId: string; yearId: string }) {
  const qc = useQueryClient();
  const [promptDialog, ask] = usePrompt();
  const { data: invoices = [] } = useQuery({
    queryKey: ["student-finance", studentId, "voidable", yearId],
    queryFn: async () => {
      const { data, error } = await supabase.from("invoice_balances").select("*").eq("student_id", studentId).eq("paid", 0).neq("state", "void");
      if (error) throw error;
      return data as InvoiceBalance[];
    },
  });
  if (!invoices.length) return null;

  const voidInvoice = async (i: InvoiceBalance) => {
    const reason = await ask({ title: `Void ${i.number}`, label: "Reason (required)", confirmLabel: "Void invoice" });
    if (!reason?.trim()) return;
    const { error } = await supabase.rpc("void_invoice", { _invoice_id: i.invoice_id, _reason: reason });
    if (error) return toast.error(error.message);
    toast.success(`${i.number} voided`);
    invalidateFinance(qc);
  };

  return (
    <div className="space-y-1 border-t pt-3 text-sm">
      {promptDialog}
      <div className="text-xs text-muted-foreground">Unpaid invoices can be voided (for example, billed by mistake). Paid ones need their receipts voided first.</div>
      <div className="flex flex-wrap gap-2">
        {invoices.map((i) => <Button key={i.invoice_id} size="sm" variant="ghost" onClick={() => voidInvoice(i)}>Void {i.number}</Button>)}
      </div>
    </div>
  );
}

function ManualInvoice({ yearId, students, onDone }: { yearId: string; students: Student[]; onDone: () => void }) {
  const { school } = useSchool();
  const [studentId, setStudentId] = useState("");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [lines, setLines] = useState([{ description: "", amount: "" }]);
  const [busy, setBusy] = useState(false);
  const total = lines.reduce((n, l) => n + (Number(l.amount) || 0), 0);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const valid = lines.filter((l) => l.description.trim() && Number(l.amount) > 0);
    if (!studentId || !valid.length) return toast.error("Choose a student and add at least one line");
    setBusy(true);
    const { data: inv, error } = await supabase.from("invoices").insert({
      school_id: school!.id, academic_year_id: yearId, student_id: studentId, title: title.trim() || valid[0].description.trim(),
      due_on: due || null, number: "",
    }).select().single();
    if (!error) {
      const { error: lineError } = await supabase.from("invoice_lines").insert(valid.map((l) => ({
        school_id: school!.id, invoice_id: inv.id, description: l.description.trim(), amount: Number(l.amount), kind: "other",
      })));
      setBusy(false);
      if (lineError) return toast.error(lineError.message);
      toast.success(`Invoice ${inv.number} created`);
      return onDone();
    }
    setBusy(false);
    toast.error(error.message);
  };

  return (
    <form onSubmit={save} className="space-y-3 text-sm">
      <div className="space-y-1">
        <Label>Student</Label>
        <Select value={studentId} onValueChange={setStudentId}>
          <SelectTrigger><SelectValue placeholder="Choose student" /></SelectTrigger>
          <SelectContent>{students.map((s) => <SelectItem key={s.id} value={s.id}>{studentName(s)}{s.student_code && ` · ${s.student_code}`}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1"><Label>Title</Label><Input placeholder="Uniform" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="space-y-1"><Label>Due date</Label><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
      </div>
      <div className="space-y-2">
        <Label>Lines</Label>
        {lines.map((l, i) => (
          <div key={i} className="flex gap-2">
            <Input placeholder="Description" value={l.description} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
            <Input className="w-32" inputMode="decimal" placeholder="Amount" value={l.amount} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
          </div>
        ))}
        <Button type="button" size="sm" variant="ghost" onClick={() => setLines([...lines, { description: "", amount: "" }])}>Add line</Button>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}>Create invoice</Button>
        <span className="text-muted-foreground">Total <b className="text-foreground tabular-nums">{birr(total)}</b></span>
      </div>
    </form>
  );
}
