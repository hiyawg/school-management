import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, addMonths, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { useClasses, useCurrentYear, useMyAssignments, useTerms } from "@/hooks/useSchoolData";
import { className, type EventKind, type ExamPeriod, type Holiday, type SchoolClass, type SchoolEvent } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Kind = "term" | "holiday" | "exam" | "event";
type Item = { key: string; title: string; from: string; to: string; kind: Kind; event?: SchoolEvent; detail?: string };

// One colour per kind of entry, with a matching legend.
const TONE: Record<Kind, string> = {
  term: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100",
  holiday: "bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100",
  exam: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  event: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
};
const DOT: Record<Kind, string> = { term: "bg-sky-500", holiday: "bg-rose-500", exam: "bg-amber-500", event: "bg-emerald-500" };
const LEGEND: { kind: Kind; label: string }[] = [
  { kind: "term", label: "Year and terms" },
  { kind: "holiday", label: "Holidays" },
  { kind: "exam", label: "Exams" },
  { kind: "event", label: "Events" },
];
const ymd = (d: Date) => format(d, "yyyy-MM-dd");

export default function Calendar() {
  const { school, isAdmin, isTeacher, session } = useSchool();
  const { data: year } = useCurrentYear();
  const { data: terms = [] } = useTerms(year?.id);
  const { data: classes = [] } = useClasses(year?.id);
  const mine = useMyAssignments(year?.id);
  // Administrators add events for the whole school or a class; teachers for the classes they teach.
  const eventClasses = isAdmin ? classes : isTeacher ? mine.teaching : [];
  const canAdd = isAdmin || eventClasses.length > 0;
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const from = ymd(gridStart);
  const to = ymd(gridEnd);

  const { data } = useQuery({
    queryKey: ["calendar", school?.id, from, to],
    enabled: !!school,
    queryFn: async () => {
      const [holidays, exams, events] = await Promise.all([
        supabase.from("holidays").select("*").eq("school_id", school!.id).gte("date", from).lte("date", to),
        supabase.from("exam_periods").select("*").eq("school_id", school!.id).lte("starts_on", to).gte("ends_on", from),
        supabase.from("school_events").select("*").eq("school_id", school!.id).lte("starts_on", to).gte("ends_on", from),
      ]);
      const err = holidays.error ?? exams.error ?? events.error;
      if (err) throw err;
      return { holidays: holidays.data as Holiday[], exams: exams.data as ExamPeriod[], events: events.data as SchoolEvent[] };
    },
  });

  const items: Item[] = [];
  if (year?.starts_on) items.push({ key: "ys", title: `${year.name} starts`, from: year.starts_on, to: year.starts_on, kind: "term" });
  if (year?.ends_on) items.push({ key: "ye", title: `${year.name} ends`, from: year.ends_on, to: year.ends_on, kind: "term" });
  for (const t of terms) {
    if (t.starts_on) items.push({ key: `ts${t.id}`, title: `${t.name} starts`, from: t.starts_on, to: t.starts_on, kind: "term" });
    if (t.ends_on) items.push({ key: `te${t.id}`, title: `${t.name} ends`, from: t.ends_on, to: t.ends_on, kind: "term" });
  }
  for (const h of data?.holidays ?? []) items.push({ key: `h${h.id}`, title: h.name, from: h.date, to: h.date, kind: "holiday" });
  for (const e of data?.exams ?? []) items.push({ key: `x${e.id}`, title: e.name, from: e.starts_on, to: e.ends_on, kind: "exam" });
  for (const e of data?.events ?? []) {
    const cls = classes.find((c) => c.id === e.class_id);
    items.push({ key: `e${e.id}`, title: cls ? `${className(cls)} · ${e.title}` : e.title, from: e.starts_on, to: e.ends_on, kind: "event", event: e,
      detail: [e.audience === "staff" ? "Staff only" : cls ? `${className(cls)} families` : null, e.description].filter(Boolean).join(" · ") || undefined });
  }
  const monthFrom = ymd(startOfMonth(month));
  const monthTo = ymd(endOfMonth(month));
  const inMonth = items.filter((i) => i.from <= monthTo && i.to >= monthFrom).sort((a, b) => a.from.localeCompare(b.from));

  const days: Date[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);
  const today = ymd(new Date());

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Calendar</h1>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => setMonth(startOfMonth(new Date()))}>Today</Button>
          <Button variant="outline" size="icon" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight className="h-4 w-4" /></Button>
          <span className="ml-2 min-w-36 font-medium">{format(month, "MMMM yyyy")}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-xs">
        {LEGEND.map((l) => <span key={l.kind} className={cn("rounded px-2 py-0.5", TONE[l.kind])}>{l.label}</span>)}
      </div>

      <div className="overflow-x-auto">
        <div className="grid min-w-[640px] grid-cols-7 overflow-hidden rounded-md border text-sm">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} className="border-b bg-muted/40 px-2 py-1 text-xs text-muted-foreground">{d}</div>
          ))}
          {days.map((d) => {
            const key = ymd(d);
            const here = items.filter((i) => i.from <= key && i.to >= key);
            const outside = d.getMonth() !== month.getMonth();
            return (
              <div key={key} className={cn("min-h-24 border-b border-r p-1", outside && "bg-muted/30 text-muted-foreground")}>
                <div className={cn("mb-1 w-6 rounded text-center text-xs tabular-nums", key === today && "bg-primary text-primary-foreground")}>{d.getDate()}</div>
                <div className="space-y-0.5">
                  {here.slice(0, 3).map((i) => (
                    <div key={i.key} title={i.title} className={cn("truncate rounded px-1 text-[11px] leading-4", TONE[i.kind])}>{i.title}</div>
                  ))}
                  {here.length > 3 && <div className="text-[11px] text-muted-foreground">+{here.length - 3} more</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">This month</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          {inMonth.length === 0 && <p className="text-muted-foreground">Nothing this month.</p>}
          {inMonth.map((i) => (
            <div key={i.key} className="flex items-center justify-between gap-2 border-b py-1.5 last:border-0">
              <div className="flex items-center gap-3">
                <span className="w-32 shrink-0 tabular-nums text-muted-foreground">
                  {format(new Date(`${i.from}T00:00:00`), "d MMM")}{i.to !== i.from && ` – ${format(new Date(`${i.to}T00:00:00`), "d MMM")}`}
                </span>
                <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT[i.kind])} />
                <span>{i.title}{i.detail && <span className="text-muted-foreground"> · {i.detail}</span>}</span>
              </div>
              {i.event && (isAdmin || i.event.created_by === session?.user.id) && <DeleteEvent event={i.event} />}
            </div>
          ))}
        </CardContent>
      </Card>

      {canAdd && <EventForm classes={eventClasses} wholeSchool={isAdmin} />}
      {isAdmin && (
        <p className="text-xs text-muted-foreground">
          Year and term dates come from School setup, holidays from Timetable → Holidays, exams from Exams (families see published ones).
        </p>
      )}
    </div>
  );
}

function DeleteEvent({ event }: { event: SchoolEvent }) {
  const qc = useQueryClient();
  const remove = async () => {
    if (!confirm(`Delete ${event.title}?`)) return;
    const { error } = await supabase.from("school_events").delete().eq("id", event.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["calendar"] });
  };
  return <Button variant="ghost" size="icon" aria-label={`Delete ${event.title}`} onClick={remove}><Trash2 className="h-4 w-4" /></Button>;
}

