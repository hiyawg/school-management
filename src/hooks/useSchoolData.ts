import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import type { AcademicYear, ClassSubject, Member, Period, SchoolClass, Slot, Student, Term } from "@/lib/types";

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export function useYears() {
  const { school } = useSchool();
  return useQuery({
    queryKey: ["years", school?.id],
    enabled: !!school,
    queryFn: async () =>
      must<AcademicYear[]>(
        await supabase.from("academic_years").select("*").eq("school_id", school!.id).order("name", { ascending: false }),
      ),
  });
}

export function useCurrentYear() {
  const years = useYears();
  return { ...years, data: years.data?.find((y) => y.is_current) ?? years.data?.[0] ?? null };
}

export function useTerms(yearId: string | undefined) {
  return useQuery({
    queryKey: ["terms", yearId],
    enabled: !!yearId,
    queryFn: async () => must<Term[]>(await supabase.from("terms").select("*").eq("academic_year_id", yearId!).order("name")),
  });
}

export function useClasses(yearId: string | undefined) {
  return useQuery({
    queryKey: ["classes", yearId],
    enabled: !!yearId,
    queryFn: async () =>
      must<SchoolClass[]>(
        await supabase.from("classes").select("*").eq("academic_year_id", yearId!).order("grade_level").order("section"),
      ),
  });
}

export function useClassSubjects(classId: string | undefined) {
  return useQuery({
    queryKey: ["class_subjects", classId],
    enabled: !!classId,
    queryFn: async () =>
      must<ClassSubject[]>(await supabase.from("class_subjects").select("*").eq("class_id", classId!).order("subject_name")),
  });
}

export function useStudents() {
  const { school } = useSchool();
  return useQuery({
    queryKey: ["students", school?.id],
    enabled: !!school,
    queryFn: async () =>
      must<Student[]>(await supabase.from("students").select("*").eq("school_id", school!.id).order("first_name")),
  });
}

export function useClassRoster(classId: string | undefined) {
  return useQuery({
    queryKey: ["roster", classId],
    enabled: !!classId,
    queryFn: async () => {
      const res = await supabase.from("enrollments").select("student:students(*)").eq("class_id", classId!).eq("status", "active");
      const rows = must(res) as unknown as { student: Student }[];
      return rows.map((r) => r.student).sort((a, b) => a.first_name.localeCompare(b.first_name));
    },
  });
}

export function useMembers() {
  const { school } = useSchool();
  return useQuery({
    queryKey: ["members", school?.id],
    enabled: !!school,
    queryFn: async () =>
      must<Member[]>(await supabase.from("school_members").select("*").eq("school_id", school!.id).order("role")),
  });
}

// Teachers and administrators, one entry per person (school_members has a row per role).
export function useStaffPeople() {
  const members = useMembers();
  const people = new Map<string, { userId: string; name: string; email: string | null }>();
  for (const m of members.data ?? []) {
    if (m.role !== "teacher" && m.role !== "school_admin") continue;
    const p = people.get(m.user_id) ?? { userId: m.user_id, name: "", email: m.email };
    p.name ||= m.full_name ?? "";
    people.set(m.user_id, p);
  }
  const list = [...people.values()]
    .map((p) => ({ ...p, name: p.name || p.email || p.userId.slice(0, 8) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { ...members, data: list };
}

export function useTeachers() {
  const members = useMembers();
  return { ...members, data: members.data?.filter((m) => m.role === "teacher" || m.role === "school_admin") };
}

// The signed-in teacher's classes this year: homeroom classes and the subjects they teach.
// Row level security decides what they may change; this only narrows what the pages offer.
export function useMyAssignments(yearId: string | undefined) {
  const { session } = useSchool();
  const { data: classes = [] } = useClasses(yearId);
  const userId = session?.user.id;
  const query = useQuery({
    queryKey: ["my-assignments", yearId, userId, classes.map((c) => c.id).join()],
    enabled: !!userId && classes.length > 0,
    queryFn: async () =>
      must<ClassSubject[]>(
        await supabase.from("class_subjects").select("*").eq("teacher_id", userId!).in("class_id", classes.map((c) => c.id)),
      ),
  });
  const subjects = query.data ?? [];
  const homeroom = classes.filter((c) => c.homeroom_teacher_id === userId);
  const teaching = classes.filter((c) => c.homeroom_teacher_id === userId || subjects.some((s) => s.class_id === c.id));
  return { ...query, homeroom, subjects, teaching };
}

export function usePeriods() {
  const { school } = useSchool();
  return useQuery({
    queryKey: ["periods", school?.id],
    enabled: !!school,
    queryFn: async () => must<Period[]>(await supabase.from("periods").select("*").eq("school_id", school!.id).order("starts_at")),
  });
}

// Lessons for some classes or some class subjects (a teacher's), whichever is given.
export function useSlots(filter: { classIds?: string[]; subjectIds?: string[] }) {
  const ids = filter.classIds ?? filter.subjectIds ?? [];
  const column = filter.classIds ? "class_id" : "class_subject_id";
  return useQuery({
    queryKey: ["slots", column, ids.join()],
    enabled: ids.length > 0,
    queryFn: async () => must<Slot[]>(await supabase.from("timetable_slots").select("*").in(column, ids)),
  });
}
