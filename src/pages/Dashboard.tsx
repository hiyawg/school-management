import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { useClasses, useCurrentYear, useMembers, useMyAssignments, usePeriods, useSlots, useStudents } from "@/hooks/useSchoolData";
import { className, hhmm } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function Dashboard() {
  const { school, isAdmin, roles } = useSchool();
  const { data: year } = useCurrentYear();
  const { data: classes = [] } = useClasses(year?.id);
  const { data: students = [] } = useStudents();
  const { data: members = [] } = useMembers();
  const mine = useMyAssignments(year?.id);
  const { data: periods = [] } = usePeriods();
  const { data: mySlots = [] } = useSlots({ subjectIds: mine.subjects.map((s) => s.id) });
  const weekday = ((new Date().getDay() + 6) % 7) + 1; // 1 = Monday
  const todaysLessons = mySlots
    .filter((s) => s.weekday === weekday)
    .map((s) => ({ slot: s, period: periods.find((p) => p.id === s.period_id), subject: mine.subjects.find((x) => x.id === s.class_subject_id) }))
    .filter((l) => l.period && l.subject)
    .sort((a, b) => a.period!.starts_at.localeCompare(b.period!.starts_at));
  const today = format(new Date(), "yyyy-MM-dd");

  const { data: todays = [] } = useQuery({
    queryKey: ["attendance-today", school?.id, today],
    enabled: !!school,
    queryFn: async () => {
      const { data, error } = await supabase.from("attendance").select("status").eq("school_id", school!.id).eq("date", today);
      if (error) throw error;
      return data as { status: string }[];
    },
  });

  const present = todays.filter((a) => a.status === "present" || a.status === "late").length;
  const teachers = members.filter((m) => m.role === "teacher").length;
  const needsSetup = !year || classes.length === 0;

  const stats = [
    { label: "Students", value: students.filter((s) => s.status === "active").length },
    { label: "Classes", value: classes.length },
    { label: "Teachers", value: teachers },
    { label: "Present today", value: todays.length ? `${present}/${todays.length}` : "—" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{school?.name}</h1>
        <p className="text-sm text-muted-foreground">{year ? `Academic year ${year.name}` : "No academic year yet"}</p>
      </div>

      {needsSetup && isAdmin && (
        <Card className="border-primary/40 bg-accent/40">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm">Finish setup: add an academic year, terms, classes and subjects.</p>
            <Button asChild size="sm"><Link to="/setup">Go to setup</Link></Button>
          </CardContent>
        </Card>
      )}

      {roles.includes("teacher") && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">My classes</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {mine.homeroom.length === 0 && mine.subjects.length === 0 && (
              <p className="text-muted-foreground">You are not assigned to any class this year.</p>
            )}
            {mine.homeroom.length > 0 && (
              <div><span className="text-muted-foreground">Homeroom:</span> {mine.homeroom.map(className).join(", ")}</div>
            )}
            {mySlots.length > 0 && (
              <div>
                <div className="text-muted-foreground">Today:</div>
                {todaysLessons.length === 0 && <div className="text-muted-foreground">No lessons.</div>}
                {todaysLessons.map(({ slot, period, subject }) => {
                  const c = classes.find((x) => x.id === subject!.class_id);
                  return (
                    <div key={slot.id} className="flex gap-3">
                      <span className="w-24 tabular-nums text-muted-foreground">{hhmm(period!.starts_at)}–{hhmm(period!.ends_at)}</span>
                      <span>{subject!.subject_name}{c && ` · ${className(c)}`}{slot.room && ` · ${slot.room}`}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {mine.subjects.length > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span className="text-muted-foreground">Teaching:</span>
                {mine.subjects.map((s) => {
                  const c = classes.find((x) => x.id === s.class_id);
                  return <span key={s.id}>{s.subject_name}{c && ` · ${className(c)}`}</span>;
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle></CardHeader>
            <CardContent className="text-3xl font-semibold tabular-nums">{s.value}</CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {[
          { to: "/attendance", title: "Take attendance", body: "Mark today's register for a class." },
          { to: "/gradebook", title: "Gradebook", body: "Record scores and assign learning-app skills." },
          { to: "/students", title: "Students", body: "Register students, guardians and enrollment." },
        ].map((c) => (
          <Link key={c.to} to={c.to}>
            <Card className="h-full transition-colors hover:border-primary">
              <CardHeader><CardTitle className="text-base">{c.title}</CardTitle></CardHeader>
              <CardContent className="text-sm text-muted-foreground">{c.body}</CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