const WHOLE_SCHOOL = "school";

function EventForm({ classes, wholeSchool }: { classes: SchoolClass[]; wholeSchool: boolean }) {
  const { school, session } = useSchool();
  const qc = useQueryClient();
  const [f, setF] = useState({
    title: "", kind: "event" as EventKind, from: "", to: "", audience: "everyone" as SchoolEvent["audience"], description: "",
    target: wholeSchool ? WHOLE_SCHOOL : classes[0]?.id ?? "",
  });
  const toClass = f.target !== WHOLE_SCHOOL;
  useEffect(() => { if (!f.target && classes[0]) setF((x) => ({ ...x, target: classes[0].id })); }, [classes, f.target]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("school_events").insert({
      school_id: school!.id, title: f.title.trim(), kind: f.kind, starts_on: f.from, ends_on: f.to || f.from,
      // A class event is for that class's families and students (and all staff).
      audience: toClass ? "everyone" : f.audience, class_id: toClass ? f.target : null, created_by: session!.user.id,
      description: f.description.trim() || null,
    });
    if (error) return toast.error(error.code === "23514" ? "The end date must be on or after the start" : error.message);
    toast.success(toClass ? "Event added. The class's families and students can see it." : "Event added");
    setF({ ...f, title: "", from: "", to: "", description: "" });
    qc.invalidateQueries({ queryKey: ["calendar"] });
  };

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Add an event</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label>Title</Label><Input required placeholder="Parents' day" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
          <div className="space-y-1">
            <Label>Kind</Label>
            <Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v as EventKind })}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="event">Event</SelectItem>
                <SelectItem value="meeting">Meeting</SelectItem>
                <SelectItem value="deadline">Deadline</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>From</Label><Input type="date" required value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></div>
          <div className="space-y-1"><Label>To</Label><Input type="date" min={f.from} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></div>
          <div className="space-y-1">
            <Label>For</Label>
            <Select value={f.target} onValueChange={(v) => setF({ ...f, target: v })}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Choose class" /></SelectTrigger>
              <SelectContent>
                {wholeSchool && <SelectItem value={WHOLE_SCHOOL}>Whole school</SelectItem>}
                {classes.map((c) => <SelectItem key={c.id} value={c.id}>{className(c)} families</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {!toClass && (
            <div className="space-y-1">
              <Label>Who sees it</Label>
              <Select value={f.audience} onValueChange={(v) => setF({ ...f, audience: v as SchoolEvent["audience"] })}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="everyone">Everyone</SelectItem>
                  <SelectItem value="staff">Staff only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1"><Label>Details</Label><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
          <Button type="submit">Add</Button>
        </form>
      </CardContent>
    </Card>
  );
}
