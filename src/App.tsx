import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { SchoolProvider, useSchool } from "@/contexts/SchoolContext";
import AppLayout from "@/components/AppLayout";
import Auth from "@/pages/Auth";
import CreateSchool from "@/pages/CreateSchool";
import NoSchool from "@/pages/NoSchool";
import Dashboard from "@/pages/Dashboard";
import Setup from "@/pages/Setup";
import Staff from "@/pages/Staff";
import Students from "@/pages/Students";
import Attendance from "@/pages/Attendance";
import Gradebook from "@/pages/Gradebook";
import MyChildren from "@/pages/MyChildren";
import Promotion from "@/pages/Promotion";
import StaffAttendance from "@/pages/StaffAttendance";
import Leave from "@/pages/Leave";
import Timetable from "@/pages/Timetable";
import Admissions from "@/pages/Admissions";
import Payroll from "@/pages/Payroll";
import MyPage from "@/pages/MyPage";
import Syllabus from "@/pages/Syllabus";
import Exams from "@/pages/Exams";
import Calendar from "@/pages/Calendar";
import Finance from "@/pages/finance/Finance";
import Announcements from "@/pages/Announcements";
import Messages from "@/pages/Messages";
import HomeworkPage from "@/pages/HomeworkPage";
import StudentRecord from "@/pages/StudentRecord";

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } });

function Gate() {
  const { session, loading, error, refresh, signOut, memberships, isAdmin, isStaff, isTeacher, canManageStudents, canManageFinance } = useSchool();

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>;
  }
  if (!session) return <Auth />;
  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-4 text-center">
        <p className="font-medium">Your schools could not be loaded.</p>
        <p className="max-w-md text-sm text-muted-foreground">{error}</p>
        <div className="flex gap-2">
          <Button onClick={() => refresh()}>Try again</Button>
          <Button variant="ghost" onClick={() => signOut()}>Sign out</Button>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/new-school" element={<CreateSchool />} />
      {memberships.length === 0 ? (
        <Route path="*" element={<NoSchool />} />
      ) : (
        <Route element={<AppLayout />}>
          <Route index element={isStaff ? <Dashboard /> : <MyChildren />} />
          {isAdmin && <Route path="setup" element={<Setup />} />}
          {isAdmin && <Route path="staff" element={<Staff />} />}
          {isAdmin && <Route path="promotion" element={<Promotion />} />}
          {isAdmin && <Route path="staff-attendance" element={<StaffAttendance />} />}
          {isStaff && <Route path="leave" element={<Leave />} />}
          {isStaff && <Route path="timetable" element={<Timetable />} />}
          {isStaff && <Route path="students" element={<Students />} />}
          {isStaff && <Route path="students/:id" element={<StudentRecord />} />}
          {(isAdmin || isTeacher) && <Route path="attendance" element={<Attendance />} />}
          {(isAdmin || isTeacher) && <Route path="gradebook" element={<Gradebook />} />}
          {canManageStudents && <Route path="admissions" element={<Admissions />} />}
          {isAdmin && <Route path="payroll" element={<Payroll />} />}
          {isStaff && <Route path="me" element={<MyPage />} />}
          {(isAdmin || isTeacher) && <Route path="syllabus" element={<Syllabus />} />}
          {isStaff && <Route path="exams" element={<Exams />} />}
          <Route path="calendar" element={<Calendar />} />
          {canManageFinance && <Route path="finance" element={<Finance />} />}
          <Route path="announcements" element={<Announcements />} />
          <Route path="messages" element={<Messages />} />
          {(isAdmin || isTeacher) && <Route path="homework" element={<HomeworkPage />} />}
          <Route path="children" element={<MyChildren />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      )}
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SchoolProvider>
        <BrowserRouter>
          <Gate />
        </BrowserRouter>
        <Toaster richColors position="top-right" />
      </SchoolProvider>
    </QueryClientProvider>
  );
}
