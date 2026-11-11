import { supabase } from "@/integrations/supabase/client";
import type { School, Student } from "@/lib/types";
import { openPrintWindow, printIdCards, type IdCard } from "@/lib/idCards";

// Gathers what the cards show (first guardian's phone, a photo link valid long enough to print) and prints them.
export async function printStudentCards(students: Student[], school: School, yearName: string | null, classOf: (studentId: string) => string | null) {
  const w = openPrintWindow();
  try {
    await fillCards(w, students, school, yearName, classOf);
  } catch (e) {
    w.close();
    throw e;
  }
}

async function fillCards(w: Window, students: Student[], school: School, yearName: string | null, classOf: (studentId: string) => string | null) {
  const ids = students.map((s) => s.id);
  const phones = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from("guardians").select("student_id, phone").in("student_id", ids.slice(i, i + 200)).order("created_at");
    if (error) throw error;
    for (const g of data ?? []) if (g.phone && !phones.has(g.student_id)) phones.set(g.student_id, g.phone);
  }
  const paths = students.map((s) => s.photo_path).filter((p): p is string => !!p);
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data, error } = await supabase.storage.from("student-files").createSignedUrls(paths, 600);
    if (error) throw error;
    for (const u of data ?? []) if (u.path && u.signedUrl) urls.set(u.path, u.signedUrl);
  }
  const cards: IdCard[] = students.map((s) => ({
    schoolName: school.name,
    schoolPhone: school.phone,
    name: [s.first_name, s.father_name, s.grandfather_name].filter(Boolean).join(" "),
    code: s.student_code ?? s.id.slice(0, 8),
    className: classOf(s.id),
    year: yearName,
    dateOfBirth: s.date_of_birth,
    guardianPhone: phones.get(s.id) ?? null,
    photoUrl: s.photo_path ? urls.get(s.photo_path) ?? null : null,
  }));
  await printIdCards(cards, w);
}
