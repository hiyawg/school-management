import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { endOfMonth, format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { useStaffPeople } from "@/hooks/useSchoolData";
import type { StaffAttendanceStatus } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const STATUSES: { value: StaffAttendanceStatus; label: string; short: string; tone: string }[] = [
  { value: "present", label: "Present", short: "P", tone: "bg-emerald-600 text-white border-emerald-600" },
  { value: "late", label: "Late", short: "L", tone: "bg-amber-500 text-white border-amber-500" },
  { value: "absent", label: "Absent", short: "A", tone: "bg-red-600 text-white border-red-600" },
  { value: "on_leave", label: "On leave", short: "OL", tone: "bg-sky-600 text-white border-sky-600" },
];

type Mark = { status?: StaffAttendanceStatus; checkIn: string };
type Row = { user_id: string; date: string; status: StaffAttendanceStatus; check_in: string | null };

export default function StaffAttendance() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Staff attendance</h1>
      <Tabs defaultValue="daily">
        <TabsList>
          <TabsTrigger value="daily">Daily register</TabsTrigger>
          <TabsTrigger value="month">Monthly summary</TabsTrigger>
        </TabsList>
        <TabsContent value="daily"><DailyRegister /></TabsContent>
        <TabsContent value="month"><MonthSummary /></TabsContent>
      </Tabs>
    </div>
  );
}

function DailyRegister() {
  const { school } = useSchool();
  const qc = useQueryClient();
  const { data: staff = [] } = useStaffPeople();
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [saving, setSaving] = useState(false);

  const { data: saved } = useQuery({
    queryKey: ["staff-attendance", school?.id, date],
    enabled: !!school,
    queryFn: async () => {
      const { data, error } = await supabase.from("staff_attendance").select("user_id, date, status, check_in")
        .eq("school_id", school!.id).eq("date", date);
      if (error) throw error;
      return data as Row[];
    },
  });

  useEffect(() => {
    setMarks(Object.fromEntries((saved ?? []).map((r) => [r.user_id, { status: r.status, checkIn: r.check_in?.slice(0, 5) ?? "" }])));
  }, [saved]);

  const mark = (userId: string, patch: Partial<Mark>) =>
    setMarks((m) => ({ ...m, [userId]: { checkIn: "", ...m[userId], ...patch } }));
  const markRestPresent = () =>
    setMarks((m) => Object.fromEntries(staff.map((p) => [p.userId, m[p.userId]?.status ? m[p.userId] : { checkIn: "", status: "present" as const }])));

  const save = async () => {
    const rows = staff
      .filter((p) => marks[p.userId]?.status)
      .map((p) => ({
        school_id: school!.id, user_id: p.userId, date,
        status: marks[p.userId].status!, check_in: marks[p.userId].checkIn || null,
      }));
    if (!rows.length) return toast.error("Mark at least one person");
    setSaving(true);
    const { error } = await supabase.from("staff_attendance").upsert(rows, { onConflict: "school_id,user_id,date" });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`Saved ${rows.length} of ${staff.length}`);
    qc.invalidateQueries({ queryKey: ["staff-attendance"] });
  };

  const counts = STATUSES.map((s) => ({ ...s, n: Object.values(marks).filter((m) => m.status === s.value).length }));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input type="date" value={date} max={format(new Date(), "yyyy-MM-dd")} onChange={(e) => setDate(e.target.value)} className="sm:w-44" />
        <Button variant="outline" onClick={markRestPresent} disabled={!staff.length}>Mark the rest present</Button>
      </div>
      <div className="flex flex-wrap gap-3 text-sm">
        {counts.map((c) => <span key={c.value}><b className="tabular-nums">{c.n}</b> {c.label}</span>)}
        <span className="text-muted-foreground">of {staff.length}</span>
      </div>
      <Card>
        <CardContent className="divide-y p-0">
          {staff.length === 0 && <p className="p-4 text-sm text-muted-foreground">No teachers or administrators yet. Add them under People.</p>}
          {staff.map((p) => {
            const m = marks[p.userId];
            return (
              <div key={p.userId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <div className="min-w-0 truncate text-sm">{p.name}</div>
                <div className="flex shrink-0 items-center gap-1">
                  {STATUSES.map((st) => (
                    <button
                      key={st.value}
                      title={st.label}
                      onClick={() => mark(p.userId, { status: st.value })}
                      className={cn(
                        "h-8 min-w-8 rounded-md border px-1.5 text-xs font-semibold",
                        m?.status === st.value ? st.tone : "text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {st.short}
                    </button>
                  ))}
                  <Input
                    type="time"
                    aria-label="Check-in time"
                    title="Check-in time"
                    value={m?.checkIn ?? ""}
                    disabled={m?.status !== "present" && m?.status !== "late"}
                    onChange={(e) => mark(p.userId, { checkIn: e.target.value })}
                    className="ml-1 h-8 w-28"
                  />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">Approved leave appears here as "On leave" automatically.</p>
      <Button onClick={save} disabled={saving || !staff.length}>Save register</Button>
    </div>
  );
}

function MonthSummary() {
  const { school } = useSchool();
  const { data: staff = [] } = useStaffPeople();
  const [month, setMonth] = useState(format(new Date(), "yyyy-MM"));
  const from = `${month}-01`;
  const to = format(endOfMonth(new Date(`${from}T00:00:00`)), "yyyy-MM-dd");

  const { data: rows = [] } = useQuery({
    queryKey: ["staff-attendance-month", school?.id, month],
    enabled: !!school && !!month,
    queryFn: async () => {
      const { data, error } = await supabase.from("staff_attendance").select("user_id, date, status, check_in")
        .eq("school_id", school!.id).gte("date", from).lte("date", to);
      if (error) throw error;
      return data as Row[];
    },
  });

  return (
    <div className="space-y-4">
      <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="sm:w-44" />
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-normal">Name</th>
                {STATUSES.map((s) => <th key={s.value} className="px-2 py-2 text-right font-normal">{s.label}</th>)}
                <th className="px-4 py-2 text-right font-normal">Days marked</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((p) => {
                const mine = rows.filter((r) => r.user_id === p.userId);
                return (
                  <tr key={p.userId} className="border-b last:border-0">
                    <td className="px-4 py-2">{p.name}</td>
                    {STATUSES.map((s) => {
                      const n = mine.filter((r) => r.status === s.value).length;
                      return (
                        <td key={s.value} className={cn("px-2 py-2 text-right tabular-nums", s.value === "absent" && n > 0 && "font-semibold text-destructive")}>
                          {n || "—"}
                        </td>
                      );
                    })}
                    <td className="px-4 py-2 text-right tabular-nums">{mine.length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
