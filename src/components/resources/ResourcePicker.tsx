import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import type { Resource } from "@/lib/types";
import { KIND_ICON } from "./resourceUtils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Choose resources from your library and the staff-shared one (to attach to homework).
export default function ResourcePicker({ open, onOpenChange, selected, onChange }: {
  open: boolean; onOpenChange: (v: boolean) => void; selected: string[]; onChange: (ids: string[]) => void;
}) {
  const { school, session } = useSchool();
  const [q, setQ] = useState("");
  const { data: resources = [] } = useQuery({
    queryKey: ["resources", school?.id, "picker"],
    enabled: open && !!school,
    queryFn: async () => {
      const { data, error } = await supabase.from("resources").select("*").eq("school_id", school!.id).order("title");
      if (error) throw error;
      // Everything readable minus items only visible because they're attached to someone's homework.
      const { data: shared } = await supabase.from("resource_folders").select("id").eq("shared", true);
      const sharedFolders = new Set((shared ?? []).map((f) => f.id as string));
      return (data as Resource[]).filter((r) => r.owner_id === session?.user.id || r.shared || (r.folder_id && sharedFolders.has(r.folder_id)));
    },
  });
  const query = q.trim().toLowerCase();
  const shown = resources.filter((r) => !query || `${r.title} ${r.description ?? ""}`.toLowerCase().includes(query));
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Attach resources</DialogTitle></DialogHeader>
        <Input placeholder="Search your library" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-80 divide-y overflow-y-auto rounded-sm border text-sm">
          {shown.length === 0 && <p className="p-3 text-muted-foreground">Nothing here yet. Add files, links and pages under Resources.</p>}
          {shown.map((r) => {
            const k = KIND_ICON[r.kind];
            return (
              <label key={r.id} className={cn("flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-accent", selected.includes(r.id) && "bg-accent")}>
                <Checkbox checked={selected.includes(r.id)} onCheckedChange={() => toggle(r.id)} />
                <k.icon className={cn("h-4 w-4 shrink-0", k.color)} />
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
                {r.owner_id !== session?.user.id && <span className="text-xs text-muted-foreground">shared</span>}
              </label>
            );
          })}
        </div>
        <Button onClick={() => onOpenChange(false)}>Done{selected.length ? ` (${selected.length} selected)` : ""}</Button>
      </DialogContent>
    </Dialog>
  );
}
