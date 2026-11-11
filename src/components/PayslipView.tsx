import { useRef } from "react";
import { format } from "date-fns";
import { Printer } from "lucide-react";
import { useSchool } from "@/contexts/SchoolContext";
import { birr, type Payslip } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { printNode } from "@/lib/print";

export default function PayslipView({ slip, period }: { slip: Payslip; period: string }) {
  const { school } = useSchool();
  const ref = useRef<HTMLDivElement>(null);
  const month = format(new Date(`${period}T00:00:00`), "MMMM yyyy");
  const line = (label: string, amount: number | string, muted = false) => (
    <tr><td className={muted ? "muted text-muted-foreground" : ""}>{label}</td><td className="text-right tabular-nums">{birr(amount)}</td></tr>
  );

  return (
    <div className="space-y-3">
      <div ref={ref} className="text-sm">
        <h2 className="text-lg font-semibold">{school?.name} · Payslip</h2>
        <div className="muted text-muted-foreground">{month}</div>
        <div className="mt-2">
          <b>{slip.full_name ?? "Staff member"}</b>
          <div className="muted text-xs text-muted-foreground">
            {slip.tin && `TIN ${slip.tin}`}{slip.tin && slip.bank_account && " · "}
            {slip.bank_account && `${slip.bank_name ?? "Bank"} ${slip.bank_account}`}
          </div>
        </div>
        <table className="mt-3 w-full">
          <tbody className="[&_td]:border-b [&_td]:py-1">
            <tr className="section"><td className="pt-3 font-semibold" colSpan={2}>Earnings</td></tr>
            {line("Basic salary", slip.basic_salary)}
            {Number(slip.unpaid_leave_deduction) > 0 && line(`Unpaid leave (${slip.unpaid_leave_days} days)`, -Number(slip.unpaid_leave_deduction), true)}
            {slip.allowances.map((a) => line(`${a.name}${a.taxable ? "" : " (non-taxable)"}`, a.amount))}
            <tr className="total font-semibold"><td>Gross pay</td><td className="text-right tabular-nums">{birr(slip.gross_pay)}</td></tr>
            <tr className="section"><td className="pt-3 font-semibold" colSpan={2}>Deductions</td></tr>
            {line(`Income tax (on ${birr(slip.taxable_income)})`, slip.income_tax)}
            {Number(slip.pension_employee) > 0 && line("Pension (employee)", slip.pension_employee)}
            {slip.deductions.map((d) => line(d.name, d.amount))}
            <tr className="total font-semibold">
              <td>Total deductions</td>
              <td className="text-right tabular-nums">{birr(Number(slip.income_tax) + Number(slip.pension_employee) + Number(slip.other_deductions))}</td>
            </tr>
            <tr className="total text-base font-bold"><td className="pt-3">Net pay</td><td className="pt-3 text-right tabular-nums">{birr(slip.net_pay)}</td></tr>
          </tbody>
        </table>
        {Number(slip.pension_employer) > 0 && (
          <p className="muted mt-2 text-xs text-muted-foreground">Employer pension contribution (not deducted from pay): {birr(slip.pension_employer)}</p>
        )}
      </div>
      <Button variant="outline" size="sm" onClick={() => ref.current && printNode(ref.current, `Payslip ${month}`)}>
        <Printer className="mr-2 h-4 w-4" /> Print
      </Button>
    </div>
  );
}
