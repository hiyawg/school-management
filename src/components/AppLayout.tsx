import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { ArrowUpRight, BookMarked, CalendarDays, FileText, BookOpen, CalendarCheck, CalendarOff, ClipboardCheck, Clock, ClipboardList, IdCard, Wallet, GraduationCap, LayoutDashboard, LogOut, Plus, Settings, Users, UserSquare } from "lucide-react";
import { toast } from "sonner";
import { useSchool } from "@/contexts/SchoolContext";
import { roleLabel } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export default function AppLayout() {
  const { school, roles, memberships, selectSchool, isAdmin, isStaff, isTeacher, canManageStudents, signOut, session } = useSchool();
  const navigate = useNavigate();

  const links = [
    { to: "/", label: "Dashboard", icon: LayoutDashboard, show: isStaff },
    { to: "/students", label: "Students", icon: GraduationCap, show: isStaff },
    { to: "/admissions", label: "Admissions", icon: ClipboardList, show: canManageStudents },
    { to: "/attendance", label: "Attendance", icon: CalendarCheck, show: isAdmin || isTeacher },
    { to: "/gradebook", label: "Gradebook", icon: BookOpen, show: isAdmin || isTeacher },
    { to: "/timetable", label: "Timetable", icon: Clock, show: isStaff },
    { to: "/syllabus", label: "Syllabus", icon: BookMarked, show: isAdmin || isTeacher },
    { to: "/exams", label: "Exams", icon: FileText, show: isStaff },
    { to: "/calendar", label: "Calendar", icon: CalendarDays, show: true },
    { to: "/leave", label: "Leave", icon: CalendarOff, show: isStaff },
    { to: "/staff", label: "People", icon: Users, show: isAdmin },
    { to: "/staff-attendance", label: "Staff attendance", icon: ClipboardCheck, show: isAdmin },
    { to: "/payroll", label: "Payroll", icon: Wallet, show: isAdmin },
    { to: "/promotion", label: "Promotion", icon: ArrowUpRight, show: isAdmin },
    { to: "/setup", label: "School setup", icon: Settings, show: isAdmin },
    { to: "/me", label: "My page", icon: IdCard, show: isStaff },
    { to: isStaff ? "/children" : "/", label: "My children", icon: UserSquare, show: roles.includes("parent") },
  ].filter((l) => l.show);

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate("/", { replace: true });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b bg-card md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        <div className="space-y-3 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">School</div>
          {memberships.length > 1 ? (
            <Select value={school?.id} onValueChange={selectSchool}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {memberships.map((m) => (
                  <SelectItem key={m.school.id} value={m.school.id}>{m.school.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="font-semibold leading-tight">{school?.name}</div>
          )}
          <div className="text-xs text-muted-foreground">{roles.map((r) => roleLabel[r]).join(" · ")}</div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:pb-4">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to + label}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  isActive && "bg-accent text-accent-foreground",
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden space-y-2 border-t p-4 md:block">
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => navigate("/new-school")}>
            <Plus className="mr-2 h-4 w-4" /> New school
          </Button>
          <div className="truncate px-3 text-xs text-muted-foreground">{session?.user.email}</div>
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={handleSignOut}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden p-4 md:p-8">
        <Outlet />
        <div className="mt-10 border-t pt-4 md:hidden">
          <Button variant="ghost" size="sm" onClick={handleSignOut}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </div>
      </main>
    </div>
  );
}
