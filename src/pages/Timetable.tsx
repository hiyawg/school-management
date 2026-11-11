import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { useClasses, useClassSubjects, useCurrentYear, usePeriods, useSlots, useTeachers } from "@/hooks/useSchoolData";
import { className, hhmm, WEEKDAYS, type ClassSubject, type Holiday, type Period, type SchoolClass, type Slot } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const NONE = "none";

export default function Timetable() {
  const { isAdmin } = useSchool();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Timetable</h1>
      <Tabs defaultValue="class">
        <TabsList className="flex-wrap">
          <TabsTrigger value="class">By class</TabsTrigger>
          <TabsTrigger value="teacher">By teacher</TabsTrigger>
          {isAdmin && <TabsTrigger value="bells">Bell schedule</TabsTrigger>}
          <TabsTrigger value="holidays">Holidays</TabsTrigger>
        </TabsList>
        <TabsContent value="class"><ClassTimetable /></TabsContent>
        <TabsContent value="teacher"><TeacherTimetable /></TabsContent>
        {isAdmin && <TabsContent value="bells"><BellSchedule /></TabsContent>}
        <TabsContent value="holidays"><Holidays /></TabsContent>
      </Tabs>
    </div>
  );
}

function WeekGrid({ periods, days, cell, onCell }: {
  periods: Period[]; days: number; cell: (weekday: number, p: Period) => ReactNode; onCell?: (weekday: number, p: Period) => void;
}) {
  if (periods.length === 0) {
    return <p className="text-sm text-muted-foreground">No periods yet. An administrator sets them up under Bell schedule.</p>;
  }
  const weekdays = Array.from({ length: days }, (_, i) => i + 1);
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[640px] table-fixed text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
            <th className="w-28 px-2 py-2 text-left font-normal">Period</th>
            {weekdays.map((d) => <th key={d} className="px-2 py-2 text-left font-normal">{WEEKDAYS[d - 1]}</th>)}
          </tr>
        </thead>
        <tbody>
          {periods.map((p) => (
            <tr key={p.id} className={cn("border-b last:border-0", p.is_break && "bg-muted/40")}>
              <td className="px-2 py-1.5 align-top">
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-muted-foreground tabular-nums">{hhmm(p.starts_at)}–{hhmm(p.ends_at)}</div>
              </td>
              {p.is_break ? (
                <td colSpan={days} className="px-2 py-1.5 text-center text-xs text-muted-foreground">{p.name}</td>
              ) : weekdays.map((d) => (
                <td key={d} className="p-1 align-top">
                  <div
                    role={onCell ? "button" : undefined}
                    tabIndex={onCell ? 0 : undefined}
                    onClick={onCell ? () => onCell(d, p) : undefined}
                    onKeyDown={onCell ? (e) => (e.key === "Enter" || e.key === " ") && onCell(d, p) : undefined}
                    className={cn("min-h-12 rounded px-1.5 py-1", onCell && "cursor-pointer hover:bg-accent")}
                  >
                    {cell(d, p)}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClassTimetable() {
  const { school, isAdmin } = useSchool();
  const qc = useQueryClient();
  const { data: year } = useCurrentYear();
  const { data: classes = [] } = useClasses(year?.id);
  const { data: periods = [] } = usePeriods();
  const { data: teachers = [] } = useTeachers();
  const [classId, setClassId] = useState<string>();
  const { data: subjects = [] } = useClassSubjects(classId);
  const { data: slots = [] } = useSlots({ classIds: classId ? [classId] : [] });
  const [editing, setEditing] = useState<{ weekday: number; period: Period } | null>(null);

  useEffect(() => { if (!classId && classes[0]) setClassId(classes[0].id); }, [classes, classId]);

  const teacherName = (id: string | null) => teachers.find((t) => t.user_id === id)?.full_name ?? (id ? "Teacher" : "No teacher");
  const slotAt = (weekday: number, periodId: string) => slots.find((s) => s.weekday === weekday && s.period_id === periodId);
  const scheduled = (subjectId: string) => slots.filter((s) => s.class_subject_id === subjectId).length;

  const setTarget = async (s: ClassSubject, value: string) => {
    const n = value === "" ? null : Number(value);
    if (n === s.periods_per_week) return;
    const { error } = await supabase.from("class_subjects").update({ periods_per_week: n }).eq("id", s.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["class_subjects", classId] });
  };

  return (
    <div className="space-y-4">
      <Select value={classId} onValueChange={setClassId}>
        <SelectTrigger className="sm:w-48"><SelectValue placeholder="Select class" /></SelectTrigger>
        <SelectContent>{classes.map((c) => <SelectItem key={c.id} value={c.id}>{className(c)}</SelectItem>)}</SelectContent>
      </Select>

      {classId && (
        <WeekGrid
          periods={periods}
          days={school?.school_days ?? 5}
          onCell={isAdmin ? (weekday, period) => setEditing({ weekday, period }) : undefined}
          cell={(d, p) => {
            const s = slotAt(d, p.id);
            const subject = s && subjects.find((x) => x.id === s.class_subject_id);
            if (!subject) return isAdmin ? <span className="text-xs text-muted-foreground/60">+</span> : null;
            return (
              <>
                <div className="font-medium leading-tight">{subject.subject_name}</div>
                <div className="truncate text-xs text-muted-foreground">{teacherName(subject.teacher_id)}{s.room && ` · ${s.room}`}</div>
              </>
            );
          }}
        />
      )}

      {subjects.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Lessons per week</CardTitle>
            {isAdmin && <CardDescription>Set how many periods each subject should get; the count shows what is scheduled.</CardDescription>}
          </CardHeader>
          <CardContent className="divide-y p-0">
            {subjects.map((s) => {
              const n = scheduled(s.id);
              const target = s.periods_per_week;
              return (
                <div key={s.id} className="flex items-center justify-between gap-2 px-6 py-2 text-sm">
                  <div>
                    <div>{s.subject_name}</div>
                    <div className="text-xs text-muted-foreground">{teacherName(s.teacher_id)}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn("tabular-nums", target != null && n < target && "text-amber-600", target != null && n > target && "text-destructive")}>
                      {n}{target != null && ` / ${target}`} scheduled
                    </span>
                    {isAdmin && (
                      <Input
                        key={`${s.id}-${target}`}
                        className="h-8 w-16"
                        inputMode="numeric"
                        aria-label={`${s.subject_name} periods per week`}
                        placeholder="—"
                        defaultValue={target ?? ""}
                        onBlur={(e) => setTarget(s, e.target.value)}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {editing && classId && (
        <SlotDialog
          classId={classId}
          cls={classes.find((c) => c.id === classId)}
          weekday={editing.weekday}
          period={editing.period}
          slot={slotAt(editing.weekday, editing.period.id)}
          subjects={subjects}
          scheduled={scheduled}
          teacherName={teacherName}
          onClose={() => setEditing(null)}
        />
      )}
      {classId && subjects.length === 0 && (
        <p className="text-sm text-muted-foreground">This class has no subjects yet. Add them in School setup.</p>
      )}
    </div>
  );
}

function SlotDialog({ classId, cls, weekday, period, slot, subjects, scheduled, teacherName, onClose }: {
  classId: string; cls?: SchoolClass; weekday: number; period: Period; slot?: Slot; subjects: ClassSubject[];
  scheduled: (subjectId: string) => number; teacherName: (id: string | null) => string; onClose: () => void;
}) {
  const { school } = useSchool();
  const qc = useQueryClient();
  const [subjectId, setSubjectId] = useState(slot?.class_subject_id ?? NONE);
  const [room, setRoom] = useState(slot?.room ?? "");
  const [busy, setBusy] = useState(false);

  const done = () => {
    qc.invalidateQueries({ queryKey: ["slots"] });
    onClose();
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (subjectId === NONE) return remove();
    setBusy(true);
    const row = { school_id: school!.id, class_id: classId, period_id: period.id, weekday, class_subject_id: subjectId, room: room.trim() || null };
    const { error } = slot
      ? await supabase.from("timetable_slots").update(row).eq("id", slot.id)
      : await supabase.from("timetable_slots").insert(row);
    setBusy(false);
    if (error) return toast.error(error.message);
    done();
  };

  const remove = async () => {
    if (!slot) return onClose();
    setBusy(true);
    const { error } = await supabase.from("timetable_slots").delete().eq("id", slot.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    done();
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{cls ? className(cls) : ""} · {WEEKDAYS[weekday - 1]} · {period.name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <div className="space-y-1">
            <Label>Subject</Label>
            <Select value={subjectId} onValueChange={setSubjectId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Free period</SelectItem>
                {subjects.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.subject_name} · {teacherName(s.teacher_id)} ({scheduled(s.id)}{s.periods_per_week != null && `/${s.periods_per_week}`})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Room (optional)</Label>
            <Input placeholder="Lab 1" value={room} onChange={(e) => setRoom(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">The app refuses a lesson when the teacher or room is already busy at this time.</p>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>Save</Button>
            {slot && <Button type="button" variant="outline" disabled={busy} onClick={remove}>Clear</Button>}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TeacherTimetable() {
  const { school, session, roles } = useSchool();
  const { data: year } = useCurrentYear();
  const { data: classes = [] } = useClasses(year?.id);
  const { data: periods = [] } = usePeriods();
  const { data: teachers = [] } = useTeachers();
  const [teacherId, setTeacherId] = useState<string | undefined>(roles.includes("teacher") ? session?.user.id : undefined);

  const { data: subjects = [] } = useQuery({
    queryKey: ["teacher-subjects", teacherId, classes.map((c) => c.id).join()],
    enabled: !!teacherId && classes.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("class_subjects").select("*")
        .eq("teacher_id", teacherId!).in("class_id", classes.map((c) => c.id));
      if (error) throw error;
      return data as ClassSubject[];
    },
  });
  const { data: slots = [] } = useSlots({ subjectIds: subjects.map((s) => s.id) });
  const people = [...new Map(teachers.map((t) => [t.user_id, t])).values()];

  return (
    <div className="space-y-4">
      <Select value={teacherId} onValueChange={setTeacherId}>
        <SelectTrigger className="sm:w-60"><SelectValue placeholder="Select teacher" /></SelectTrigger>
        <SelectContent>
          {people.map((t) => <SelectItem key={t.user_id} value={t.user_id}>{t.full_name ?? t.email ?? t.user_id.slice(0, 8)}</SelectItem>)}
        </SelectContent>
      </Select>
      {teacherId && (
        <>
          <WeekGrid
            periods={periods}
            days={school?.school_days ?? 5}
            cell={(d, p) => {
              const s = slots.find((x) => x.weekday === d && x.period_id === p.id);
              const subject = s && subjects.find((x) => x.id === s.class_subject_id);
              const cls = subject && classes.find((c) => c.id === subject.class_id);
              if (!subject) return null;
              return (
                <>
                  <div className="font-medium leading-tight">{cls ? className(cls) : ""}</div>
                  <div className="truncate text-xs text-muted-foreground">{subject.subject_name}{s.room && ` · ${s.room}`}</div>
                </>
              );
            }}
          />
          <p className="text-sm text-muted-foreground">{slots.length} lessons a week</p>
        </>
      )}
    </div>
  );
}

function BellSchedule() {
  const { school, refresh } = useSchool();
  const qc = useQueryClient();
  const { data: periods = [] } = usePeriods();
  const [f, setF] = useState({ name: "", start: "", end: "", isBreak: false });

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("periods").insert({
      school_id: school!.id, name: f.name.trim() || `Period ${periods.filter((p) => !p.is_break).length + 1}`,
      starts_at: f.start, ends_at: f.end, is_break: f.isBreak,
    });
    if (error) {
      const msg = error.code === "23505" ? "A period already starts at that time" : error.code === "23514" ? "The end must be after the start" : error.message;
      return toast.error(msg);
    }
    setF({ name: "", start: f.end, end: "", isBreak: false });
    qc.invalidateQueries({ queryKey: ["periods"] });
  };

  const remove = async (p: Period) => {
    if (!confirm(`Delete ${p.name}? Lessons in this period are removed from every class's timetable.`)) return;
    const { error } = await supabase.from("periods").delete().eq("id", p.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["periods"] });
    qc.invalidateQueries({ queryKey: ["slots"] });
  };

  const setDays = async (days: 5 | 6) => {
    const { error } = await supabase.from("schools").update({ school_days: days }).eq("id", school!.id);
    if (error) return toast.error(error.message);
    await refresh();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Bell schedule</CardTitle>
        <CardDescription>The same periods apply to every class.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3 text-sm">
          <Label>School days</Label>
          <Select value={String(school?.school_days ?? 5)} onValueChange={(v) => setDays(Number(v) as 5 | 6)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="5">Monday – Friday</SelectItem>
              <SelectItem value="6">Monday – Saturday</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="divide-y rounded-md border">
          {periods.length === 0 && <p className="p-3 text-sm text-muted-foreground">No periods yet.</p>}
          {periods.map((p) => (
            <div key={p.id} className={cn("flex items-center justify-between px-3 py-2 text-sm", p.is_break && "bg-muted/40")}>
              <span>
                <span className="font-medium">{p.name}</span>{" "}
                <span className="tabular-nums text-muted-foreground">{hhmm(p.starts_at)}–{hhmm(p.ends_at)}</span>
                {p.is_break && <span className="text-muted-foreground"> · break</span>}
              </span>
              <Button variant="ghost" size="icon" aria-label={`Delete ${p.name}`} onClick={() => remove(p)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>
        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label>Name</Label><Input placeholder="Period 1" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="space-y-1"><Label>Starts</Label><Input type="time" required value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></div>
          <div className="space-y-1"><Label>Ends</Label><Input type="time" required value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></div>
          <label className="flex items-center gap-1.5 pb-2 text-sm">
            <Checkbox checked={f.isBreak} onCheckedChange={(v) => setF({ ...f, isBreak: v === true })} /> Break
          </label>
          <Button type="submit">Add</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Holidays() {
  const { school, isAdmin } = useSchool();
  const qc = useQueryClient();
  const [f, setF] = useState({ date: "", name: "" });
  const { data: holidays = [] } = useQuery({
    queryKey: ["holidays", school?.id],
    enabled: !!school,
    queryFn: async () => {
      const { data, error } = await supabase.from("holidays").select("*").eq("school_id", school!.id).order("date");
      if (error) throw error;
      return data as Holiday[];
    },
  });

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("holidays").insert({ school_id: school!.id, date: f.date, name: f.name.trim() });
    if (error) return toast.error(error.code === "23505" ? "That date is already a holiday" : error.message);
    setF({ date: "", name: "" });
    qc.invalidateQueries({ queryKey: ["holidays"] });
  };

  const remove = async (h: Holiday) => {
    const { error } = await supabase.from("holidays").delete().eq("id", h.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["holidays"] });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Holidays</CardTitle>
        <CardDescription>Days the school is closed. They are not counted as leave days.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="divide-y rounded-md border">
          {holidays.length === 0 && <p className="p-3 text-sm text-muted-foreground">None added.</p>}
          {holidays.map((h) => (
            <div key={h.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span><span className="tabular-nums text-muted-foreground">{h.date}</span> · {h.name}</span>
              {isAdmin && <Button variant="ghost" size="icon" aria-label={`Delete ${h.name}`} onClick={() => remove(h)}><Trash2 className="h-4 w-4" /></Button>}
            </div>
          ))}
        </div>
        {isAdmin && (
          <form onSubmit={add} className="flex flex-wrap items-end gap-2">
            <div className="space-y-1"><Label>Date</Label><Input type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
            <div className="space-y-1"><Label>Name</Label><Input required placeholder="Meskel" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            <Button type="submit">Add</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
