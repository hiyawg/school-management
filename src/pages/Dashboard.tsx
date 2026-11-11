import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { FolderOpen, Megaphone, MessageSquarePlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { useClasses, useCurrentYear, useInbox, useMembers, useMyAssignments, usePeriods, useSlots, useStudents } from "@/hooks/useSchoolData";
import { audienceLabel, className, hhmm, type Announcement } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Desk-style summary: the day's schedule on the left; messages and announcements on the right.
export default function Dashboard() {
  const { school, isAdmin, session } = useSchool();
  const { data: year } = useCurrentYear();
  const { data: classes = [] } = useClasses(year?.id);
  const { data: students = [] } = useStudents();
  const { data: members = [] } = useMembers();
  const today = format(new Date(), "yyyy-MM-dd");
  const [date, setDate] = useState(today);
  const me = members.find((m) => m.user_id === session?.user.id && m.role !== "parent");
  const myName = me?.full_name ?? session?.user.email ?? "";
  const needsSetup = !year || classes.length === 0;

  const stats = [
    { label: "Students", value: students.filter((s) => s.status === "active").length },
    { label: "Classes", value: classes.length },
    { label: "Teachers", value: new Set(members.filter((m) => m.role === "teacher").map((m) => m.user_id)).size },
  ];

  return (
    <div className="space-y-4">
      {needsSetup && isAdmin && (
        <div className="flex flex-col gap-2 rounded-sm border border-primary/40 bg-accent px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span>Finish setup: add an academic year, terms, classes and subjects.</span>
          <Button asChild size="sm"><Link to="/setup">Go to setup</Link></Button>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle className="text-lg font-medium">Summary</CardTitle></CardHeader>
        <CardContent className="grid gap-4 p-0 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="space-y-4 border-b p-4 lg:border-b-0 lg:border-r">
            <div>
              <div className="font-semibold">{school?.name}</div>
              <div className="text-sm text-muted-foreground">{year ? `Academic year ${year.name}` : "No academic year yet"}</div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {stats.map((s) => (
                <div key={s.label} className="rounded-sm border bg-[hsl(var(--ribbon))] px-3 py-2">
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                  <div className="text-xl font-semibold tabular-nums">{s.value}</div>
                </div>
              ))}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold" htmlFor="schedule-date">Date to view:</label>
              <Input id="schedule-date" type="date" className="w-56" value={date} onChange={(e) => setDate(e.target.value || today)} />
            </div>
            <Schedule date={date} yearId={year?.id} />
            {isAdmin && <RegisterStatus date={date} yearId={year?.id} />}
          </div>
          <div className="space-y-4 p-4 lg:pl-0">
            <MessagesGrid name={myName} />
            <AnnouncementsGrid />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// The signed-in teacher's lessons on the chosen day.
function Schedule({ date, yearId }: { date: string; yearId?: string }) {
  const { roles } = useSchool();
  const mine = useMyAssignments(yearId);
  const { data: periods = [] } = usePeriods();
  const { data: slots = [] } = useSlots({ subjectIds: mine.subjects.map((s) => s.id) });
  const { data: classes = [] } = useClasses(yearId);
  if (!roles.includes("teacher")) return null;
  const weekday = ((new Date(`${date}T00:00:00`).getDay() + 6) % 7) + 1;
  const lessons = slots
    .filter((s) => s.weekday === weekday)
    .map((s) => ({ slot: s, period: periods.find((p) => p.id === s.period_id), subject: mine.subjects.find((x) => x.id === s.class_subject_id) }))
    .filter((l) => l.period && l.subject)
    .sort((a, b) => a.period!.starts_at.localeCompare(b.period!.starts_at));

  return (
    <div className="space-y-2 text-sm">
      {mine.homeroom.length > 0 && <div><span className="text-muted-foreground">Homeroom:</span> {mine.homeroom.map(className).join(", ")}</div>}
      {lessons.length === 0 ? (
        <p className="py-4 text-center font-semibold">No lessons scheduled for you on this date.</p>
      ) : (
        <table className="w-full border text-sm">
          <thead><tr><th className="px-2 py-1 text-left">Time</th><th className="px-2 py-1 text-left">Class</th><th className="px-2 py-1 text-left">Subject</th><th className="px-2 py-1 text-left">Room</th></tr></thead>
          <tbody>
            {lessons.map(({ slot, period, subject }) => {
              const c = classes.find((x) => x.id === subject!.class_id);
              return (
                <tr key={slot.id} className="border-t">
                  <td className="px-2 py-1 tabular-nums">{hhmm(period!.starts_at)}–{hhmm(period!.ends_at)}</td>
                  <td className="px-2 py-1">{c ? className(c) : ""}</td>
                  <td className="px-2 py-1">{subject!.subject_name}</td>
                  <td className="px-2 py-1 text-muted-foreground">{slot.room ?? ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// For administrators: which classes have their register taken on the chosen day.
function RegisterStatus({ date, yearId }: { date: string; yearId?: string }) {
  const { school } = useSchool();
  const { data: classes = [] } = useClasses(yearId);
  const { data: rows = [] } = useQuery({
    queryKey: ["register-status", school?.id, date],
    enabled: !!school,
    queryFn: async () => {
      const { data, error } = await supabase.from("attendance").select("class_id, status").eq("school_id", school!.id).eq("date", date);
      if (error) throw error;
      return data as { class_id: string; status: string }[];
    },
  });
  if (!classes.length) return null;
  return (
    <div className="space-y-1 text-sm">
      <div className="font-semibold">Class registers</div>
      <table className="w-full border text-sm">
        <thead><tr><th className="px-2 py-1 text-left">Class</th><th className="px-2 py-1 text-left">Register</th><th className="px-2 py-1 text-right">Present</th></tr></thead>
        <tbody>
          {classes.map((c) => {
            const marks = rows.filter((r) => r.class_id === c.id);
            const present = marks.filter((r) => r.status === "present" || r.status === "late").length;
            return (
              <tr key={c.id} className="border-t">
                <td className="px-2 py-1">{className(c)}</td>
                <td className={cn("px-2 py-1", marks.length ? "" : "text-amber-700 dark:text-amber-400")}>{marks.length ? "Taken" : "Not taken"}</td>
                <td className="px-2 py-1 text-right tabular-nums">{marks.length ? `${present}/${marks.length}` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PanelBar({ title, name, actions }: { title: string; name?: string; actions: { label: string; icon: typeof FolderOpen; onClick: () => void }[] }) {
  return (
    <div className="flex items-end justify-between gap-2">
      <div className="text-sm leading-tight">
        <div>{title}</div>
        {name && <div className="font-semibold">{name}</div>}
      </div>
      <div className="flex gap-1">
        {actions.map((a) => (
          <button key={a.label} onClick={a.onClick} className="flex w-16 flex-col items-center gap-0.5 rounded px-1 py-1 text-xs hover:bg-accent">
            <a.icon className="h-5 w-5 text-primary" strokeWidth={1.75} />
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessagesGrid({ name }: { name: string }) {
  const navigate = useNavigate();
  const { data: inbox = [] } = useInbox();
  return (
    <div className="space-y-1.5">
      <PanelBar title="Messages to:" name={name} actions={[
        { label: "Open", icon: FolderOpen, onClick: () => navigate("/messages") },
        { label: "New", icon: MessageSquarePlus, onClick: () => navigate("/messages?new=1") },
      ]} />
      <div className="max-h-56 overflow-auto border">
        <table className="w-full text-sm">
          <thead><tr><th className="w-6 px-2 py-1">!</th><th className="px-2 py-1 text-left">With</th><th className="px-2 py-1 text-left">About</th><th className="px-2 py-1 text-left">Subject</th><th className="px-2 py-1 text-left">Date</th></tr></thead>
          <tbody>
            {inbox.length === 0 && <tr><td colSpan={5} className="px-2 py-6 text-center text-muted-foreground">No messages.</td></tr>}
            {inbox.slice(0, 20).map((c) => (
              <tr key={c.conversation_id} className={cn("cursor-pointer border-t", c.unread > 0 && "font-semibold")} onClick={() => navigate("/messages")}>
                <td className="px-2 py-1 text-center text-primary">{c.unread > 0 ? c.unread : ""}</td>
                <td className="px-2 py-1">{c.staff_name}</td>
                <td className="px-2 py-1">{c.student_name}</td>
                <td className="max-w-48 truncate px-2 py-1">{c.subject}</td>
                <td className="whitespace-nowrap px-2 py-1 tabular-nums">{format(new Date(c.last_message_at), "dd MMM")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AnnouncementsGrid() {
  const { school, isAdmin, isTeacher } = useSchool();
  const navigate = useNavigate();
  const { data: posts = [] } = useQuery({
    queryKey: ["announcements", school?.id, "summary"],
    enabled: !!school,
    queryFn: async () => {
      const { data, error } = await supabase.from("announcements").select("*").eq("school_id", school!.id)
        .order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(10);
      if (error) throw error;
      return data as Announcement[];
    },
  });
  return (
    <div className="space-y-1.5">
      <PanelBar title="Announcements" name={posts.length ? "Latest" : "None yet"} actions={[
        { label: "Open", icon: FolderOpen, onClick: () => navigate("/announcements") },
        ...(isAdmin || isTeacher ? [{ label: "Post", icon: Megaphone, onClick: () => navigate("/announcements") }] : []),
      ]} />
      <div className="max-h-56 overflow-auto border">
        <table className="w-full text-sm">
          <thead><tr><th className="px-2 py-1 text-left">Date</th><th className="px-2 py-1 text-left">Title</th><th className="px-2 py-1 text-left">For</th></tr></thead>
          <tbody>
            {posts.length === 0 && <tr><td colSpan={3} className="px-2 py-6 text-center text-muted-foreground">No announcements.</td></tr>}
            {posts.map((p) => (
              <tr key={p.id} className="cursor-pointer border-t" onClick={() => navigate("/announcements")}>
                <td className="whitespace-nowrap px-2 py-1 tabular-nums">{format(new Date(p.created_at), "dd MMM")}</td>
                <td className="px-2 py-1">{p.pinned && "📌 "}{p.title}</td>
                <td className="px-2 py-1 text-muted-foreground">{audienceLabel[p.audience]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
