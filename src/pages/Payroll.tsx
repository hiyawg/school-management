import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { Download, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { useStaffPeople } from "@/hooks/useSchoolData";
import { birr, type PayItem, type PayrollRun, type PayrollSettings, type Payslip, type StaffPay, type TaxBracket } from "@/lib/types";
import PayslipView from "@/components/PayslipView";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function Payroll() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Payroll</h1>
      <Tabs defaultValue="runs">
        <TabsList>
          <TabsTrigger value="runs">Monthly payroll</TabsTrigger>
          <TabsTrigger value="salaries">Salaries</TabsTrigger>
          <TabsTrigger value="settings">Tax and pension</TabsTrigger>
        </TabsList>
        <TabsContent value="runs"><Runs /></TabsContent>
        <TabsContent value="salaries"><Salaries /></TabsContent>
        <TabsContent value="settings"><Settings /></TabsContent>
      </Tabs>
    </div>
  );
}

function downloadCsv(name: string, rows: (string | number | null)[][]) {
  const csv = rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

function Runs() {
  const { school } = useSchool();
  const qc = useQueryClient();
  const [month, setMonth] = useState(format(new Date(), "yyyy-MM"));
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Payslip | null>(null);
  const period = `${month}-01`;

  const { data } = useQuery({
    queryKey: ["payroll", school?.id, period],
    enabled: !!school && !!month,
    queryFn: async () => {
      const { data: run, error } = await supabase.from("payroll_runs").select("*").eq("school_id", school!.id).eq("period", period).maybeSingle();
      if (error) throw error;
      if (!run) return { run: null, slips: [] as Payslip[] };
      const { data: slips, error: slipError } = await supabase.from("payslips").select("*").eq("run_id", run.id).order("full_name");
      if (slipError) throw slipError;
      return { run: run as PayrollRun, slips: slips as Payslip[] };
    },
  });
  const run = data?.run ?? null;
  const slips = data?.slips ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: ["payroll"] });
  const sum = (k: keyof Payslip) => slips.reduce((n, s) => n + Number(s[k]), 0);

  const generate = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("generate_payroll", { _school_id: school!.id, _month: period });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(run ? "Draft recalculated" : "Draft payroll created");
    refresh();
  };

  const finalize = async () => {
    if (!run || !confirm(`Finalize payroll for ${format(new Date(`${period}T00:00:00`), "MMMM yyyy")}? It can no longer be changed, and staff will see their payslips.`)) return;
    setBusy(true);
    const { error } = await supabase.rpc("finalize_payroll", { _run_id: run.id });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Payroll finalized");
    refresh();
  };

  const discard = async () => {
    if (!run || !confirm("Delete this draft?")) return;
    const { error } = await supabase.from("payroll_runs").delete().eq("id", run.id);
    if (error) return toast.error(error.message);
    refresh();
  };

  const exportBank = () => downloadCsv(`bank-transfers-${month}.csv`, [
    ["Name", "Bank", "Account", "Net pay"],
    ...slips.map((s) => [s.full_name, s.bank_name, s.bank_account, Number(s.net_pay).toFixed(2)]),
  ]);
  const exportFull = () => downloadCsv(`payroll-${month}.csv`, [
    ["Name", "TIN", "Basic", "Unpaid leave days", "Unpaid leave deduction", "Taxable allowances", "Non-taxable allowances",
      "Gross", "Taxable income", "Income tax", "Pension employee", "Pension employer", "Other deductions", "Net pay"],
    ...slips.map((s) => [s.full_name, s.tin, s.basic_salary, s.unpaid_leave_days, s.unpaid_leave_deduction, s.taxable_allowances,
      s.non_taxable_allowances, s.gross_pay, s.taxable_income, s.income_tax, s.pension_employee, s.pension_employer, s.other_deductions, s.net_pay]),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1"><Label>Month</Label><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-44" /></div>
        {run?.status !== "finalized" && (
          <Button onClick={generate} disabled={busy || !month}>{run ? "Recalculate draft" : "Create draft"}</Button>
        )}
        {run?.status === "draft" && slips.length > 0 && <Button variant="outline" onClick={finalize} disabled={busy}>Finalize</Button>}
        {run?.status === "draft" && <Button variant="ghost" onClick={discard} disabled={busy}>Delete draft</Button>}
        {slips.length > 0 && (
          <>
            <Button variant="outline" onClick={exportBank}><Download className="mr-2 h-4 w-4" /> Bank list</Button>
            <Button variant="outline" onClick={exportFull}><Download className="mr-2 h-4 w-4" /> Full CSV</Button>
          </>
        )}
      </div>

      {run && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={run.status === "finalized" ? "default" : "outline"}>{run.status === "finalized" ? "Finalized" : "Draft"}</Badge>
          <span className="text-muted-foreground">
            {run.working_days} working days
            {run.status === "draft" && " · A draft uses current salaries; recalculate after changing them."}
            {run.finalized_at && ` · finalized ${run.finalized_at.slice(0, 10)}`}
          </span>
        </div>
      )}
      {!run && <p className="text-sm text-muted-foreground">No payroll for this month yet. Set salaries first, then create a draft.</p>}
      {run && slips.length === 0 && <p className="text-sm text-muted-foreground">Nobody has a salary set. Add salaries in the Salaries tab.</p>}

      {slips.length > 0 && (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b text-right text-xs text-muted-foreground">
                  <th className="px-4 py-2 text-left font-normal">Name</th>
                  <th className="px-2 py-2 font-normal">Basic</th>
                  <th className="px-2 py-2 font-normal">Allowances</th>
                  <th className="px-2 py-2 font-normal">Gross</th>
                  <th className="px-2 py-2 font-normal">Income tax</th>
                  <th className="px-2 py-2 font-normal">Pension</th>
                  <th className="px-2 py-2 font-normal">Other</th>
                  <th className="px-4 py-2 font-normal">Net pay</th>
                </tr>
              </thead>
              <tbody>
                {slips.map((s) => (
                  <tr key={s.id} className="cursor-pointer border-b text-right tabular-nums hover:bg-muted/50" onClick={() => setOpen(s)}>
                    <td className="px-4 py-2 text-left">
                      {s.full_name}
                      {s.unpaid_leave_days > 0 && <div className="text-xs text-muted-foreground">{s.unpaid_leave_days} unpaid leave days</div>}
                    </td>
                    <td className="px-2 py-2">{birr(s.earned_basic)}</td>
                    <td className="px-2 py-2">{birr(Number(s.taxable_allowances) + Number(s.non_taxable_allowances))}</td>
                    <td className="px-2 py-2">{birr(s.gross_pay)}</td>
                    <td className="px-2 py-2">{birr(s.income_tax)}</td>
                    <td className="px-2 py-2">{birr(s.pension_employee)}</td>
                    <td className="px-2 py-2">{birr(s.other_deductions)}</td>
                    <td className="px-4 py-2 font-semibold">{birr(s.net_pay)}</td>
                  </tr>
                ))}
                <tr className="text-right font-semibold tabular-nums">
                  <td className="px-4 py-2 text-left">Total ({slips.length})</td>
                  <td className="px-2 py-2">{birr(sum("earned_basic"))}</td>
                  <td className="px-2 py-2">{birr(sum("taxable_allowances") + sum("non_taxable_allowances"))}</td>
                  <td className="px-2 py-2">{birr(sum("gross_pay"))}</td>
                  <td className="px-2 py-2">{birr(sum("income_tax"))}</td>
                  <td className="px-2 py-2">{birr(sum("pension_employee"))}</td>
                  <td className="px-2 py-2">{birr(sum("other_deductions"))}</td>
                  <td className="px-4 py-2">{birr(sum("net_pay"))}</td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
      {slips.length > 0 && (
        <p className="text-sm text-muted-foreground">
          To pay the tax office: income tax {birr(sum("income_tax"))}. To the pension fund: {birr(sum("pension_employee") + sum("pension_employer"))}
          {" "}(employee {birr(sum("pension_employee"))} + employer {birr(sum("pension_employer"))}).
        </p>
      )}

      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>Payslip</DialogTitle></DialogHeader>
          {open && <PayslipView slip={open} period={period} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Salaries() {
  const { school } = useSchool();
  const { data: staff = [] } = useStaffPeople();
  const [editing, setEditing] = useState<string | null>(null);

  const { data: pay = [] } = useQuery({
    queryKey: ["staff-pay", school?.id],
    enabled: !!school,
    queryFn: async () => {
      const { data, error } = await supabase.from("staff_pay").select("*").eq("school_id", school!.id);
      if (error) throw error;
      return data as StaffPay[];
    },
  });
  const { data: items = [] } = useQuery({
    queryKey: ["pay-items", school?.id],
    enabled: !!school,
    queryFn: async () => {
      const { data, error } = await supabase.from("pay_items").select("*").eq("school_id", school!.id).order("name");
      if (error) throw error;
      return data as PayItem[];
    },
  });
  const person = staff.find((p) => p.userId === editing);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-normal">Name</th>
                <th className="px-2 py-2 text-right font-normal">Basic salary</th>
                <th className="px-2 py-2 font-normal">Allowances / deductions</th>
                <th className="px-2 py-2 font-normal">Pension</th>
                <th className="px-4 py-2 font-normal">Bank</th>
              </tr>
            </thead>
            <tbody>
              {staff.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">No staff yet</td></tr>}
              {staff.map((p) => {
                const sp = pay.find((x) => x.user_id === p.userId);
                const mine = items.filter((i) => i.user_id === p.userId);
                return (
                  <tr key={p.userId} className="cursor-pointer border-b last:border-0 hover:bg-muted/50" onClick={() => setEditing(p.userId)}>
                    <td className="px-4 py-2">{p.name}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{sp && Number(sp.basic_salary) > 0 ? birr(sp.basic_salary) : <span className="text-muted-foreground">Not set</span>}</td>
                    <td className="px-2 py-2 text-xs">{mine.length ? mine.map((i) => `${i.kind === "deduction" ? "−" : "+"}${i.name}`).join(", ") : "—"}</td>
                    <td className="px-2 py-2">{sp ? (sp.pension ? "Yes" : "No") : "—"}</td>
                    <td className="px-4 py-2 text-xs">{sp?.bank_account ? `${sp.bank_name ?? ""} ${sp.bank_account}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">Only administrators see salaries. Staff see their own payslips on My page once a month is finalized.</p>

      <Dialog open={!!person} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          {person && (
            <>
              <DialogHeader><DialogTitle>{person.name}</DialogTitle></DialogHeader>
              <SalaryForm key={person.userId} userId={person.userId} pay={pay.find((x) => x.user_id === person.userId)} />
              <PayItems userId={person.userId} items={items.filter((i) => i.user_id === person.userId)} />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SalaryForm({ userId, pay }: { userId: string; pay?: StaffPay }) {
  const { school } = useSchool();
  const qc = useQueryClient();
  const [f, setF] = useState({
    basic: pay ? String(Number(pay.basic_salary)) : "", pension: pay?.pension ?? true,
    tin: pay?.tin ?? "", bank: pay?.bank_name ?? "", account: pay?.bank_account ?? "",
  });
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.from("staff_pay").upsert({
      school_id: school!.id, user_id: userId, basic_salary: Number(f.basic || 0), pension: f.pension,
      tin: f.tin.trim() || null, bank_name: f.bank.trim() || null, bank_account: f.account.trim() || null,
    }, { onConflict: "school_id,user_id" });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Salary saved");
    qc.invalidateQueries({ queryKey: ["staff-pay"] });
  };

  return (
    <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1"><Label>Basic monthly salary (birr)</Label><Input inputMode="decimal" required value={f.basic} onChange={(e) => setF({ ...f, basic: e.target.value })} /></div>
      <div className="space-y-1"><Label>TIN</Label><Input value={f.tin} onChange={(e) => setF({ ...f, tin: e.target.value })} /></div>
      <div className="space-y-1"><Label>Bank</Label><Input placeholder="CBE" value={f.bank} onChange={(e) => setF({ ...f, bank: e.target.value })} /></div>
      <div className="space-y-1"><Label>Account number</Label><Input value={f.account} onChange={(e) => setF({ ...f, account: e.target.value })} /></div>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <Checkbox checked={f.pension} onCheckedChange={(v) => setF({ ...f, pension: v === true })} />
        Pension contributions apply
      </label>
      <div className="sm:col-span-2"><Button type="submit" size="sm" disabled={busy}>Save salary</Button></div>
    </form>
  );
}

function PayItems({ userId, items }: { userId: string; items: PayItem[] }) {
  const { school } = useSchool();
  const qc = useQueryClient();
  const [f, setF] = useState({ kind: "allowance" as PayItem["kind"], name: "", amount: "", taxable: true });
  const refresh = () => qc.invalidateQueries({ queryKey: ["pay-items"] });

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("pay_items").insert({
      school_id: school!.id, user_id: userId, kind: f.kind, name: f.name.trim(), amount: Number(f.amount), taxable: f.taxable,
    });
    if (error) return toast.error(error.message);
    setF({ ...f, name: "", amount: "" });
    refresh();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("pay_items").delete().eq("id", id);
    if (error) return toast.error(error.message);
    refresh();
  };

  return (
    <div className="space-y-3 border-t pt-4 text-sm">
      <div className="font-medium">Monthly allowances and deductions</div>
      {items.length === 0 && <p className="text-muted-foreground">None.</p>}
      {items.map((i) => (
        <div key={i.id} className="flex items-center justify-between">
          <span>
            {i.kind === "deduction" ? "−" : "+"} {i.name}
            {i.kind === "allowance" && !i.taxable && <span className="text-muted-foreground"> (non-taxable)</span>}
          </span>
          <span className="flex items-center gap-1 tabular-nums">
            {birr(i.amount)}
            <Button variant="ghost" size="icon" aria-label={`Remove ${i.name}`} onClick={() => remove(i.id)}><Trash2 className="h-4 w-4" /></Button>
          </span>
        </div>
      ))}
      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v as PayItem["kind"] })}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="allowance">Allowance</SelectItem><SelectItem value="deduction">Deduction</SelectItem></SelectContent>
        </Select>
        <Input className="w-36" required placeholder={f.kind === "allowance" ? "Transport" : "Loan repayment"} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Input className="w-24" required inputMode="decimal" placeholder="Amount" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        {f.kind === "allowance" && (
          <label className="flex items-center gap-1.5 pb-2"><Checkbox checked={f.taxable} onCheckedChange={(v) => setF({ ...f, taxable: v === true })} /> Taxable</label>
        )}
        <Button type="submit" size="sm">Add</Button>
      </form>
      <p className="text-xs text-muted-foreground">Whether an allowance is taxable depends on its type and amount under current law. Check with your accountant.</p>
    </div>
  );
}

function Settings() {
  const { school } = useSchool();
  const qc = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ["payroll-settings", school?.id],
    enabled: !!school,
    queryFn: async () => {
      const { data, error } = await supabase.from("payroll_settings").select("*").eq("school_id", school!.id).maybeSingle();
      if (error) throw error;
      return data as PayrollSettings | null;
    },
  });
  return settings ? <SettingsForm key={settings.school_id + String(settings.tax_brackets.length)} settings={settings} onSaved={() => qc.invalidateQueries({ queryKey: ["payroll-settings"] })} />
    : <p className="text-sm text-muted-foreground">Loading…</p>;
}

function SettingsForm({ settings, onSaved }: { settings: PayrollSettings; onSaved: () => void }) {
  const [employee, setEmployee] = useState(String(settings.employee_pension_rate));
  const [employer, setEmployer] = useState(String(settings.employer_pension_rate));
  const [brackets, setBrackets] = useState(settings.tax_brackets.map((b) => ({ upTo: b.up_to === null ? "" : String(b.up_to), rate: String(b.rate) })));
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const parsed: TaxBracket[] = brackets.map((b, i) => ({ up_to: i === brackets.length - 1 || b.upTo === "" ? null : Number(b.upTo), rate: Number(b.rate) }));
    for (let i = 1; i < parsed.length - 1; i++) {
      if ((parsed[i].up_to ?? Infinity) <= (parsed[i - 1].up_to ?? 0)) return toast.error("Each bracket must end above the previous one");
    }
    if (parsed.some((b) => Number.isNaN(b.rate) || b.rate < 0 || b.rate > 100)) return toast.error("Rates must be between 0 and 100");
    setBusy(true);
    const { error } = await supabase.from("payroll_settings").update({
      employee_pension_rate: Number(employee), employer_pension_rate: Number(employer), tax_brackets: parsed,
    }).eq("school_id", settings.school_id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Saved. Recalculate any draft payroll to use the new figures.");
    onSaved();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tax and pension</CardTitle>
        <CardDescription>
          Defaults: monthly income tax brackets from Proclamation 1395/2025 and 7% / 11% pension. Confirm them with your
          accountant; finalized payslips keep the figures they were calculated with.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <div className="space-y-1"><Label>Employee pension %</Label><Input className="w-28" inputMode="decimal" value={employee} onChange={(e) => setEmployee(e.target.value)} /></div>
            <div className="space-y-1"><Label>Employer pension %</Label><Input className="w-28" inputMode="decimal" value={employer} onChange={(e) => setEmployer(e.target.value)} /></div>
          </div>
          <div className="space-y-2">
            <Label>Monthly income tax brackets</Label>
            {brackets.map((b, i) => {
              const from = i === 0 ? 0 : Number(brackets[i - 1].upTo || 0) + 1;
              const last = i === brackets.length - 1;
              return (
                <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="w-20 tabular-nums text-muted-foreground">{from.toLocaleString()}</span>
                  <span>to</span>
                  {last ? <span className="w-28 text-muted-foreground">and above</span> : (
                    <Input className="h-8 w-28" inputMode="decimal" aria-label="Up to" value={b.upTo}
                      onChange={(e) => setBrackets(brackets.map((x, j) => (j === i ? { ...x, upTo: e.target.value } : x)))} />
                  )}
                  <Input className="h-8 w-20" inputMode="decimal" aria-label="Rate" value={b.rate}
                    onChange={(e) => setBrackets(brackets.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} />
                  <span>%</span>
                  {brackets.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" aria-label="Remove bracket" onClick={() => setBrackets(brackets.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              );
            })}
            <Button type="button" variant="outline" size="sm"
              onClick={() => setBrackets([...brackets.slice(0, -1), { upTo: "", rate: "" }, brackets[brackets.length - 1]])}>
              Add bracket
            </Button>
          </div>
          <Button type="submit" disabled={busy}>Save</Button>
        </form>
      </CardContent>
    </Card>
  );
}
