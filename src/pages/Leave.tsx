import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { endOfMonth, format } from "date-fns";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { useCurrentYear, useStaffPeople } from "@/hooks/useSchoolData";
import { workingDays, type LeaveRequest, type LeaveStatus, type LeaveType } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const statusBadge: Record<LeaveStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Pending", variant: "outline" },
  approved: { label: "Approved", variant: "default" },
  rejected: { label: "Rejected", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "secondary" },
};

const range = (r: Pick<LeaveRequest, "start_date" | "end_date">) =>
  r.start_date === r.end_date ? r.start_date : `${r.start_date} → ${r.end_date}`;

function useLeaveTypes() {
  const { school } = useSchool();
  return useQuery({
    queryKey: ["leave-types", school?.id],
    enabled: !!school,
    queryFn: async () => {
      const { data, error } = await supabase.from("leave_types").select("*").eq("school_id", school!.id).order("name");
      if (error) throw error;
      return data as LeaveType[];
    },
  });
}

// Requests visible to the viewer: their own, or everyone's for an administrator.
function useLeaveRequests() {
  const { school } = useSchool();
  return useQuery({
    queryKey: ["leave-requests", school?.id],
    enabled: !!school,
    queryFn: async () => {
      const { data, error } = await supabase.from("leave_requests").select("*").eq("school_id", school!.id)
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data as LeaveRequest[];
    },
  });
}

// Balances count approved leave starting in the current academic year, or this calendar year if the
// academic year has no dates.
function useLeavePeriod() {
  const { data: year } = useCurrentYear();
  if (year?.starts_on && year.ends_on) return { from: year.starts_on, to: year.ends_on, label: year.name };
  const y = new Date().getFullYear();
  return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) };
}

export default function Leave() {
  const { isAdmin } = useSchool();
  const { data: requests = [] } = useLeaveRequests();
  const pending = requests.filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Leave</h1>
      <Tabs defaultValue="mine">
        <TabsList>
          <TabsTrigger value="mine">My leave</TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="requests">
              Requests {pending > 0 && <Badge className="ml-2 h-5 px-1.5">{pending}</Badge>}
            </TabsTrigger>
          )}
          {isAdmin && <TabsTrigger value="types">Leave types</TabsTrigger>}
        </TabsList>
        <TabsContent value="mine"><MyLeave /></TabsContent>
        {isAdmin && <TabsContent value="requests"><Requests /></TabsContent>}
        {isAdmin && <TabsContent value="types"><LeaveTypes /></TabsContent>}
      </Tabs>
    </div>
  );
}

