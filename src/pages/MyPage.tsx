import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { birr, employmentLabel, roleLabel, type Payslip, type StaffProfile } from "@/lib/types";
import StaffPerformance from "@/components/StaffPerformance";
import PayslipView from "@/components/PayslipView";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// A staff member's own record: profile, performance records and payslips.
export default function MyPage() {
  const { session, roles } = useSchool();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">My page</h1>
        <p className="text-sm text-muted-foreground">{session?.user.email} · {roles.map((r) => roleLabel[r]).join(", ")}</p>
      </div>
      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="payslips">Payslips</TabsTrigger>
        </TabsList>
        <TabsContent value="profile"><Profile /></TabsContent>
        <TabsContent value="performance">{session && <StaffPerformance userId={session.user.id} />}</TabsContent>
        <TabsContent value="payslips"><Payslips /></TabsContent>
      </Tabs>
    </div>
  );
}

function Profile() {
  const { school, session } = useSchool();
  const { data: profile, isLoading } = useQuery({
    queryKey: ["my-staff-profile", school?.id, session?.user.id],
    enabled: !!school && !!session,
    queryFn: async () => {
      const { data, error } = await supabase.from("staff_profiles").select("*")
        .eq("school_id", school!.id).eq("user_id", session!.user.id).maybeSingle();
      if (error) throw error;
      return data as StaffProfile | null;
    },
  });
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!profile) return <p className="text-sm text-muted-foreground">The school has not filled in your staff profile yet.</p>;
  const row = (label: string, value: React.ReactNode) => <div><span className="text-muted-foreground">{label}:</span> {value || "—"}</div>;
  return (
    <Card>
      <CardContent className="grid gap-2 pt-6 text-sm sm:grid-cols-2">
        {row("Employee ID", profile.employee_id)}
        {row("Employment", employmentLabel[profile.employment_type])}
        {row("Hire date", profile.hire_date)}
        {row("Qualification", profile.qualification)}
        {row("Can teach", profile.specialization)}
        {row("Date of birth", profile.date_of_birth)}
        {row("Address", profile.address)}
        {row("Emergency contact", [profile.emergency_contact_name, profile.emergency_contact_phone].filter(Boolean).join(" · "))}
        <p className="pt-2 text-xs text-muted-foreground sm:col-span-2">To correct anything here, ask a school administrator.</p>
      </CardContent>
    </Card>
  );
}

function Payslips() {
  const { school, session } = useSchool();
  const [open, setOpen] = useState<{ slip: Payslip; period: string } | null>(null);
  const { data: slips = [] } = useQuery({
    queryKey: ["my-payslips", school?.id, session?.user.id],
    enabled: !!school && !!session,
    queryFn: async () => {
      const { data, error } = await supabase.from("payslips").select("*, run:payroll_runs(period)")
        .eq("school_id", school!.id).eq("user_id", session!.user.id);
      if (error) throw error;
      return (data as unknown as (Payslip & { run: { period: string } })[])
        .sort((a, b) => b.run.period.localeCompare(a.run.period));
    },
  });

  if (slips.length === 0) return <p className="text-sm text-muted-foreground">No payslips yet. They appear here once the school finalizes a month's payroll.</p>;
  return (
    <>
      <div className="divide-y rounded-md border text-sm">
        {slips.map((s) => (
          <button key={s.id} className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted/50"
            onClick={() => setOpen({ slip: s, period: s.run.period })}>
            <span>{format(new Date(`${s.run.period}T00:00:00`), "MMMM yyyy")}</span>
            <span className="tabular-nums"><span className="text-muted-foreground">Net pay </span><b>{birr(s.net_pay)}</b></span>
          </button>
        ))}
      </div>
      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>Payslip</DialogTitle></DialogHeader>
          {open && <PayslipView slip={open.slip} period={open.period} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
