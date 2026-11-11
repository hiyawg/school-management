import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { useClasses, useCurrentYear } from "@/hooks/useSchoolData";
import {
  className, EVALUATION_CRITERIA, evaluationKindLabel,
  type ClassSubject, type Evaluation, type EvaluationKind,
} from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const NONE = "none";
const kindVariant = (k: EvaluationKind) => (k === "commendation" ? "default" : k === "concern" ? "destructive" : "secondary");

// One person's performance records. Administrators add and delete; the person reads shared ones and acknowledges.
export default function StaffPerformance({ userId }: { userId: string }) {
  const { school, isAdmin, session } = useSchool();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const isSelf = session?.user.id === userId;

  const { data: records = [] } = useQuery({
    queryKey: ["evaluations", school?.id, userId],
    enabled: !!school,
    queryFn: async () => {
      const { data, error } = await supabase.from("staff_evaluations").select("*")
        .eq("school_id", school!.id).eq("user_id", userId).order("date", { ascending: false });
      if (error) throw error;
      return data as Evaluation[];
    },
  });
  const { data: subjects = [] } = useTeacherSubjects(userId);
  const refresh = () => qc.invalidateQueries({ queryKey: ["evaluations"] });

  const remove = async (r: Evaluation) => {
    if (!confirm("Delete this record?")) return;
    const { error } = await supabase.from("staff_evaluations").delete().eq("id", r.id);
    if (error) return toast.error(error.message);
    refresh();
  };

  const acknowledge = async (r: Evaluation) => {
    const response = prompt("Your reply (optional). It is shown with the record.", r.staff_response ?? "");
    if (response === null) return;
    const { error } = await supabase.rpc("acknowledge_evaluation", { _id: r.id, _response: response || null });
    if (error) return toast.error(error.message);
    toast.success("Acknowledged");
    refresh();
  };

  const rated = records.filter((r) => r.overall !== null);
  const average = rated.length ? Math.round((rated.reduce((n, r) => n + Number(r.overall), 0) / rated.length) * 10) / 10 : null;

  return (
    <div className="space-y-4 text-sm">
      {rated.length > 0 && (
        <div className="text-muted-foreground">
          Average rating <b className="text-foreground tabular-nums">{average}</b> / 5 across {rated.length} rated record{rated.length > 1 ? "s" : ""}
        </div>
      )}
      {records.length === 0 && <p className="text-muted-foreground">No records yet.</p>}
      {records.map((r) => {
        const subject = subjects.find((s) => s.id === r.class_subject_id);
        return (
          <div key={r.id} className="space-y-2 rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={kindVariant(r.kind)}>{evaluationKindLabel[r.kind]}</Badge>
                <span className="tabular-nums text-muted-foreground">{r.date}</span>
                {subject && <span className="text-muted-foreground">· {subject.label}</span>}
                {isAdmin && !r.shared && <Badge variant="outline">Not shared</Badge>}
              </div>
              <div className="flex items-center gap-2">
                {r.overall !== null && <span className="font-semibold tabular-nums">{Number(r.overall)} / 5</span>}
                {isAdmin && !isSelf && (
                  <Button variant="ghost" size="icon" aria-label="Delete record" onClick={() => remove(r)}><Trash2 className="h-4 w-4" /></Button>
                )}
              </div>
            </div>
            {Object.keys(r.ratings).length > 0 && (
              <div className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
                {EVALUATION_CRITERIA.filter((c) => r.ratings[c.key] !== undefined).map((c) => (
                  <div key={c.key} className="flex justify-between"><span className="text-muted-foreground">{c.label}</span><span className="tabular-nums">{r.ratings[c.key]}</span></div>
                ))}
              </div>
            )}
            {r.strengths && <div><span className="text-muted-foreground">Strengths:</span> {r.strengths}</div>}
            {r.improvements && <div><span className="text-muted-foreground">To improve:</span> {r.improvements}</div>}
            {r.notes && <div><span className="text-muted-foreground">Notes:</span> {r.notes}</div>}
            {r.shared && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-xs text-muted-foreground">
                <span>
                  {r.acknowledged_at ? `Acknowledged ${r.acknowledged_at.slice(0, 10)}` : "Not yet acknowledged"}
                  {r.staff_response && <> · Reply: <span className="text-foreground">{r.staff_response}</span></>}
                </span>
                {isSelf && (
                  <Button size="sm" variant="outline" onClick={() => acknowledge(r)}>{r.acknowledged_at ? "Edit reply" : "Acknowledge"}</Button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {isAdmin && !isSelf && (adding
        ? <EvaluationForm userId={userId} subjects={subjects} onDone={() => { setAdding(false); refresh(); }} />
        : <Button variant="outline" size="sm" onClick={() => setAdding(true)}>Add record</Button>)}
      {isAdmin && isSelf && <p className="text-xs text-muted-foreground">Another administrator records your own performance.</p>}
    </div>
  );
}

// The person's subjects this year, labelled "Mathematics · Grade 7A", for linking an observation to a lesson.
function useTeacherSubjects(userId: string) {
  const { data: year } = useCurrentYear();
  const { data: classes = [] } = useClasses(year?.id);
  return useQuery({
    queryKey: ["teacher-subjects-labelled", userId, classes.map((c) => c.id).join()],
    enabled: classes.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("class_subjects").select("*").eq("teacher_id", userId).in("class_id", classes.map((c) => c.id));
      if (error) throw error;
      return (data as ClassSubject[]).map((s) => {
        const c = classes.find((x) => x.id === s.class_id);
        return { id: s.id, label: `${s.subject_name}${c ? ` · ${className(c)}` : ""}` };
      });
    },
  });
}

function EvaluationForm({ userId, subjects, onDone }: { userId: string; subjects: { id: string; label: string }[]; onDone: () => void }) {
  const { school } = useSchool();
  const [f, setF] = useState({
    kind: "observation" as EvaluationKind, date: new Date().toISOString().slice(0, 10), subject: NONE,
    strengths: "", improvements: "", notes: "", shared: true,
  });
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const rates = f.kind === "observation" || f.kind === "evaluation";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.from("staff_evaluations").insert({
      school_id: school!.id, user_id: userId, kind: f.kind, date: f.date,
      class_subject_id: f.subject === NONE ? null : f.subject,
      ratings: rates ? ratings : {},
      strengths: f.strengths.trim() || null, improvements: f.improvements.trim() || null, notes: f.notes.trim() || null,
      shared: f.shared,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Record saved");
    onDone();
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border p-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label>Type</Label>
          <Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v as EvaluationKind })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(evaluationKindLabel) as EvaluationKind[]).map((k) => <SelectItem key={k} value={k}>{evaluationKindLabel[k]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1"><Label>Date</Label><Input type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
        <div className="space-y-1">
          <Label>Lesson observed</Label>
          <Select value={f.subject} onValueChange={(v) => setF({ ...f, subject: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None</SelectItem>
              {subjects.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      {rates && (
        <div className="space-y-1.5">
          <Label>Ratings (1 = needs much improvement, 5 = excellent; leave out what you didn't see)</Label>
          {EVALUATION_CRITERIA.map((c) => (
            <div key={c.key} className="flex flex-wrap items-center justify-between gap-2">
              <span>{c.label}</span>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-label={`${c.label} ${n}`}
                    onClick={() => setRatings((r) => {
                      const next = { ...r };
                      if (next[c.key] === n) delete next[c.key]; else next[c.key] = n;
                      return next;
                    })}
                    className={cn("h-8 w-8 rounded-md border text-xs font-semibold",
                      ratings[c.key] === n ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-1"><Label>Strengths</Label><Input value={f.strengths} onChange={(e) => setF({ ...f, strengths: e.target.value })} /></div>
      <div className="space-y-1"><Label>To improve</Label><Input value={f.improvements} onChange={(e) => setF({ ...f, improvements: e.target.value })} /></div>
      <div className="space-y-1"><Label>Notes</Label><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
      <label className="flex items-center gap-2">
        <Checkbox checked={f.shared} onCheckedChange={(v) => setF({ ...f, shared: v === true })} />
        Share with the staff member (they can read it and reply)
      </label>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>Save</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}
