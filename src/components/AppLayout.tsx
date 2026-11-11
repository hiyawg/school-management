import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Archive, ArrowUpRight, Banknote, BookMarked, CalendarPlus, ClipboardPlus, FilePlus2, Link2, ListChecks, Plus as PlusIcon, StickyNote, UserCog, BookOpen, CalendarCheck, CalendarDays, CalendarOff, ChevronsLeft, ChevronsRight,
  ClipboardCheck, ClipboardList, Clock, FileText, GraduationCap, HandCoins, IdCard, LayoutDashboard, LogOut, Megaphone,
  MessageSquare, MessageSquarePlus, NotebookPen, PenLine, Plus, Printer, Receipt, RefreshCw, Search, Settings, UserPlus,
  UserSquare, Users, Wallet, type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useSchool } from "@/contexts/SchoolContext";
import AddMenu from "@/components/AddMenu";
import { useInbox, useStudents } from "@/hooks/useSchoolData";
import { roleLabel, studentName } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Page = { to: string; label: string; icon: LucideIcon; show: boolean; badge?: number };
type Module = { id: string; label: string; icon: LucideIcon; pages: Page[] };
type Action = { label: string; icon: LucideIcon; to?: string; run?: () => void; show?: boolean };
type Group = { label: string; actions: Action[] };

const PANE_KEY = "sms.navCollapsed";

