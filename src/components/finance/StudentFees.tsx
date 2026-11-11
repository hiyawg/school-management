import { useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { printNode } from "@/lib/print";
import {
  birr, invoiceStateLabel, paymentMethodLabel, studentName,
  type InvoiceBalance, type InvoiceLine, type Payment, type PaymentMethod, type Student,
} from "@/lib/types";
import { usePrompt } from "@/components/PromptDialog";
import { invalidateFinance, stateVariant, useStudentFinance } from "./financeData";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// A student's invoices and payments. Finance staff record and void payments here; families read and print.
// readOnly: the family view, which never shows finance controls (even to an administrator who is also a parent).
export default function StudentFees({ student, readOnly = false }: { student: Student; readOnly?: boolean }) {
  const canManageFinance = useSchool().canManageFinance && !readOnly;
  const qc = useQueryClient();
  const { data, isLoading } = useStudentFinance(student.id);
  const [paying, setPaying] = useState<InvoiceBalance | null>(null);
  const [viewing, setViewing] = useState<{ kind: "invoice"; invoice: InvoiceBalance } | { kind: "receipt"; payment: Payment } | null>(null);
  const [promptDialog, ask] = usePrompt();

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const invoices = data?.invoices ?? [];
  const payments = data?.payments ?? [];
  const owed = invoices.reduce((n, i) => n + Number(i.balance), 0);

  const voidPayment = async (p: Payment) => {
    const reason = await ask({ title: `Void receipt ${p.receipt_number}`, label: "Reason (required)", confirmLabel: "Void receipt" });
    if (!reason?.trim()) return;
    const { error } = await supabase.rpc("void_payment", { _payment_id: p.id, _reason: reason });
    if (error) return toast.error(error.message);
    toast.success("Receipt voided");
    invalidateFinance(qc);
  };

  return (
    <div className="space-y-4 text-sm">
      {promptDialog}
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-muted-foreground">Outstanding:</span>
        <span className={`text-xl font-semibold tabular-nums ${owed > 0 ? "text-destructive" : ""}`}>{birr(owed)} birr</span>
      </div>

      <div className="space-y-1">
        <div className="font-medium">Invoices</div>
        {invoices.length === 0 && <p className="text-muted-foreground">No invoices yet.</p>}
        <div className="divide-y rounded-md border">
          {invoices.map((i) => (
            <div key={i.invoice_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <button className="text-left" onClick={() => setViewing({ kind: "invoice", invoice: i })}>
                <div className="font-medium underline-offset-2 hover:underline">{i.title}</div>
                <div className="text-xs text-muted-foreground">{i.number} · {i.issued_on}{i.due_on && ` · due ${i.due_on}`}</div>
              </button>
              <div className="flex items-center gap-2">
                <span className="tabular-nums">{birr(i.total)}</span>
                {Number(i.balance) > 0 && i.state !== "void" && <span className="text-xs tabular-nums text-muted-foreground">owes {birr(i.balance)}</span>}
                <Badge variant={stateVariant(i.state)}>{invoiceStateLabel[i.state]}</Badge>
                {canManageFinance && Number(i.balance) > 0 && i.state !== "void" && (
                  <Button size="sm" variant="outline" onClick={() => setPaying(i)}>Record payment</Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {payments.length > 0 && (
        <div className="space-y-1">
          <div className="font-medium">Payments</div>
          <div className="divide-y rounded-md border">
            {payments.map((p) => (
              <div key={p.id} className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 ${p.voided ? "text-muted-foreground" : ""}`}>
                <button className={`text-left ${p.voided ? "line-through" : ""}`} onClick={() => setViewing({ kind: "receipt", payment: p })}>
                  <span className="font-medium underline-offset-2 hover:underline">{p.receipt_number}</span>
                  <span className="text-muted-foreground"> · {p.paid_on} · {paymentMethodLabel[p.method]}{p.reference && ` ${p.reference}`}</span>
                </button>
                <div className="flex items-center gap-2">
                  <span className={`tabular-nums ${p.voided ? "line-through" : ""}`}>{birr(p.amount)}</span>
                  {p.voided && <Badge variant="secondary">Void: {p.void_reason}</Badge>}
                  {canManageFinance && !p.voided && <Button size="sm" variant="ghost" onClick={() => voidPayment(p)}>Void</Button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog open={!!paying} onOpenChange={(v) => !v && setPaying(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Record payment</DialogTitle></DialogHeader>
          {paying && <PaymentForm invoice={paying} onDone={(p) => { setPaying(null); if (p) setViewing({ kind: "receipt", payment: p }); }} />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewing} onOpenChange={(v) => !v && setViewing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogTitle className="sr-only">{viewing?.kind === "receipt" ? "Receipt" : "Invoice"}</DialogTitle>
          {viewing?.kind === "invoice" && (
            <InvoiceDocument student={student} invoice={viewing.invoice}
              lines={(data?.lines ?? []).filter((l) => l.invoice_id === viewing.invoice.invoice_id)}
              payments={payments.filter((p) => p.invoice_id === viewing.invoice.invoice_id)} />
          )}
          {viewing?.kind === "receipt" && (
            <ReceiptDocument student={student} payment={viewing.payment}
              invoice={invoices.find((i) => i.invoice_id === viewing.payment.invoice_id)} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PaymentForm({ invoice, onDone }: { invoice: InvoiceBalance; onDone: (p?: Payment) => void }) {
  const { school } = useSchool();
  const qc = useQueryClient();
  const [f, setF] = useState({ amount: String(Number(invoice.balance)), method: "cash" as PaymentMethod, reference: "", date: new Date().toISOString().slice(0, 10) });
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.from("payments").insert({
      school_id: school!.id, invoice_id: invoice.invoice_id, student_id: invoice.student_id,
      amount: Number(f.amount), method: f.method, reference: f.reference.trim() || null, paid_on: f.date,
      receipt_number: "",
    }).select().single();
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Receipt ${data.receipt_number}`);
    invalidateFinance(qc);
    onDone(data as Payment);
  };

  return (
    <form onSubmit={save} className="space-y-3 text-sm">
      <div className="text-muted-foreground">{invoice.number} · {invoice.title} · owes <b className="text-foreground">{birr(invoice.balance)}</b></div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1"><Label>Amount</Label><Input required inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
        <div className="space-y-1"><Label>Date</Label><Input type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
        <div className="space-y-1">
          <Label>Method</Label>
          <Select value={f.method} onValueChange={(v) => setF({ ...f, method: v as PaymentMethod })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{(Object.keys(paymentMethodLabel) as PaymentMethod[]).map((m) => <SelectItem key={m} value={m}>{paymentMethodLabel[m]}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1"><Label>Reference</Label><Input placeholder="Transaction no." value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>Save and issue receipt</Button>
        <Button type="button" variant="ghost" onClick={() => onDone()}>Cancel</Button>
      </div>
    </form>
  );
}

function Letterhead({ title, number }: { title: string; number: string }) {
  const { school } = useSchool();
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold">{school?.name}</h2>
        <div className="muted text-xs text-muted-foreground">{[school?.city, school?.region, school?.phone].filter(Boolean).join(" · ")}</div>
      </div>
      <div className="pr-6 text-right">
        <div className="font-semibold">{title}</div>
        <div className="muted text-xs text-muted-foreground">{number}</div>
      </div>
    </div>
  );
}

export function InvoiceDocument({ student, invoice, lines, payments }: {
  student: Pick<Student, "first_name" | "father_name" | "student_code">; invoice: InvoiceBalance; lines: InvoiceLine[]; payments: Payment[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const live = payments.filter((p) => !p.voided);
  return (
    <div className="space-y-3">
      <div ref={ref} className="space-y-3 text-sm">
        <Letterhead title={invoice.state === "void" ? "Invoice (void)" : "Invoice"} number={invoice.number} />
        <div>
          <b>{studentName(student)}</b>{student.student_code && <span className="muted text-muted-foreground"> · {student.student_code}</span>}
          <div className="muted text-xs text-muted-foreground">{invoice.title} · issued {invoice.issued_on}{invoice.due_on && ` · due ${invoice.due_on}`}</div>
        </div>
        <table className="w-full">
          <tbody className="[&_td]:border-b [&_td]:py-1">
            {lines.map((l) => (
              <tr key={l.id}><td className={l.kind === "discount" ? "muted text-muted-foreground" : ""}>{l.description}</td><td className="text-right tabular-nums">{birr(l.amount)}</td></tr>
            ))}
            <tr className="total font-semibold"><td>Total</td><td className="text-right tabular-nums">{birr(invoice.total)}</td></tr>
            {live.map((p) => (
              <tr key={p.id}><td className="muted text-muted-foreground">Paid {p.paid_on} ({p.receipt_number})</td><td className="text-right tabular-nums">−{birr(p.amount)}</td></tr>
            ))}
            <tr className="total text-base font-bold"><td className="pt-2">Balance due</td><td className="pt-2 text-right tabular-nums">{birr(invoice.balance)}</td></tr>
          </tbody>
        </table>
      </div>
      <Button variant="outline" size="sm" onClick={() => ref.current && printNode(ref.current, `Invoice ${invoice.number}`)}>
        <Printer className="mr-2 h-4 w-4" /> Print
      </Button>
    </div>
  );
}

export function ReceiptDocument({ student, payment, invoice }: {
  student: Pick<Student, "first_name" | "father_name" | "student_code">; payment: Payment; invoice?: InvoiceBalance;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="space-y-3">
      <div ref={ref} className="space-y-3 text-sm">
        <Letterhead title={payment.voided ? "Receipt (void)" : "Receipt"} number={payment.receipt_number} />
        <div>Received from the family of <b>{studentName(student)}</b>{student.student_code && ` (${student.student_code})`}</div>
        <table className="w-full">
          <tbody className="[&_td]:border-b [&_td]:py-1">
            <tr><td className="muted text-muted-foreground">Amount</td><td className="text-right text-base font-bold tabular-nums">{birr(payment.amount)} birr</td></tr>
            <tr><td className="muted text-muted-foreground">Date</td><td className="text-right">{payment.paid_on}</td></tr>
            <tr><td className="muted text-muted-foreground">Method</td><td className="text-right">{paymentMethodLabel[payment.method]}{payment.reference && ` · ${payment.reference}`}</td></tr>
            {invoice && <tr><td className="muted text-muted-foreground">For</td><td className="text-right">{invoice.number} · {invoice.title}</td></tr>}
            {invoice && <tr><td className="muted text-muted-foreground">Invoice balance now</td><td className="text-right tabular-nums">{birr(invoice.balance)}</td></tr>}
          </tbody>
        </table>
        {payment.voided && <p className="font-semibold text-destructive">VOID: {payment.void_reason}</p>}
      </div>
      <Button variant="outline" size="sm" onClick={() => ref.current && printNode(ref.current, `Receipt ${payment.receipt_number}`)}>
        <Printer className="mr-2 h-4 w-4" /> Print
      </Button>
    </div>
  );
}
