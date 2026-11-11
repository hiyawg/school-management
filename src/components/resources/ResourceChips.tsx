import { useState } from "react";
import type { Resource } from "@/lib/types";
import { KIND_ICON, openResource } from "./resourceUtils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// Resources attached to something (homework), as small buttons: files download, links open, pages show here.
export default function ResourceChips({ resources }: { resources: Resource[] }) {
  const [page, setPage] = useState<Resource | null>(null);
  if (!resources.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {resources.map((r) => {
        const k = KIND_ICON[r.kind];
        return (
          <button key={r.id} onClick={() => openResource(r, setPage)}
            className="inline-flex items-center gap-1 rounded-sm border bg-background px-1.5 py-0.5 text-xs hover:bg-accent">
            <k.icon className={cn("h-3 w-3", k.color)} />{r.title}
          </button>
        );
      })}
      <Dialog open={!!page} onOpenChange={(v) => !v && setPage(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{page?.title}</DialogTitle></DialogHeader>
          {page?.description && <p className="text-sm text-muted-foreground">{page.description}</p>}
          <div className="whitespace-pre-line text-sm">{page?.body}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