// Desktop-style frame: a ribbon of grouped actions on top, a navigation pane on the left (the current section's
// pages above, every section as a large button below), and the page in a panel on the right.
export default function AppLayout() {
  const { school, roles, memberships, selectSchool, isAdmin, isStaff, isTeacher, canManageStudents, canManageFinance, isFamily, signOut, session } = useSchool();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const { data: inbox = [] } = useInbox();
  const unread = inbox.reduce((n, c) => n + c.unread, 0);
  const isStudentOnly = roles.includes("student") && !roles.includes("parent");
  const [finding, setFinding] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(PANE_KEY) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(PANE_KEY, collapsed ? "1" : "0"); } catch { /* storage unavailable */ }
  }, [collapsed]);

  const modules: Module[] = [
    { id: "desktop", label: "Desktop", icon: LayoutDashboard, pages: [
      { to: "/", label: "Summary", icon: LayoutDashboard, show: isStaff },
      { to: isStaff ? "/children" : "/", label: isStudentOnly ? "My portal" : "My children", icon: UserSquare, show: isFamily },
      { to: "/messages", label: "Messages", icon: MessageSquare, show: true, badge: unread },
      { to: "/announcements", label: "Announcements", icon: Megaphone, show: true },
      { to: "/calendar", label: "Calendar", icon: CalendarDays, show: true },
    ] },
    { id: "students", label: "Students", icon: GraduationCap, pages: [
      { to: "/students", label: "Students", icon: GraduationCap, show: isStaff },
      { to: "/admissions", label: "Admissions", icon: ClipboardList, show: canManageStudents },
      { to: "/promotion", label: "Promotion", icon: ArrowUpRight, show: isAdmin },
    ] },
    { id: "teaching", label: "Teaching", icon: BookOpen, pages: [
      { to: "/attendance", label: "Attendance", icon: CalendarCheck, show: isAdmin || isTeacher },
      { to: "/gradebook", label: "Gradebook", icon: BookOpen, show: isAdmin || isTeacher },
      { to: "/homework", label: "Homework", icon: NotebookPen, show: isAdmin || isTeacher },
      { to: "/syllabus", label: "Syllabus", icon: BookMarked, show: isAdmin || isTeacher },
      { to: "/timetable", label: "Timetable", icon: Clock, show: isStaff },
      { to: "/exams", label: "Exams", icon: FileText, show: isStaff },
      { to: "/resources", label: "Resources", icon: Archive, show: isStaff },
    ] },
    { id: "finance", label: "Finance", icon: Banknote, pages: [
      { to: "/finance?tab=invoices", label: "Invoices", icon: Receipt, show: canManageFinance },
      { to: "/finance?tab=payments", label: "Payments", icon: HandCoins, show: canManageFinance },
      { to: "/finance?tab=fees", label: "Fee structures", icon: Banknote, show: canManageFinance },
      { to: "/finance?tab=discounts", label: "Scholarships", icon: GraduationCap, show: canManageFinance },
      { to: "/finance?tab=expenses", label: "Expenses", icon: Wallet, show: canManageFinance },
      { to: "/finance?tab=reports", label: "Reports", icon: FileText, show: canManageFinance },
    ] },
    { id: "staff", label: "Staff", icon: Users, pages: [
      { to: "/staff", label: "People", icon: Users, show: isAdmin },
      { to: "/staff-attendance", label: "Staff attendance", icon: ClipboardCheck, show: isAdmin },
      { to: "/leave", label: "Leave", icon: CalendarOff, show: isStaff },
      { to: "/payroll", label: "Payroll", icon: Wallet, show: isAdmin },
      { to: "/me", label: "My page", icon: IdCard, show: isStaff },
    ] },
    { id: "setup", label: "School setup", icon: Settings, pages: [
      { to: "/setup", label: "School setup", icon: Settings, show: isAdmin },
    ] },
  ].map((m) => ({ ...m, pages: m.pages.filter((p) => p.show) })).filter((m) => m.pages.length > 0);

  // The section whose page best matches the address (students/:id belongs to Students, and so on).
  let best: { m: Module; score: number } | null = null;
  for (const m of modules) for (const p of m.pages) {
    const [path, query] = p.to.split("?");
    const match = path === "/" ? location.pathname === "/" : location.pathname === path || location.pathname.startsWith(`${path}/`);
    if (!match) continue;
    const score = path.length + (query && location.search.includes(query) ? 100 : 0);
      if (!best || score > best.score) best = { m, score };
  }
  const current = best?.m ?? modules[0];
  const isActive = (to: string) => {
    const [path, query] = to.split("?");
    if (query) return location.pathname === path && (location.search.includes(query) || (!location.search && to === current.pages[0]?.to));
    return path === "/" ? location.pathname === "/" : location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  const ribbon: Group[] = [
    { label: "Search", actions: [{ label: "Find student", icon: Search, run: () => setFinding(true), show: isStaff }] },
    ...({
      students: [{ label: "Students", actions: [
        { label: "Register student", icon: UserPlus, to: "/students?register=1", show: canManageStudents },
        { label: "New application", icon: ClipboardList, to: "/admissions?new=1", show: canManageStudents },
        { label: "Promotion", icon: ArrowUpRight, to: "/promotion", show: isAdmin },
      ] }],
      teaching: [{ label: "Class work", actions: [
        { label: "Take attendance", icon: CalendarCheck, to: "/attendance" },
        { label: "Enter grades", icon: PenLine, to: "/gradebook" },
        { label: "Set homework", icon: NotebookPen, to: "/homework" },
      ] }],
      finance: [{ label: "Money", actions: [
        { label: "Bill students", icon: Receipt, to: "/finance?tab=invoices" },
        { label: "Take payment", icon: HandCoins, to: "/finance?tab=payments" },
        { label: "Record expense", icon: Wallet, to: "/finance?tab=expenses" },
      ] }],
      staff: [{ label: "Staff", actions: [
        { label: "Request leave", icon: CalendarOff, to: "/leave" },
        { label: "Staff register", icon: ClipboardCheck, to: "/staff-attendance", show: isAdmin },
        { label: "Run payroll", icon: Wallet, to: "/payroll", show: isAdmin },
      ] }],
    } as Record<string, Group[]>)[current.id] ?? [],
    { label: "Communicate", actions: [
      { label: "New message", icon: MessageSquarePlus, to: "/messages?new=1" },
      { label: "Announcements", icon: Megaphone, to: "/announcements" },
    ] },
    { label: "View", actions: [
      { label: "Refresh", icon: RefreshCw, run: () => { qc.invalidateQueries(); toast.success("Refreshed"); } },
      { label: "Print", icon: Printer, run: () => window.print() },
    ] },
  ].map((g) => ({ ...g, actions: g.actions.filter((a) => a.show !== false) })).filter((g) => g.actions.length > 0);

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate("/", { replace: true });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const runAction = (a: Action) => (a.run ? a.run() : a.to && navigate(a.to));

  return (
    <div className="flex min-h-screen flex-col">
      {/* Title row: tab and school on the left; find, messages and the signed-in person on the right. */}
      <header className="flex items-center gap-2 bg-[hsl(var(--nav))] px-3 py-1.5 text-sm text-white print:hidden">
        <span className="rounded-t bg-[hsl(var(--ribbon))] px-3 py-1 font-medium text-[hsl(var(--foreground))]">Home</span>
        {memberships.length > 1 ? (
          <Select value={school?.id} onValueChange={selectSchool}>
            <SelectTrigger className="h-7 w-auto border-white/30 bg-transparent text-white" aria-label="Switch school"><SelectValue /></SelectTrigger>
            <SelectContent>{memberships.map((m) => <SelectItem key={m.school.id} value={m.school.id}>{m.school.name}</SelectItem>)}</SelectContent>
          </Select>
        ) : (
          <span className="hidden truncate px-2 font-medium opacity-90 sm:inline">{school?.name}</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <NewMenu />
          {isStaff && (
            <Button size="sm" className="h-7 bg-[hsl(var(--bar-from))] text-white hover:bg-[hsl(var(--bar-to))]" onClick={() => setFinding(true)}>
              <Search className="mr-1.5 h-3.5 w-3.5" /> Find student
            </Button>
          )}
          <button onClick={() => navigate("/messages")} className="relative flex h-7 items-center gap-1 rounded px-2 hover:bg-white/10" aria-label={`Messages, ${unread} unread`}>
            <MessageSquare className="h-4 w-4" />
            <span className="rounded-full bg-white/20 px-1.5 text-xs tabular-nums">{unread}</span>
          </button>
          <span className="hidden max-w-48 truncate px-2 text-xs opacity-90 md:inline" title={session?.user.email ?? ""}>
            {session?.user.email} · {roles.map((r) => roleLabel[r]).join(", ")}
          </span>
          <button onClick={handleSignOut} className="flex h-7 items-center rounded px-2 hover:bg-white/10" aria-label="Sign out" title="Sign out">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Ribbon: large grouped actions for the current section. */}
      <div className="hidden border-b bg-[hsl(var(--ribbon))] px-2 print:hidden md:flex">
        {ribbon.map((g) => (
          <div key={g.label} className="flex flex-col border-r px-2 pt-1.5 last:border-r-0">
            <div className="flex gap-0.5">
              {g.actions.map((a) => (
                <button key={a.label} onClick={() => runAction(a)}
                  className="flex w-[4.75rem] flex-col items-center gap-1 rounded px-1 py-1 text-center text-xs leading-tight text-foreground hover:bg-accent">
                  <a.icon className="h-6 w-6 text-primary" strokeWidth={1.75} />
                  {a.label}
                </button>
              ))}
            </div>
            <div className="py-0.5 text-center text-[11px] text-muted-foreground">{g.label}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-1 flex-col md:flex-row">
        {/* Navigation pane. */}
        <aside className={cn("flex flex-col border-r bg-card print:hidden md:shrink-0", collapsed ? "md:w-14" : "md:w-60")}>
          <div className="flex items-center justify-between bg-gradient-to-b from-[hsl(var(--bar-from))] to-[hsl(var(--bar-to))] px-3 py-2 text-white">
            {!collapsed && <span className="flex items-center gap-2 text-lg font-medium"><current.icon className="h-5 w-5" />{current.label}</span>}
            <button className="hidden rounded p-1 hover:bg-white/15 md:block" onClick={() => setCollapsed(!collapsed)}
              aria-label={collapsed ? "Expand navigation" : "Collapse navigation"} title={collapsed ? "Expand" : "Collapse"}>
              {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
            </button>
          </div>
          <nav className="flex gap-0.5 overflow-x-auto p-2 md:flex-1 md:flex-col" aria-label={`${current.label} pages`}>
            {current.pages.map((p) => (
              <NavLink key={p.to + p.label} to={p.to} title={p.label}
                className={cn("flex shrink-0 items-center gap-2 rounded-sm px-3 py-1.5 text-sm font-medium hover:bg-accent",
                  isActive(p.to) ? "bg-accent text-primary" : "text-foreground")}>
                <p.icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span className="truncate">{p.label}</span>}
                {!collapsed && !!p.badge && <span className="ml-auto rounded-full bg-primary px-1.5 text-xs font-semibold tabular-nums text-primary-foreground">{p.badge}</span>}
              </NavLink>
            ))}
          </nav>
          {/* Every section as a large button, like a desktop navigation pane. */}
          <div className="flex gap-0.5 overflow-x-auto bg-[hsl(var(--nav))] p-1 md:flex-col">
            {modules.map((m) => (
              <button key={m.id} onClick={() => navigate(m.pages[0].to)} title={m.label}
                className={cn("flex shrink-0 items-center gap-2.5 rounded-sm px-3 py-2 text-sm font-medium text-white/90 hover:bg-[hsl(var(--nav-hover))]",
                  m.id === current.id && "bg-gradient-to-b from-[hsl(var(--bar-from))] to-[hsl(var(--bar-to))] text-white")}>
                <m.icon className="h-5 w-5 shrink-0" />
                {!collapsed && <span>{m.label}</span>}
              </button>
            ))}
            {!collapsed && (
              <button onClick={() => navigate("/new-school")} className="hidden items-center gap-2.5 rounded-sm px-3 py-1.5 text-xs text-white/70 hover:bg-[hsl(var(--nav-hover))] md:flex">
                <Plus className="h-4 w-4" /> New school
              </button>
            )}
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-x-hidden p-3 md:p-5">
          <Outlet />
        </main>
      </div>

      {isStaff && <FindStudent open={finding} onOpenChange={setFinding} />}
    </div>
  );
}

function FindStudent({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const { data: students = [] } = useStudents();
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const results = query
    ? students.filter((s) => `${studentName(s)} ${s.grandfather_name ?? ""} ${s.student_code ?? ""}`.toLowerCase().includes(query)).slice(0, 12)
    : students.slice(0, 12);
  const go = (id: string) => { onOpenChange(false); setQ(""); navigate(`/students/${id}`); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[10vh] translate-y-0 sm:max-w-md">
        <DialogHeader><DialogTitle>Find student</DialogTitle></DialogHeader>
        <Input autoFocus placeholder="Name or student ID" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && results[0] && go(results[0].id)} />
        <div className="max-h-80 divide-y overflow-y-auto rounded-sm border text-sm">
          {results.length === 0 && <p className="p-3 text-muted-foreground">No student matches.</p>}
          {results.map((s) => (
            <button key={s.id} onClick={() => go(s.id)} className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-accent">
              <span>{studentName(s)} {s.grandfather_name}</span>
              <span className="text-xs text-muted-foreground">{s.student_code}{s.status !== "active" && ` · ${s.status}`}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// "New ▾": everything this person can create, grouped, each with its own coloured icon.
function NewMenu() {
  const { isAdmin, isTeacher, isStaff, canManageStudents, canManageFinance } = useSchool();
  const navigate = useNavigate();
  const go = (to: string) => () => navigate(to);
  const teaches = isAdmin || isTeacher;
  return (
    <AddMenu label="New" icon={PlusIcon} align="end" className="h-7 bg-white/15 hover:bg-white/25" groups={[
      { label: "Students", items: [
        { label: "New student", icon: UserPlus, color: "text-emerald-600", onSelect: go("/students?register=1"), show: canManageStudents },
        { label: "New application", icon: ClipboardList, color: "text-teal-600", onSelect: go("/admissions?new=1"), show: canManageStudents },
      ] },
      { label: "Teaching", items: [
        { label: "Take attendance", icon: CalendarCheck, color: "text-green-700", onSelect: go("/attendance"), show: teaches },
        { label: "Add assessment", icon: ListChecks, color: "text-violet-600", onSelect: go("/gradebook"), show: teaches },
        { label: "Set homework", icon: NotebookPen, color: "text-teal-600", onSelect: go("/homework"), show: teaches },
        { label: "Plan a lesson", icon: BookMarked, color: "text-indigo-600", onSelect: go("/syllabus"), show: teaches },
        { label: "Schedule an exam", icon: FileText, color: "text-amber-600", onSelect: go("/exams"), show: isAdmin },
      ] },
      { label: "Resources", items: [
        { label: "Add file", icon: FilePlus2, color: "text-orange-600", onSelect: go("/resources?add=file"), show: isStaff },
        { label: "Add link", icon: Link2, color: "text-cyan-700", onSelect: go("/resources?add=link"), show: isStaff },
        { label: "Add page", icon: StickyNote, color: "text-blue-800 dark:text-blue-300", onSelect: go("/resources?add=page"), show: isStaff },
      ] },
      { label: "Communication", items: [
        { label: "New message", icon: MessageSquarePlus, color: "text-rose-600", onSelect: go("/messages?new=1") },
        { label: "New announcement", icon: Megaphone, color: "text-amber-600", onSelect: go("/announcements"), show: teaches },
        { label: "Add event", icon: CalendarPlus, color: "text-sky-600", onSelect: go("/calendar"), show: isAdmin },
      ] },
      { label: "Finance", items: [
        { label: "Bill students", icon: Receipt, color: "text-blue-700", onSelect: go("/finance?tab=invoices"), show: canManageFinance },
        { label: "Take payment", icon: HandCoins, color: "text-emerald-700", onSelect: go("/finance?tab=payments"), show: canManageFinance },
        { label: "Add scholarship", icon: GraduationCap, color: "text-purple-600", onSelect: go("/finance?tab=discounts"), show: canManageFinance },
        { label: "Record expense", icon: Wallet, color: "text-red-600", onSelect: go("/finance?tab=expenses"), show: canManageFinance },
      ] },
      { label: "Staff", items: [
        { label: "Request leave", icon: CalendarOff, color: "text-orange-600", onSelect: go("/leave"), show: isStaff },
        { label: "Add person", icon: UserCog, color: "text-slate-600 dark:text-slate-300", onSelect: go("/staff"), show: isAdmin },
        { label: "Performance record", icon: ClipboardPlus, color: "text-pink-600", onSelect: go("/staff"), show: isAdmin },
      ] },
    ]} />
  );
}
