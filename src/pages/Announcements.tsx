import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { Pin, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { useClasses, useCurrentYear, useMembers, useMyAssignments } from "@/hooks/useSchoolData";
import { audienceLabel, className, type Announcement, type Audience } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const WHOLE_SCHOOL = "school";

export default function Announcements() {
  const { school, session, isAdmin, isTeacher } = useSchool();
  const qc = useQueryClient();
  const { data: year } = useCurrentYear();
  const { data: classes = [] } = useClasses(year?.id);
  const { data: members = [] } = useMembers();
  const mine = useMyAssignments(year?.id);
  const canPost = isAdmin || (isTeacher && mine.teaching.length > 0);

  const { data: posts = [] } = useQuery({
    queryKey: ["announcements", school?.id],
    enabled: !!school,
    queryFn: async () => {
      const { data, error } = await supabase.from("announcements").select("*").eq("school_id", school!.id)
        .order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data as Announcement[];
    },
  });
  const authorName = (id: string | null) => {
    const m = members.find((x) => x.user_id === id && x.role !== "parent");
    return m?.full_name ?? m?.email ?? null;
  };
  const refresh = () => qc.invalidateQueries({ queryKey: ["announcements"] });

  const act = async (op: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await op;
    if (error) return toast.error(error.message);
    refresh();
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Announcements</h1>
      {canPost && <Compose classes={isAdmin ? classes : mine.teaching} wholeSchool={isAdmin} onPosted={refresh} />}
      {posts.length === 0 && <p className="text-sm text-muted-foreground">No announcements yet.</p>}
      <div className="space-y-3">
        {posts.map((p) => {
          const cls = classes.find((c) => c.id === p.class_id);
          const own = p.author_id === session?.user.id;
          return (
            <Card key={p.id} className={p.pinned ? "border-primary/50" : ""}>
              <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-2">
                <div>
                  <CardTitle className="text-base">{p.pinned && <Pin className="mr-1 inline h-4 w-4 text-primary" />}{p.title}</CardTitle>
                  <div className="text-xs text-muted-foreground">
                    {format(new Date(p.created_at), "d MMM yyyy, HH:mm")}
                    {authorName(p.author_id) && ` · ${authorName(p.author_id)}`}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Badge variant="outline">{cls ? `${className(cls)} families` : audienceLabel[p.audience]}</Badge>
                  {isAdmin && (
                    <Button variant="ghost" size="icon" aria-label={p.pinned ? "Unpin" : "Pin"} onClick={() => act(supabase.from("announcements").update({ pinned: !p.pinned }).eq("id", p.id))}>
                      <Pin className="h-4 w-4" />
                    </Button>
                  )}
                  {(isAdmin || own) && (
                    <Button variant="ghost" size="icon" aria-label="Delete announcement"
                      onClick={() => confirm(`Delete "${p.title}"?`) && act(supabase.from("announcements").delete().eq("id", p.id))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="whitespace-pre-line text-sm">{p.body}</CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Compose({ classes, wholeSchool, onPosted }: { classes: { id: string; grade_level: number; section: string }[]; wholeSchool: boolean; onPosted: () => void }) {
  const { school, session } = useSchool();
  const [f, setF] = useState({ title: "", body: "", audience: "everyone" as Audience, target: wholeSchool ? WHOLE_SCHOOL : "", pinned: false });
  const [busy, setBusy] = useState(false);
  const toClass = f.target !== WHOLE_SCHOOL;

  const post = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.target) return toast.error("Choose a class");
    setBusy(true);
    const { error } = await supabase.from("announcements").insert({
      school_id: school!.id, author_id: session!.user.id, title: f.title.trim(), body: f.body.trim(),
      audience: toClass ? "families" : f.audience, class_id: toClass ? f.target : null, pinned: wholeSchool && f.pinned,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Posted");
    setF({ ...f, title: "", body: "", pinned: false });
    onPosted();
  };

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">New announcement</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={post} className="space-y-3 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Send to</Label>
              <Select value={f.target} onValueChange={(v) => setF({ ...f, target: v })}>
                <SelectTrigger><SelectValue placeholder="Choose class" /></SelectTrigger>
                <SelectContent>
                  {wholeSchool && <SelectItem value={WHOLE_SCHOOL}>Whole school</SelectItem>}
                  {classes.map((c) => <SelectItem key={c.id} value={c.id}>{className(c)} families</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {!toClass && (
              <div className="space-y-1">
                <Label>Who sees it</Label>
                <Select value={f.audience} onValueChange={(v) => setF({ ...f, audience: v as Audience })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{(Object.keys(audienceLabel) as Audience[]).map((a) => <SelectItem key={a} value={a}>{audienceLabel[a]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="space-y-1"><Label>Title</Label><Input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
          <div className="space-y-1">
            <Label>Message</Label>
            <textarea required className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Button type="submit" disabled={busy}>Post</Button>
            {wholeSchool && (
              <label className="flex items-center gap-2"><Checkbox checked={f.pinned} onCheckedChange={(v) => setF({ ...f, pinned: v === true })} /> Pin to the top</label>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
