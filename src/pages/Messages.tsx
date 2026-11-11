import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, isToday } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { studentName, type InboxRow, type Message, type Student } from "@/lib/types";
import { useInbox, useStudents } from "@/hooks/useSchoolData";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const when = (iso: string) => (isToday(new Date(iso)) ? format(new Date(iso), "HH:mm") : format(new Date(iso), "d MMM"));

export default function Messages() {
  const [params, setParams] = useSearchParams();
  const { data: inbox = [] } = useInbox();
  const [openId, setOpenId] = useState<string | null>(null);
  const composing = params.has("new") || params.has("to");
  const open = inbox.find((c) => c.conversation_id === openId) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Messages</h1>
        <Button onClick={() => { setOpenId(null); setParams({ new: "1" }); }}>New message</Button>
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,320px)_1fr]">
        <Card className={cn(open || composing ? "hidden md:block" : "")}>
          <CardContent className="divide-y p-0 text-sm">
            {inbox.length === 0 && <p className="p-4 text-muted-foreground">No conversations yet.</p>}
            {inbox.map((c) => (
              <button key={c.conversation_id} onClick={() => { setOpenId(c.conversation_id); setParams({}); }}
                className={cn("block w-full px-4 py-3 text-left hover:bg-muted/50", c.conversation_id === openId && "bg-accent")}>
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("truncate", c.unread > 0 && "font-semibold")}>{c.subject}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{when(c.last_message_at)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="truncate">{c.staff_name} · about {c.student_name}</span>
                  {c.unread > 0 && <Badge className="h-5 px-1.5">{c.unread}</Badge>}
                </div>
                {c.last_message && <div className="truncate text-xs text-muted-foreground">{c.last_message}</div>}
              </button>
            ))}
          </CardContent>
        </Card>
        <div>
          {composing ? (
            <NewConversation onCreated={(id) => { setParams({}); setOpenId(id); }} onCancel={() => setParams({})} />
          ) : open ? (
            <Thread convo={open} onBack={() => setOpenId(null)} />
          ) : (
            <p className="hidden pt-4 text-sm text-muted-foreground md:block">Choose a conversation, or start a new one.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Thread({ convo, onBack }: { convo: InboxRow; onBack: () => void }) {
  const { school, session } = useSchool();
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ["thread", convo.conversation_id],
    refetchInterval: 20_000,
    queryFn: async () => {
      const [m, p] = await Promise.all([
        supabase.from("messages").select("*").eq("conversation_id", convo.conversation_id).order("created_at"),
        supabase.rpc("conversation_people", { _conversation_id: convo.conversation_id }),
      ]);
      const err = m.error ?? p.error;
      if (err) throw err;
      return { messages: m.data as Message[], people: new Map(((p.data ?? []) as { user_id: string; name: string }[]).map((x) => [x.user_id, x.name])) };
    },
  });
  const messages = data?.messages ?? [];

  // Opening the thread marks it read.
  useEffect(() => {
    if (!session || !messages.length) return;
    supabase.from("conversation_reads").upsert({ conversation_id: convo.conversation_id, user_id: session.user.id, last_read_at: new Date().toISOString() })
      .then(() => qc.invalidateQueries({ queryKey: ["inbox"] }));
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, convo.conversation_id, session, qc]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    const { error } = await supabase.from("messages").insert({ school_id: school!.id, conversation_id: convo.conversation_id, body: body.trim() });
    setBusy(false);
    if (error) return toast.error(error.message);
    setBody("");
    qc.invalidateQueries({ queryKey: ["thread", convo.conversation_id] });
    qc.invalidateQueries({ queryKey: ["inbox"] });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <button className="mb-1 text-left text-xs text-muted-foreground md:hidden" onClick={onBack}>← All messages</button>
        <CardTitle className="text-base">{convo.subject}</CardTitle>
        <div className="text-xs text-muted-foreground">With {convo.staff_name} · about {convo.student_name}</div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
          {messages.map((m) => {
            const mine = m.sender_id === session?.user.id;
            return (
              <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[80%] rounded-lg px-3 py-2 text-sm", mine ? "bg-primary text-primary-foreground" : "bg-muted")}>
                  {!mine && <div className="text-xs font-medium opacity-80">{data?.people.get(m.sender_id ?? "") ?? "Someone"}</div>}
                  <div className="whitespace-pre-line break-words">{m.body}</div>
                  <div className="mt-0.5 text-right text-[10px] opacity-70">{format(new Date(m.created_at), "d MMM HH:mm")}</div>
                </div>
              </div>
            );
          })}
          <div ref={end} />
        </div>
        <form onSubmit={send} className="flex gap-2">
          <Input placeholder="Write a reply" value={body} onChange={(e) => setBody(e.target.value)} />
          <Button type="submit" disabled={busy || !body.trim()}>Send</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function NewConversation({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const { school, session, isStaff } = useSchool();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const [studentId, setStudentId] = useState(params.get("student") ?? "");
  const [to, setTo] = useState(params.get("to") ?? "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  // Families write about their own children; staff about any student, to that student's family.
  const { data: staffStudents = [] } = useStudents();
  const { data: myChildren = [] } = useQuery({
    queryKey: ["my-children-for-messages", school?.id, session?.user.id],
    enabled: !isStaff && !!school && !!session,
    queryFn: async () => {
      const [g, self] = await Promise.all([
        supabase.from("guardians").select("student:students(*)").eq("school_id", school!.id).eq("user_id", session!.user.id),
        supabase.from("students").select("*").eq("school_id", school!.id).eq("user_id", session!.user.id),
      ]);
      const all = [...((g.data ?? []) as unknown as { student: Student }[]).map((r) => r.student), ...((self.data ?? []) as Student[])].filter(Boolean);
      return [...new Map(all.map((s) => [s.id, s])).values()];
    },
  });
  const students = isStaff ? staffStudents.filter((s) => s.status === "active") : myChildren;
  const { data: contacts = [] } = useQuery({
    queryKey: ["contacts", studentId],
    enabled: !isStaff && !!studentId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("student_contacts", { _student_id: studentId });
      if (error) throw error;
      return (data ?? []) as { user_id: string; name: string; role: string }[];
    },
  });
  useEffect(() => { if (!studentId && students.length === 1) setStudentId(students[0].id); }, [students, studentId]);
  const sorted = useMemo(() => [...students].sort((a, b) => studentName(a).localeCompare(studentName(b))), [students]);

  const start = async (e: FormEvent) => {
    e.preventDefault();
    const staffUser = isStaff ? session!.user.id : to;
    if (!studentId || !staffUser || !body.trim()) return toast.error(isStaff ? "Choose a student and write a message" : "Choose who to write to and write a message");
    setBusy(true);
    const { data: convo, error } = await supabase.from("conversations").insert({
      school_id: school!.id, student_id: studentId, staff_user_id: staffUser, subject: subject.trim() || body.trim().slice(0, 60),
    }).select().single();
    if (error) { setBusy(false); return toast.error(error.message); }
    const { error: msgError } = await supabase.from("messages").insert({ school_id: school!.id, conversation_id: convo.id, body: body.trim() });
    setBusy(false);
    if (msgError) return toast.error(msgError.message);
    qc.invalidateQueries({ queryKey: ["inbox"] });
    onCreated(convo.id);
  };

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">New message</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={start} className="space-y-3 text-sm">
          <div className="space-y-1">
            <Label>{isStaff ? "To the family of" : "About"}</Label>
            <Select value={studentId} onValueChange={(v) => { setStudentId(v); setTo(""); }}>
              <SelectTrigger><SelectValue placeholder="Choose student" /></SelectTrigger>
              <SelectContent>{sorted.map((s) => <SelectItem key={s.id} value={s.id}>{studentName(s)}{s.student_code && ` · ${s.student_code}`}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {!isStaff && (
            <div className="space-y-1">
              <Label>To</Label>
              <Select value={to} onValueChange={setTo} disabled={!studentId}>
                <SelectTrigger><SelectValue placeholder="Choose teacher or office" /></SelectTrigger>
                <SelectContent>{contacts.map((c) => <SelectItem key={c.user_id} value={c.user_id}>{c.name} · {c.role}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1"><Label>Subject</Label><Input placeholder="Homework question" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
          <div className="space-y-1">
            <Label>Message</Label>
            <textarea className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>Send</Button>
            <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          </div>
          {isStaff && <p className="text-xs text-muted-foreground">The student's guardians (and the student, if they have a login) can read and reply.</p>}
        </form>
      </CardContent>
    </Card>
  );
}