function MyLeave() {
  const { school, session } = useSchool();
  const qc = useQueryClient();
  const { data: types = [] } = useLeaveTypes();
  const { data: all = [] } = useLeaveRequests();
  const period = useLeavePeriod();
  const mine = all.filter((r) => r.user_id === session?.user.id);
  const [f, setF] = useState({ type: "", from: "", to: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const { data: holidays = new Set<string>() } = useQuery({
    queryKey: ["holiday-dates", school?.id],
    enabled: !!school,
    queryFn: async () => {
      const { data, error } = await supabase.from("holidays").select("date").eq("school_id", school!.id);
      if (error) throw error;
      return new Set(data.map((h) => h.date as string));
    },
  });
  const days = workingDays(f.from, f.to || f.from, holidays);

  const month = format(new Date(), "yyyy-MM");
  const monthEnd = format(endOfMonth(new Date()), "yyyy-MM-dd");
  const { data: attendance = [] } = useQuery({
    queryKey: ["my-staff-attendance", school?.id, session?.user.id, month],
    enabled: !!school && !!session,
    queryFn: async () => {
      const { data, error } = await supabase.from("staff_attendance").select("status")
        .eq("school_id", school!.id).eq("user_id", session!.user.id).gte("date", `${month}-01`).lte("date", monthEnd);
      if (error) throw error;
      return data as { status: string }[];
    },
  });

  const used = (typeId: string, status: LeaveStatus) =>
    mine.filter((r) => r.leave_type_id === typeId && r.status === status && r.start_date >= period.from && r.start_date <= period.to)
      .reduce((n, r) => n + Number(r.days), 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.type) return toast.error("Choose a leave type");
    if (!days) return toast.error("Those dates have no working days");
    setBusy(true);
    const { error } = await supabase.from("leave_requests").insert({
      school_id: school!.id, leave_type_id: f.type, start_date: f.from, end_date: f.to || f.from, reason: f.reason.trim() || null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Leave requested. An administrator will review it.");
    setF({ type: "", from: "", to: "", reason: "" });
    qc.invalidateQueries({ queryKey: ["leave-requests"] });
  };

  const cancel = async (id: string) => {
    const { error } = await supabase.rpc("cancel_leave", { _request_id: id });
    if (error) return toast.error(error.message);
    toast.success("Request cancelled");
    qc.invalidateQueries({ queryKey: ["leave-requests"] });
  };

  const typeName = (id: string) => types.find((t) => t.id === id)?.name ?? "Leave";
  const count = (s: string) => attendance.filter((a) => a.status === s).length;

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 text-sm text-muted-foreground">Balance for {period.label}</div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {types.map((t) => {
            const taken = used(t.id, "approved");
            const waiting = used(t.id, "pending");
            return (
              <Card key={t.id}>
                <CardHeader className="p-3 pb-1"><CardTitle className="text-sm font-medium">{t.name}</CardTitle></CardHeader>
                <CardContent className="p-3 pt-0">
                  {t.days_per_year === null ? (
                    <div className="text-xl font-semibold tabular-nums">{taken} <span className="text-xs font-normal text-muted-foreground">days taken</span></div>
                  ) : (
                    <div className="text-xl font-semibold tabular-nums">
                      {Math.max(Number(t.days_per_year) - taken, 0)}
                      <span className="text-xs font-normal text-muted-foreground"> of {Number(t.days_per_year)} left</span>
                    </div>
                  )}
                  {waiting > 0 && <div className="text-xs text-muted-foreground">{waiting} pending</div>}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Request leave</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-4 sm:items-end">
            <div className="space-y-1">
              <Label>Type</Label>
              <Select value={f.type} onValueChange={(v) => setF({ ...f, type: v })}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{types.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>From</Label>
              <Input type="date" required value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>To</Label>
              <Input type="date" min={f.from} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
            </div>
            <div className="text-sm text-muted-foreground sm:pb-2">{f.from ? `${days} working day${days === 1 ? "" : "s"} (holidays excluded)` : ""}</div>
            <div className="space-y-1 sm:col-span-3">
              <Label>Reason</Label>
              <Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
            </div>
            <Button type="submit" disabled={busy}>Send request</Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <div className="text-sm font-medium">My requests</div>
        {mine.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
        <div className="divide-y rounded-md border">
          {mine.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
              <div>
                <div>{typeName(r.leave_type_id)} · {range(r)} <span className="text-muted-foreground">({Number(r.days)} days)</span></div>
                {(r.reason || r.decision_note) && (
                  <div className="text-xs text-muted-foreground">
                    {r.reason}{r.decision_note && ` · Reply: ${r.decision_note}`}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={statusBadge[r.status].variant}>{statusBadge[r.status].label}</Badge>
                {r.status === "pending" && <Button size="sm" variant="ghost" onClick={() => cancel(r.id)}>Cancel</Button>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="text-sm text-muted-foreground">
        My attendance this month: {count("present")} present · {count("late")} late · {count("absent")} absent · {count("on_leave")} on leave
      </div>
    </div>
  );
}

function Requests() {
  const qc = useQueryClient();
  const { data: requests = [] } = useLeaveRequests();
  const { data: types = [] } = useLeaveTypes();
  const { data: staff = [] } = useStaffPeople();
  const period = useLeavePeriod();
  const [show, setShow] = useState<"pending" | "all">("pending");
  const visible = requests.filter((r) => show === "all" || r.status === "pending");

  const nameOf = (id: string) => staff.find((p) => p.userId === id)?.name ?? "Former staff member";
  const type = (id: string) => types.find((t) => t.id === id);
  const takenBefore = (r: LeaveRequest) =>
    requests.filter((x) => x.user_id === r.user_id && x.leave_type_id === r.leave_type_id && x.status === "approved"
      && x.start_date >= period.from && x.start_date <= period.to).reduce((n, x) => n + Number(x.days), 0);

  const decide = async (r: LeaveRequest, approve: boolean) => {
    const note = prompt(approve ? "Note to the requester (optional)" : "Reason for rejecting (optional)");
    if (note === null) return;
    const { error } = await supabase.rpc("decide_leave", { _request_id: r.id, _approve: approve, _note: note || null });
    if (error) return toast.error(error.message);
    toast.success(approve ? "Approved. Those days are marked on leave." : "Rejected");
    qc.invalidateQueries({ queryKey: ["leave-requests"] });
    qc.invalidateQueries({ queryKey: ["staff-attendance"] });
  };

  return (
    <div className="space-y-4">
      <Select value={show} onValueChange={(v) => setShow(v as typeof show)}>
        <SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="pending">Waiting for a decision</SelectItem>
          <SelectItem value="all">All requests</SelectItem>
        </SelectContent>
      </Select>
      {visible.length === 0 && <p className="text-sm text-muted-foreground">{show === "pending" ? "Nothing waiting." : "No requests yet."}</p>}
      <div className="divide-y rounded-md border">
        {visible.map((r) => {
          const t = type(r.leave_type_id);
          const taken = takenBefore(r);
          const over = t?.days_per_year != null && taken + Number(r.days) > Number(t.days_per_year);
          return (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="space-y-0.5">
                <div className="font-medium">{nameOf(r.user_id)}</div>
                <div>{t?.name ?? "Leave"} · {range(r)} <span className="text-muted-foreground">({Number(r.days)} days)</span></div>
                {r.reason && <div className="text-xs text-muted-foreground">{r.reason}</div>}
                {r.status === "pending" && t?.days_per_year != null && (
                  <div className={`text-xs ${over ? "text-destructive" : "text-muted-foreground"}`}>
                    Already taken {taken} of {Number(t.days_per_year)} this year{over && " · this request goes over the allowance"}
                  </div>
                )}
              </div>
              {r.status === "pending" ? (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => decide(r, true)}>Approve</Button>
                  <Button size="sm" variant="outline" onClick={() => decide(r, false)}>Reject</Button>
                </div>
              ) : (
                <Badge variant={statusBadge[r.status].variant}>{statusBadge[r.status].label}</Badge>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LeaveTypes() {
  const { school } = useSchool();
  const qc = useQueryClient();
  const { data: types = [] } = useLeaveTypes();
  const [f, setF] = useState({ name: "", days: "", paid: true });
  const refresh = () => qc.invalidateQueries({ queryKey: ["leave-types"] });

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("leave_types").insert({
      school_id: school!.id, name: f.name.trim(), days_per_year: f.days === "" ? null : Number(f.days), paid: f.paid,
    });
    if (error) return toast.error(error.code === "23505" ? "A leave type with that name exists" : error.message);
    setF({ name: "", days: "", paid: true });
    refresh();
  };

  const update = async (t: LeaveType, patch: Partial<LeaveType>) => {
    const { error } = await supabase.from("leave_types").update(patch).eq("id", t.id);
    if (error) return toast.error(error.message);
    refresh();
  };

  const remove = async (t: LeaveType) => {
    if (!confirm(`Delete leave type "${t.name}"?`)) return;
    const { error } = await supabase.from("leave_types").delete().eq("id", t.id);
    if (error) return toast.error(error.code === "23503" ? `"${t.name}" is used by leave requests, so it can't be deleted` : error.message);
    refresh();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Leave types</CardTitle>
        <CardDescription>
          The starting list follows the Ethiopian Labour Proclamation 1156/2019. Check it against your school's policy and
          staff contracts. Leave the allowance empty for types without a fixed number of days.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="divide-y rounded-md border">
          {types.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-28 flex-1 font-medium">{t.name}</span>
              <div className="flex items-center gap-1">
                <Input
                  className="h-8 w-20"
                  inputMode="decimal"
                  aria-label={`${t.name} days per year`}
                  defaultValue={t.days_per_year ?? ""}
                  placeholder="No limit"
                  onBlur={(e) => {
                    const v = e.target.value === "" ? null : Number(e.target.value);
                    if (v !== (t.days_per_year === null ? null : Number(t.days_per_year))) update(t, { days_per_year: v });
                  }}
                />
                <span className="text-muted-foreground">days / year</span>
              </div>
              <label className="flex items-center gap-1.5">
                <Checkbox checked={t.paid} onCheckedChange={(v) => update(t, { paid: v === true })} /> Paid
              </label>
              <Button variant="ghost" size="icon" aria-label={`Delete ${t.name}`} onClick={() => remove(t)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>
        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label>New type</Label><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="space-y-1"><Label>Days / year</Label><Input className="w-24" inputMode="decimal" placeholder="No limit" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} /></div>
          <label className="flex items-center gap-1.5 pb-2 text-sm">
            <Checkbox checked={f.paid} onCheckedChange={(v) => setF({ ...f, paid: v === true })} /> Paid
          </label>
          <Button type="submit">Add</Button>
        </form>
      </CardContent>
    </Card>
  );
}
