import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { InvoiceBalance, InvoiceLine, InvoiceState, Payment } from "@/lib/types";

export const stateVariant = (s: InvoiceState) =>
  s === "paid" ? "default" : s === "overdue" ? "destructive" : s === "void" ? "secondary" : "outline";

export function useStudentFinance(studentId: string) {
  return useQuery({
    queryKey: ["student-finance", studentId],
    queryFn: async () => {
      const [inv, pay] = await Promise.all([
        supabase.from("invoice_balances").select("*").eq("student_id", studentId).order("issued_on", { ascending: false }),
        supabase.from("payments").select("*").eq("student_id", studentId).order("paid_on", { ascending: false }),
      ]);
      const err = inv.error ?? pay.error;
      if (err) throw err;
      const invoices = inv.data as InvoiceBalance[];
      const ids = invoices.map((i) => i.invoice_id);
      const lines = ids.length ? await supabase.from("invoice_lines").select("*").in("invoice_id", ids) : { data: [], error: null };
      if (lines.error) throw lines.error;
      return { invoices, payments: pay.data as Payment[], lines: (lines.data ?? []) as InvoiceLine[] };
    },
  });
}

export function invalidateFinance(qc: ReturnType<typeof useQueryClient>) {
  for (const k of ["student-finance", "finance-invoices", "finance-payments", "finance-report"]) qc.invalidateQueries({ queryKey: [k] });
}
