import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { School, SchoolRole } from "@/lib/types";

type Membership = { school: School; roles: SchoolRole[] };

type SchoolContextValue = {
  session: Session | null;
  loading: boolean;
  // Set when the schools could not be loaded, so the app does not mistake a failure for "no school yet".
  error: string | null;
  memberships: Membership[];
  school: School | null;
  roles: SchoolRole[];
  isAdmin: boolean;
  isTeacher: boolean;
  // Teachers, administrators and registrars.
  isStaff: boolean;
  // Administrators and registrars: register and edit students, admissions.
  canManageStudents: boolean;
  selectSchool: (id: string) => void;
  // Resolves to the number of schools the account belongs to.
  refresh: () => Promise<number>;
  signOut: () => Promise<void>;
};

const SchoolContext = createContext<SchoolContextValue | null>(null);
const STORAGE_KEY = "sms.currentSchool";

function readStoredSchool() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function SchoolProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [membershipsReady, setMembershipsReady] = useState(false);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(readStoredSchool);

  useEffect(() => {
    // Subscribe first so a newer auth event is never overwritten by the initial read.
    let gotEvent = false;
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      gotEvent = true;
      setSession(next);
      setAuthReady(true);
    });
    supabase.auth.getSession().then(({ data: { session: initial } }) => {
      if (!gotEvent) setSession(initial);
      setAuthReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;

  const refresh = useCallback(async () => {
    setError(null);
    if (!userId) {
      setMemberships([]);
      setMembershipsReady(true);
      return 0;
    }
    const { data, error } = await supabase
      .from("school_members")
      .select("role, school:schools(*)")
      .eq("user_id", userId);
    if (error) {
      console.error(error);
      setError(error.message);
      setMemberships([]);
      setMembershipsReady(true);
      return 0;
    }
    const bySchool = new Map<string, Membership>();
    for (const row of (data ?? []) as unknown as { role: SchoolRole; school: School }[]) {
      if (!row.school) continue;
      const entry = bySchool.get(row.school.id) ?? { school: row.school, roles: [] };
      entry.roles.push(row.role);
      bySchool.set(row.school.id, entry);
    }
    setMemberships([...bySchool.values()]);
    setMembershipsReady(true);
    return bySchool.size;
  }, [userId]);

  useEffect(() => {
    if (!authReady) return;
    setMembershipsReady(false);
    refresh();
  }, [authReady, refresh]);

  const current = memberships.find((m) => m.school.id === currentId) ?? memberships[0] ?? null;

  const selectSchool = useCallback((id: string) => {
    setCurrentId(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* storage unavailable; selection lasts for this session only */
    }
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) throw error;
    setMemberships([]);
  }, []);

  const value = useMemo<SchoolContextValue>(() => {
    const roles = current?.roles ?? [];
    return {
      session,
      loading: !authReady || (!!session && !membershipsReady),
      error,
      memberships,
      school: current?.school ?? null,
      roles,
      isAdmin: roles.includes("school_admin"),
      isTeacher: roles.includes("teacher"),
      isStaff: roles.includes("school_admin") || roles.includes("teacher") || roles.includes("registrar"),
      canManageStudents: roles.includes("school_admin") || roles.includes("registrar"),
      selectSchool,
      refresh,
      signOut,
    };
  }, [session, authReady, membershipsReady, error, memberships, current, selectSchool, refresh, signOut]);

  return <SchoolContext.Provider value={value}>{children}</SchoolContext.Provider>;
}

export function useSchool() {
  const ctx = useContext(SchoolContext);
  if (!ctx) throw new Error("useSchool must be used inside SchoolProvider");
  return ctx;
}
