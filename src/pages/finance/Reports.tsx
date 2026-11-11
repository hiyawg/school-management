import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { useClasses, useStudents, useYears } from "@/hooks/useSchoolData";
import { fetchAll } from "@/lib/fetchAll";
import { birr, className, paymentMethodLabel, studentName, type Expense, type InvoiceBalance, type Payment, type PaymentMethod } from "@/lib/types";
import { downloadCsv } from "./Money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function Bar({ value, max }: { value: number; max: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded bg-muted">
      <div className="h-full bg-primary" style={{ width: `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%` }} />
    </div>
  );
}

export default function Reports({ yearId }: { yearId: string }) {
  const { school } = useSchool();
  const { data: years = [] } = useYears();
  const { data: classes = [] } = useClasses(yearId);
  const { data: students = [] } = useStudents();
  const year = years.find((y) => y.id === yearId);
  // Money in and out counted between the year's dates; without dates, the calendar year it started in.
  const from = year?.starts_on ?? `${new Date().getFullYear()}-01-01`;
  const to = year?.ends_on ?? `${new Date().getFullYear()}-12-31`;

  const { data, isLoading, error } = useQuery({
    queryKey: ["finance-report", yearId, from, to, classes.map((c) => c.id).join()],
    enabled: !!school,
    queryFn: async () => {
      const [invoices, payments, expenses, enrollments, guardians, budget, payroll] = await Promise.all([
        fetchAll<InvoiceBalance>((a, b) => supabase.from("invoice_balances").select("*").eq("academic_year_id", yearId).neq("state", "void").range(a, b)),
        fetchAll<Payment>((a, b) => supabase.from("payments").select("*").eq("school_id", school!.id).eq("voided", false).gte("paid_on", from).lte("paid_on", to).range(a, b)),
        fetchAll<Expense>((a, b) => supabase.from("expenses").select("*").eq("school_id", school!.id).gte("spent_on", from).lte("spent_on", to).range(a, b)),
        classes.length
          ? fetchAll<{ student_id: string; class_id: string }>((a, b) => supabase.from("enrollments").select("student_id, class_id").in("class_id", classes.map((c) => c.id)).eq("status", "active").range(a, b))
          : Promise.resolve([]),
        fetchAll<{ student_id: string; phone: string | null }>((a, b) => supabase.from("guardians").select("student_id, phone").eq("school_id", school!.id).range(a, b)),
        supabase.from("budget_lines").select("category, amount").eq("academic_year_id", yearId),
        supabase.rpc("payroll_totals", { _school_id: school!.id, _from: from, _to: to }),
      ]);
      if (budget.error) throw budget.error;
      if (payroll.error) throw payroll.error;
      return {
        invoices, payments, expenses, enrollments, guardians,
        budget: (budget.data ?? []) as { category: string; amount: number }[],
        payroll: (payroll.data ?? []) as { period: string; total_cost: number }[],
      };
    },
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  if (!data) return null;

  const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((n, x) => n + Number(f(x)), 0);
  const billed = sum(data.invoices, (i) => i.total);
  const paidOnYear = sum(data.invoices, (i) => i.paid);
  const outstanding = sum(data.invoices, (i) => i.balance);
  const overdue = sum(data.invoices.filter((i) => i.state === "overdue"), (i) => i.balance);
  const collected = sum(data.payments, (p) => p.amount);
  const spent = sum(data.expenses, (e) => e.amount);
  const salaries = sum(data.payroll, (p) => p.total_cost);

  // Outstanding per class, from each student's class this year.
  const classOf = new Map(data.enrollments.map((e) => [e.student_id, e.class_id]));
  const perClass = classes.map((c) => {
    const inv = data.invoices.filter((i) => classOf.get(i.student_id) === c.id);
    return { cls: c, billed: sum(inv, (i) => i.total), owed: sum(inv, (i) => i.balance) };
  }).filter((r) => r.billed > 0);

  // Collections per month, and by method.
  const months = [...new Set(data.payments.map((p) => p.paid_on.slice(0, 7)))].sort();
  const perMonth = months.map((m) => ({ m, n: sum(data.payments.filter((p) => p.paid_on.startsWith(m)), (p) => p.amount) }));
  const maxMonth = Math.max(0, ...perMonth.map((x) => x.n));
  const perMethod = (Object.keys(paymentMethodLabel) as PaymentMethod[])
    .map((m) => ({ m, n: sum(data.payments.filter((p) => p.method === m), (p) => p.amount) })).filter((x) => x.n > 0);

  // Budget vs actual; finalized payroll counts as "Salaries".
  const categories = [...new Set([...data.budget.map((b) => b.category), ...data.expenses.map((e) => e.category), ...(salaries ? ["Salaries"] : [])])].sort();
  const budgetRows = categories.map((c) => {
    const budget = sum(data.budget.filter((b) => b.category.toLowerCase() === c.toLowerCase()), (b) => b.amount);
    const actual = sum(data.expenses.filter((e) => e.category.toLowerCase() === c.toLowerCase()), (e) => e.amount) + (c === "Salaries" ? salaries : 0);
    return { c, budget, actual };
  });

  // Students who owe, largest first.
  const owedBy = new Map<string, number>();
  for (const i of data.invoices) if (Number(i.balance) > 0) owedBy.set(i.student_id, (owedBy.get(i.student_id) ?? 0) + Number(i.balance));
  const byId = new Map(students.map((s) => [s.id, s]));
  const debtors = [...owedBy.entries()].sort((a, b) => b[1] - a[1]);

  const exportDebtors = () => downloadCsv(`outstanding-${year?.name ?? "year"}.csv`, [
    ["Student", "Student ID", "Class", "Guardian phone", "Owed"],
    ...debtors.map(([id, owed]) => {
      const s = byId.get(id);
      const c = classes.find((x) => x.id === classOf.get(id));
      const phones = data.guardians.filter((g) => g.student_id === id && g.phone).map((g) => g.phone).join(" / ");
      return [s ? studentName(s) : "Former student", s?.student_code ?? "", c ? className(c) : "", phones, owed.toFixed(2)];
    }),
  ]);
  const exportSummary = () => downloadCsv(`finance-summary-${year?.name ?? "year"}.csv`, [
    ["Item", "Amount"],
    ["Billed", billed.toFixed(2)], ["Paid on this year's invoices", paidOnYear.toFixed(2)], ["Outstanding", outstanding.toFixed(2)],
    ["Collected between " + from + " and " + to, collected.toFixed(2)], ["Expenses", spent.toFixed(2)], ["Salaries (payroll)", salaries.toFixed(2)],
    ["Net", (collected - spent - salaries).toFixed(2)],
    [], ["Category", "Budget", "Actual"], ...budgetRows.map((r) => [r.c, r.budget.toFixed(2), r.actual.toFixed(2)]),
  ]);

  const tiles = [
    { label: "Billed", value: billed },
    { label: "Collected", value: collected, note: billed ? `${Math.round((paidOnYear / billed) * 100)}% of this year's invoices paid` : undefined },
    { label: "Outstanding", value: outstanding, note: overdue ? `${birr(overdue)} overdue` : undefined },
    { label: "Expenses and salaries", value: spent + salaries },
    { label: "Net (collected − spent)", value: collected - spent - salaries },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>{year?.name} · money in and out from {format(new Date(`${from}T00:00:00`), "d MMM yyyy")} to {format(new Date(`${to}T00:00:00`), "d MMM yyyy")}{!year?.starts_on && " (set the year's dates in School setup)"}</span>
        <Button variant="outline" size="sm" onClick={exportSummary}><Download className="mr-2 h-4 w-4" /> Summary CSV</Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardHeader className="p-3 pb-1"><CardTitle className="text-xs font-medium">{t.label}</CardTitle></CardHeader>
            <CardContent className="p-3">
              <div className={`text-lg font-semibold tabular-nums ${t.value < 0 ? "text-destructive" : ""}`}>{birr(t.value)}</div>
              {t.note && <div className="text-xs text-muted-foreground">{t.note}</div>}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Outstanding by class</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {perClass.length === 0 && <p className="text-muted-foreground">Nothing billed yet.</p>}
            {perClass.map((r) => (
              <div key={r.cls.id} className="space-y-1">
                <div className="flex justify-between"><span>{className(r.cls)}</span><span className="tabular-nums">{birr(r.owed)} <span className="text-muted-foreground">of {birr(r.billed)}</span></span></div>
                <Bar value={r.owed} max={r.billed} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Collected by month</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {perMonth.length === 0 && <p className="text-muted-foreground">No payments yet.</p>}
            {perMonth.map((x) => (
              <div key={x.m} className="grid grid-cols-[6rem_1fr_7rem] items-center gap-2">
                <span>{format(new Date(`${x.m}-01T00:00:00`), "MMM yyyy")}</span>
                <Bar value={x.n} max={maxMonth} />
                <span className="text-right tabular-nums">{birr(x.n)}</span>
              </div>
            ))}
            {perMethod.length > 0 && <div className="pt-1 text-xs text-muted-foreground">{perMethod.map((x) => `${paymentMethodLabel[x.m]} ${birr(x.n)}`).join(" · ")}</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Budget and spending</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {budgetRows.length === 0 && <p className="text-muted-foreground">No budget or expenses yet.</p>}
            {budgetRows.map((r) => (
              <div key={r.c} className="space-y-1">
                <div className="flex justify-between">
                  <span>{r.c}</span>
                  <span className={`tabular-nums ${r.budget && r.actual > r.budget ? "text-destructive" : ""}`}>
                    {birr(r.actual)} <span className="text-muted-foreground">{r.budget ? `of ${birr(r.budget)}` : "· no budget"}</span>
                  </span>
                </div>
                {r.budget > 0 && <Bar value={r.actual} max={r.budget} />}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base">Students who owe</CardTitle>
            {debtors.length > 0 && <Button variant="ghost" size="sm" onClick={exportDebtors}><Download className="mr-2 h-4 w-4" /> CSV</Button>}
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {debtors.length === 0 && <p className="text-muted-foreground">Nobody owes anything.</p>}
            {debtors.slice(0, 15).map(([id, owed]) => {
              const s = byId.get(id);
              const c = classes.find((x) => x.id === classOf.get(id));
              return (
                <div key={id} className="flex justify-between border-b py-1 last:border-0">
                  <span>{s ? studentName(s) : "Former student"} <span className="text-muted-foreground">{c ? `· ${className(c)}` : ""}</span></span>
                  <span className="tabular-nums">{birr(owed)}</span>
                </div>
              );
            })}
            {debtors.length > 15 && <p className="pt-1 text-xs text-muted-foreground">and {debtors.length - 15} more in the CSV.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
