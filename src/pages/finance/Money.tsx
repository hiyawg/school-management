import { useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { endOfMonth, format } from "date-fns";
import { toast } from "sonner";
import { Download, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { useStudents } from "@/hooks/useSchoolData";
import {
  birr, paymentMethodLabel, studentName,
  type BudgetLine, type Discount, type Expense, type Payment, type PaymentMethod, type Student,
} from "@/lib/types";
import StudentFees from "@/components/finance/StudentFees";
import { invalidateFinance } from "@/components/finance/financeData";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function downloadCsv(name: string, rows: (string | number | null)[][]) {
  const csv = rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

// Payments (cash book) ----------------------------------------------------------------------

export function Payments() {
  const { school } = useSchool();
  const { data: students = [] } = useStudents();
  const [month, setMonth] = useState(format(new Date(), "yyyy-MM"));
  const [open, setOpen] = useState<Student | null>(null);
  const [find, setFind] = useState("");
  const from = `${month}-01`;
  const to = format(endOfMonth(new Date(`${from}T00:00:00`)), "yyyy-MM-dd");

  const { data: payments = [] } = useQuery({
    queryKey: ["finance-payments", school?.id, month],
    enabled: !!school && !!month,
    queryFn: async () => {
      const { data, error } = await supabase.from("payments").select("*").eq("school_id", school!.id)
        .gte("paid_on", from).lte("paid_on", to).order("paid_on", { ascending: false }).order("created_at", { ascending: false });
      if (error) throw error;
      return data as Payment[];
    },
  });
  const byId = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const live = payments.filter((p) => !p.voided);
  const total = live.reduce((n, p) => n + Number(p.amount), 0);
  const methods = (Object.keys(paymentMethodLabel) as PaymentMethod[])
    .map((m) => ({ m, n: live.filter((p) => p.method === m).reduce((x, p) => x + Number(p.amount), 0) })).filter((x) => x.n > 0);
  const q = find.trim().toLowerCase();
  const matches = q.length < 2 ? [] : students.filter((s) => `${studentName(s)} ${s.grandfather_name ?? ""} ${s.student_code ?? ""}`.toLowerCase().includes(q)).slice(0, 8);

  const exportCsv = () => downloadCsv(`payments-${month}.csv`, [
    ["Receipt", "Date", "Student", "Student ID", "Method", "Reference", "Amount", "Void"],
    ...payments.map((p) => {
      const s = byId.get(p.student_id);
      return [p.receipt_number, p.paid_on, s ? studentName(s) : "", s?.student_code ?? "", paymentMethodLabel[p.method], p.reference, Number(p.amount).toFixed(2), p.voided ? p.void_reason : ""];
    }),
  ]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Take a payment</CardTitle>
          <CardDescription>Find the student, then record the payment against one of their invoices.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Input className="sm:w-80" placeholder="Student name or ID" value={find} onChange={(e) => setFind(e.target.value)} />
          {matches.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {matches.map((s) => (
                <Button key={s.id} size="sm" variant="outline" onClick={() => { setOpen(s); setFind(""); }}>
                  {studentName(s)}{s.student_code && ` · ${s.student_code}`}
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1"><Label>Month</Label><Input type="month" className="w-44" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
        {payments.length > 0 && <Button variant="outline" onClick={exportCsv}><Download className="mr-2 h-4 w-4" /> CSV</Button>}
        <div className="ml-auto text-right text-sm">
          <div>Collected: <b className="tabular-nums">{birr(total)}</b> birr</div>
          <div className="text-xs text-muted-foreground">{methods.map((x) => `${paymentMethodLabel[x.m]} ${birr(x.n)}`).join(" · ")}</div>
        </div>
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-normal">Receipt</th>
                <th className="px-2 py-2 font-normal">Date</th>
                <th className="px-2 py-2 font-normal">Student</th>
                <th className="px-2 py-2 font-normal">Method</th>
                <th className="px-4 py-2 text-right font-normal">Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">No payments this month</td></tr>}
              {payments.map((p) => {
                const s = byId.get(p.student_id);
                return (
                  <tr key={p.id} className={`cursor-pointer border-b last:border-0 hover:bg-muted/50 ${p.voided ? "text-muted-foreground" : ""}`} onClick={() => s && setOpen(s)}>
                    <td className="px-4 py-2">{p.receipt_number}{p.voided && <Badge variant="secondary" className="ml-2">Void</Badge>}</td>
                    <td className="px-2 py-2 tabular-nums">{p.paid_on}</td>
                    <td className="px-2 py-2">{s ? studentName(s) : "Former student"}</td>
                    <td className="px-2 py-2">{paymentMethodLabel[p.method]}{p.reference && <span className="text-muted-foreground"> · {p.reference}</span>}</td>
                    <td className={`px-4 py-2 text-right tabular-nums ${p.voided ? "line-through" : ""}`}>{birr(p.amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="top-[5vh] max-h-[90vh] translate-y-0 overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{open && studentName(open)} · fees</DialogTitle></DialogHeader>
          {open && <StudentFees student={open} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Scholarships and discounts ----------------------------------------------------------------

export function Discounts({ yearId }: { yearId: string }) {
  const { school } = useSchool();
  const qc = useQueryClient();
  const { data: students = [] } = useStudents();
  const [f, setF] = useState({ student: "", name: "", kind: "percent" as Discount["kind"], value: "", appliesTo: "tuition" as Discount["applies_to"], notes: "" });
  const { data: discounts = [] } = useQuery({
    queryKey: ["discounts", yearId],
    queryFn: async () => {
      const { data, error } = await supabase.from("student_discounts").select("*").eq("academic_year_id", yearId).order("created_at");
      if (error) throw error;
      return data as Discount[];
    },
  });
  const byId = new Map(students.map((s) => [s.id, s]));
  const refresh = () => { qc.invalidateQueries({ queryKey: ["discounts", yearId] }); invalidateFinance(qc); };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.student) return toast.error("Choose a student");
    const { error } = await supabase.from("student_discounts").insert({
      school_id: school!.id, academic_year_id: yearId, student_id: f.student, name: f.name.trim(), kind: f.kind,
      value: Number(f.value), applies_to: f.appliesTo, notes: f.notes.trim() || null,
    });
    if (error) return toast.error(error.code === "23514" ? "A percentage must be between 1 and 100" : error.message);
    setF({ ...f, student: "", value: "", notes: "" });
    refresh();
  };

  const remove = async (d: Discount) => {
    if (!confirm(`Remove ${d.name}? Invoices already made keep it; new ones won't.`)) return;
    const { error } = await supabase.from("student_discounts").delete().eq("id", d.id);
    if (error) return toast.error(error.message);
    refresh();
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Discounts are applied to each new invoice for the student this year. Invoices already made don't change.</p>
      <Card>
        <CardContent className="divide-y p-0 text-sm">
          {discounts.length === 0 && <p className="p-4 text-muted-foreground">No scholarships or discounts this year.</p>}
          {discounts.map((d) => {
            const s = byId.get(d.student_id);
            return (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <div>
                  <div className="font-medium">{s ? studentName(s) : "Former student"} <span className="font-normal text-muted-foreground">· {s?.student_code}</span></div>
                  <div className="text-muted-foreground">
                    {d.name}: {d.kind === "percent" ? `${Number(d.value)}%` : `${birr(d.value)} birr`} off {d.applies_to === "tuition" ? "tuition" : "all fees"} per invoice
                    {d.notes && ` · ${d.notes}`}
                  </div>
                </div>
                <Button variant="ghost" size="icon" aria-label={`Remove ${d.name}`} onClick={() => remove(d)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            );
          })}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Add a scholarship or discount</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={add} className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1 sm:col-span-3">
              <Label>Student</Label>
              <Select value={f.student} onValueChange={(v) => setF({ ...f, student: v })}>
                <SelectTrigger><SelectValue placeholder="Choose student" /></SelectTrigger>
                <SelectContent>
                  {students.filter((s) => s.status === "active").map((s) => <SelectItem key={s.id} value={s.id}>{studentName(s)}{s.student_code && ` · ${s.student_code}`}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Name</Label><Input required placeholder="Sibling discount" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            <div className="space-y-1">
              <Label>Type</Label>
              <Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v as Discount["kind"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="percent">Percentage</SelectItem><SelectItem value="fixed">Fixed amount</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>{f.kind === "percent" ? "Percent" : "Birr per invoice"}</Label><Input required inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></div>
            <div className="space-y-1">
              <Label>Applies to</Label>
              <Select value={f.appliesTo} onValueChange={(v) => setF({ ...f, appliesTo: v as Discount["applies_to"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="tuition">Tuition only</SelectItem><SelectItem value="all">All fees</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1 sm:col-span-2"><Label>Notes</Label><Input placeholder="Approved by the board" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
            <div className="sm:col-span-3"><Button type="submit">Add</Button></div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// Expenses and budget -----------------------------------------------------------------------

export function Expenses({ yearId }: { yearId: string }) {
  const { school } = useSchool();
  const qc = useQueryClient();
  const [month, setMonth] = useState(format(new Date(), "yyyy-MM"));
  const from = `${month}-01`;
  const to = format(endOfMonth(new Date(`${from}T00:00:00`)), "yyyy-MM-dd");
  const [f, setF] = useState({ category: "", description: "", amount: "", date: new Date().toISOString().slice(0, 10), paidTo: "", method: "cash" as PaymentMethod, reference: "" });
  const [budget, setBudget] = useState({ category: "", amount: "" });

  const { data: expenses = [] } = useQuery({
    queryKey: ["expenses", school?.id, month],
    enabled: !!school,
    queryFn: async () => {
      const { data, error } = await supabase.from("expenses").select("*").eq("school_id", school!.id).gte("spent_on", from).lte("spent_on", to).order("spent_on", { ascending: false });
      if (error) throw error;
      return data as Expense[];
    },
  });
  const { data: budgetLines = [] } = useQuery({
    queryKey: ["budget", yearId],
    queryFn: async () => {
      const { data, error } = await supabase.from("budget_lines").select("*").eq("academic_year_id", yearId).order("category");
      if (error) throw error;
      return data as BudgetLine[];
    },
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["expenses"] }); qc.invalidateQueries({ queryKey: ["budget"] }); qc.invalidateQueries({ queryKey: ["finance-report"] }); };
  const categories = [...new Set([...budgetLines.map((b) => b.category), ...expenses.map((e) => e.category)])].sort();

  const addExpense = async (e: FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("expenses").insert({
      school_id: school!.id, academic_year_id: yearId, category: f.category.trim(), description: f.description.trim(), amount: Number(f.amount),
      spent_on: f.date, paid_to: f.paidTo.trim() || null, method: f.method, reference: f.reference.trim() || null,
    });
    if (error) return toast.error(error.message);
    setF({ ...f, description: "", amount: "", paidTo: "", reference: "" });
    refresh();
  };

  const saveBudget = async (e: FormEvent) => {
    e.preventDefault();
    const existing = budgetLines.find((b) => b.category.toLowerCase() === budget.category.trim().toLowerCase());
    const { error } = existing
      ? await supabase.from("budget_lines").update({ amount: Number(budget.amount) }).eq("id", existing.id)
      : await supabase.from("budget_lines").insert({ school_id: school!.id, academic_year_id: yearId, category: budget.category.trim(), amount: Number(budget.amount) });
    if (error) return toast.error(error.message);
    setBudget({ category: "", amount: "" });
    refresh();
  };

  const act = async (op: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await op;
    if (error) return toast.error(error.message);
    refresh();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Budget for the year</CardTitle>
          <CardDescription>Salaries come from payroll automatically; budget them here under "Salaries" to compare.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {budgetLines.map((b) => (
            <div key={b.id} className="flex items-center justify-between border-b py-1 last:border-0">
              <span>{b.category}</span>
              <span className="flex items-center gap-1 tabular-nums">{birr(b.amount)}
                <Button variant="ghost" size="icon" aria-label={`Remove ${b.category} budget`} onClick={() => act(supabase.from("budget_lines").delete().eq("id", b.id))}><Trash2 className="h-4 w-4" /></Button>
              </span>
            </div>
          ))}
          <form onSubmit={saveBudget} className="flex flex-wrap gap-2">
            <Input className="w-44" required placeholder="Category" list="expense-categories" value={budget.category} onChange={(e) => setBudget({ ...budget, category: e.target.value })} />
            <Input className="w-36" required inputMode="decimal" placeholder="Amount" value={budget.amount} onChange={(e) => setBudget({ ...budget, amount: e.target.value })} />
            <Button type="submit" size="sm" variant="outline">Set budget</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Record an expense</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={addExpense} className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1"><Label>Category</Label><Input required list="expense-categories" placeholder="Utilities" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></div>
            <div className="space-y-1 sm:col-span-2"><Label>Description</Label><Input required placeholder="Electricity bill, October" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
            <div className="space-y-1"><Label>Amount</Label><Input required inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
            <div className="space-y-1"><Label>Date</Label><Input type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
            <div className="space-y-1"><Label>Paid to</Label><Input value={f.paidTo} onChange={(e) => setF({ ...f, paidTo: e.target.value })} /></div>
            <div className="space-y-1">
              <Label>Method</Label>
              <Select value={f.method} onValueChange={(v) => setF({ ...f, method: v as PaymentMethod })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(paymentMethodLabel) as PaymentMethod[]).map((m) => <SelectItem key={m} value={m}>{paymentMethodLabel[m]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Reference</Label><Input placeholder="Receipt / cheque no." value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></div>
            <div className="flex items-end"><Button type="submit">Add expense</Button></div>
          </form>
          <datalist id="expense-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </CardContent>
      </Card>

      <div className="flex items-end gap-2">
        <div className="space-y-1"><Label>Month</Label><Input type="month" className="w-44" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
        <span className="ml-auto text-sm">Spent: <b className="tabular-nums">{birr(expenses.reduce((n, e) => n + Number(e.amount), 0))}</b></span>
      </div>
      <Card>
        <CardContent className="divide-y p-0 text-sm">
          {expenses.length === 0 && <p className="p-4 text-muted-foreground">No expenses this month.</p>}
          {expenses.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
              <div>
                <div>{e.description} <span className="text-muted-foreground">· {e.category}</span></div>
                <div className="text-xs text-muted-foreground">{e.spent_on} · {paymentMethodLabel[e.method]}{e.paid_to && ` · ${e.paid_to}`}{e.reference && ` · ${e.reference}`}</div>
              </div>
              <span className="flex items-center gap-1 tabular-nums">{birr(e.amount)}
                <Button variant="ghost" size="icon" aria-label={`Delete ${e.description}`}
                  onClick={() => confirm(`Delete "${e.description}"?`) && act(supabase.from("expenses").delete().eq("id", e.id))}><Trash2 className="h-4 w-4" /></Button>
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
