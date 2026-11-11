import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  Archive, ChevronDown, ChevronRight, ExternalLink, FileText, Folder, FolderOpen, FolderPlus, Link2, MoreHorizontal, Pencil,
  Share2, StickyNote, Trash2, Upload, Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { useSubjects } from "@/hooks/useSchoolData";
import { resourceKindLabel, type Resource, type ResourceFolder, type ResourceKind } from "@/lib/types";
import AddMenu from "@/components/AddMenu";
import { KIND_ICON, openResource, RESOURCE_BUCKET as BUCKET } from "@/components/resources/resourceUtils";
import { usePrompt } from "@/components/PromptDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const MAX_FILE = 25 * 1024 * 1024;
const HOME = "home";
const SHARED_ITEMS = "shared-items";
const NONE = "none";
// A staff library of files, links and pages in folders. Private unless shared; attachable to homework.
export default function Resources() {
  const { school, session } = useSchool();
  const qc = useQueryClient();
  const me = session?.user.id;
  const [params, setParams] = useSearchParams();
  const [current, setCurrent] = useState<string>(HOME);
  const [adding, setAdding] = useState<ResourceKind | null>(null);
  const [editing, setEditing] = useState<Resource | null>(null);
  const [viewing, setViewing] = useState<Resource | null>(null);
  const [newFolder, setNewFolder] = useState(false);
  const [promptDialog, ask] = usePrompt();

  // The New menu links here with ?add=file|link|page.
  useEffect(() => {
    const k = params.get("add");
    if (k === "file" || k === "link" || k === "page") { setAdding(k); setParams({}, { replace: true }); }
  }, [params, setParams]);

  const { data: folders = [] } = useQuery({
    queryKey: ["resource-folders", school?.id],
    enabled: !!school,
    queryFn: async () => {
      const { data, error } = await supabase.from("resource_folders").select("*").eq("school_id", school!.id).order("name");
      if (error) throw error;
      return data as ResourceFolder[];
    },
  });
  const mine = folders.filter((f) => f.owner_id === me);
  const sharedFolders = folders.filter((f) => f.owner_id !== me);
  const folder = folders.find((f) => f.id === current) ?? null;
  const isMine = current === HOME || folder?.owner_id === me;

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["resources", school?.id, current],
    enabled: !!school && !!me,
    queryFn: async () => {
      let q = supabase.from("resources").select("*").eq("school_id", school!.id);
      if (current === HOME) q = q.eq("owner_id", me!).is("folder_id", null);
      else if (current === SHARED_ITEMS) q = q.eq("shared", true).neq("owner_id", me!);
      else q = q.eq("folder_id", current);
      const { data, error } = await q.order("title");
      if (error) throw error;
      return data as Resource[];
    },
  });
  const subfolders = current === HOME ? mine.filter((f) => !f.parent_id) : current === SHARED_ITEMS ? [] : folders.filter((f) => f.parent_id === current);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["resources"] }); qc.invalidateQueries({ queryKey: ["resource-folders"] }); };
  const title = current === HOME ? "Home" : current === SHARED_ITEMS ? "Shared items" : folder?.name ?? "";

  const act = async (op: PromiseLike<{ error: { message: string } | null }>, ok?: string) => {
    const { error } = await op;
    if (error) return toast.error(error.message);
    if (ok) toast.success(ok);
    refresh();
  };

  const renameFolder = async () => {
    if (!folder) return;
    const name = await ask({ title: "Rename folder", label: "Folder name", defaultValue: folder.name, confirmLabel: "Rename" });
    if (name?.trim()) act(supabase.from("resource_folders").update({ name: name.trim() }).eq("id", folder.id));
  };

  // Deleting a folder removes everything in it, including subfolders, so their files go from storage too.
  const deleteFolder = async () => {
    if (!folder) return;
    const ids = [folder.id];
    for (let i = 0; i < ids.length; i++) ids.push(...mine.filter((f) => f.parent_id === ids[i]).map((f) => f.id));
    const { data: inside } = await supabase.from("resources").select("storage_path").in("folder_id", ids);
    const files = (inside ?? []).map((r) => r.storage_path as string | null).filter((p): p is string => !!p);
    if (!confirm(`Delete "${folder.name}" and everything in it (${ids.length - 1} subfolders, ${inside?.length ?? 0} items)?`)) return;
    if (files.length) await supabase.storage.from(BUCKET).remove(files);
    await act(supabase.from("resource_folders").delete().eq("id", folder.id), "Folder deleted");
    setCurrent(folder.parent_id ?? HOME);
  };

  const removeItem = async (r: Resource) => {
    if (!confirm(`Delete "${r.title}"? Homework it is attached to will no longer show it.`)) return;
    if (r.storage_path) await supabase.storage.from(BUCKET).remove([r.storage_path]);
    act(supabase.from("resources").delete().eq("id", r.id), "Deleted");
  };

  return (
    <div className="space-y-4">
      {promptDialog}
      <h1 className="text-2xl font-semibold">Resources</h1>
      <div className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
        <Card className="self-start">
          <CardHeader className="flex-row items-center justify-between space-y-0 py-1.5">
            <CardTitle className="flex items-center gap-2 text-base font-medium"><Archive className="h-4 w-4" /> My Resources</CardTitle>
            <button className="rounded p-1 hover:bg-white/15" title="New folder" aria-label="New folder" onClick={() => setNewFolder(true)}>
              <FolderPlus className="h-4 w-4" />
            </button>
          </CardHeader>
          <CardContent className="p-1 text-sm">
            <TreeRow label="Home" icon={Archive} active={current === HOME} depth={0} onClick={() => setCurrent(HOME)} />
            <FolderTree folders={mine} parent={null} depth={1} current={current} onPick={setCurrent} />
            {(sharedFolders.length > 0) && <div className="px-2 pb-1 pt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Shared with me</div>}
            {sharedFolders.filter((f) => !f.parent_id || !sharedFolders.some((p) => p.id === f.parent_id)).map((f) => (
              <TreeRow key={f.id} label={f.name} icon={Users} active={current === f.id} depth={0} onClick={() => setCurrent(f.id)} />
            ))}
            <TreeRow label="Shared items" icon={Share2} active={current === SHARED_ITEMS} depth={0} onClick={() => setCurrent(SHARED_ITEMS)} />
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-3 border-b pb-3">
            <FolderOpen className="h-7 w-7 text-amber-600" />
            <h2 className="text-2xl font-semibold">{title}</h2>
            {folder?.shared && <Badge variant="secondary">Shared with staff</Badge>}
            {!isMine && folder && <span className="text-sm text-muted-foreground">Shared by a colleague (read only)</span>}
            <div className="ml-auto flex items-center gap-2">
              {folder && isMine && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="outline" size="sm"><MoreHorizontal className="mr-1 h-4 w-4" /> Folder</Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={renameFolder}><Pencil className="mr-2 h-4 w-4" /> Rename</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => act(supabase.from("resource_folders").update({ shared: !folder.shared }).eq("id", folder.id),
                      folder.shared ? "No longer shared" : "Shared with all staff")}>
                      <Share2 className="mr-2 h-4 w-4" /> {folder.shared ? "Stop sharing" : "Share with all staff"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive" onSelect={deleteFolder}><Trash2 className="mr-2 h-4 w-4" /> Delete folder</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {isMine && (
                <AddMenu label="Add Resources" icon={Archive} align="end" groups={[
                  { items: [{ label: "Add Folder", icon: Folder, color: "text-sky-500", onSelect: () => setNewFolder(true) }] },
                  { items: [
                    { label: "Add File", icon: FileText, color: KIND_ICON.file.color, onSelect: () => setAdding("file") },
                    { label: "Add Link", icon: Link2, color: KIND_ICON.link.color, onSelect: () => setAdding("link") },
                    { label: "Add Page", icon: StickyNote, color: KIND_ICON.page.color, onSelect: () => setAdding("page") },
                  ] },
                ]} />
              )}
            </div>
          </div>

          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr>
                    <th className="px-3 py-2 text-left">Name</th>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-left">Updated</th>
                    <th className="w-24 px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {subfolders.map((f) => (
                    <tr key={f.id} className="cursor-pointer border-t" onClick={() => setCurrent(f.id)}>
                      <td className="px-3 py-2"><span className="flex items-center gap-2 font-medium"><Folder className="h-4 w-4 text-sky-500" />{f.name}{f.shared && <Badge variant="secondary">Shared</Badge>}</span></td>
                      <td className="px-3 py-2 text-muted-foreground">Folder</td>
                      <td className="px-3 py-2" /><td />
                    </tr>
                  ))}
                  {items.map((r) => {
                    const k = KIND_ICON[r.kind];
                    const own = r.owner_id === me;
                    return (
                      <tr key={r.id} className="cursor-pointer border-t" onClick={() => openResource(r, setViewing)}>
                        <td className="px-3 py-2">
                          <span className="flex items-center gap-2 font-medium"><k.icon className={cn("h-4 w-4 shrink-0", k.color)} />{r.title}{r.shared && own && <Badge variant="secondary">Shared</Badge>}</span>
                          {r.description && <div className="pl-6 text-xs text-muted-foreground">{r.description}</div>}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{resourceKindLabel[r.kind]}{r.size_bytes ? ` · ${Math.ceil(r.size_bytes / 1024)} KB` : ""}</td>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">{format(new Date(r.updated_at), "dd MMM yyyy")}</td>
                        <td className="px-3 py-1 text-right" onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" aria-label={`Open ${r.title}`} onClick={() => openResource(r, setViewing)}><ExternalLink className="h-4 w-4" /></Button>
                          {own && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`More for ${r.title}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => setEditing(r)}><Pencil className="mr-2 h-4 w-4" /> Edit details</DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => act(supabase.from("resources").update({ shared: !r.shared }).eq("id", r.id), r.shared ? "No longer shared" : "Shared with all staff")}>
                                  <Share2 className="mr-2 h-4 w-4" /> {r.shared ? "Stop sharing" : "Share with all staff"}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-destructive" onSelect={() => removeItem(r)}><Trash2 className="mr-2 h-4 w-4" /> Delete</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {!isLoading && subfolders.length === 0 && items.length === 0 && (
                    <tr><td colSpan={4} className="px-3 py-10 text-center text-muted-foreground">There are currently no items in this folder.</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={newFolder} onOpenChange={setNewFolder}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>New folder{isMine && current !== HOME && folder ? ` in ${folder.name}` : ""}</DialogTitle></DialogHeader>
          <form className="space-y-3" onSubmit={(e) => {
            e.preventDefault();
            const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
            if (!name) return;
            act(supabase.from("resource_folders").insert({ school_id: school!.id, name, parent_id: isMine && folder ? folder.id : null }), "Folder created");
            setNewFolder(false);
          }}>
            <Input name="name" autoFocus required placeholder="Grade 7 maths" />
            <Button type="submit">Create</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!adding || !!editing} onOpenChange={(v) => { if (!v) { setAdding(null); setEditing(null); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>{editing ? `Edit ${editing.title}` : `Add ${adding ? resourceKindLabel[adding].toLowerCase() : ""}`}</DialogTitle></DialogHeader>
          {(adding || editing) && (
            <ResourceForm kind={editing?.kind ?? adding!} resource={editing ?? undefined}
              folderId={editing ? editing.folder_id : isMine && folder ? folder.id : null}
              onDone={() => { setAdding(null); setEditing(null); refresh(); }} />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewing} onOpenChange={(v) => !v && setViewing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{viewing?.title}</DialogTitle></DialogHeader>
          {viewing?.description && <p className="text-sm text-muted-foreground">{viewing.description}</p>}
          <div className="whitespace-pre-line text-sm">{viewing?.body}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TreeRow({ label, icon: Icon, active, depth, onClick, toggle }: {
  label: string; icon: typeof Folder; active: boolean; depth: number; onClick: () => void; toggle?: { open: boolean; onToggle: () => void };
}) {
  return (
    <div className={cn("flex items-center gap-1 rounded-sm py-1.5 pr-2 hover:bg-accent", active && "bg-accent font-semibold text-primary")} style={{ paddingLeft: `${0.5 + depth * 0.9}rem` }}>
      {toggle ? (
        <button className="rounded p-0.5 hover:bg-background" onClick={toggle.onToggle} aria-label={toggle.open ? "Collapse" : "Expand"}>
          {toggle.open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
      ) : <span className="w-[1.125rem]" />}
      <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={onClick}>
        <Icon className="h-4 w-4 shrink-0 text-amber-600" /><span className="truncate">{label}</span>
      </button>
    </div>
  );
}

function FolderTree({ folders, parent, depth, current, onPick }: {
  folders: ResourceFolder[]; parent: string | null; depth: number; current: string; onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <>
      {folders.filter((f) => f.parent_id === parent).map((f) => {
        const hasChildren = folders.some((c) => c.parent_id === f.id);
        const isOpen = open[f.id] ?? true;
        return (
          <div key={f.id}>
            <TreeRow label={f.name} icon={f.shared ? Users : Folder} active={current === f.id} depth={depth} onClick={() => onPick(f.id)}
              toggle={hasChildren ? { open: isOpen, onToggle: () => setOpen({ ...open, [f.id]: !isOpen }) } : undefined} />
            {hasChildren && isOpen && <FolderTree folders={folders} parent={f.id} depth={depth + 1} current={current} onPick={onPick} />}
          </div>
        );
      })}
    </>
  );
}

function ResourceForm({ kind, resource, folderId, onDone }: { kind: ResourceKind; resource?: Resource; folderId: string | null; onDone: () => void }) {
  const { school } = useSchool();
  const { data: subjects = [] } = useSubjects();
  const [f, setF] = useState({
    title: resource?.title ?? "", description: resource?.description ?? "", url: resource?.url ?? "", body: resource?.body ?? "",
    subject: resource?.subject_id ?? NONE, grade: resource?.grade_level?.toString() ?? NONE, shared: resource?.shared ?? false,
  });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const grades = useMemo(() => Array.from({ length: 13 }, (_, g) => g), []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (kind === "link" && !/^https?:\/\//i.test(f.url.trim())) return toast.error("Links must start with http:// or https://");
    if (kind === "file" && !resource && !file) return toast.error("Choose a file");
    if (file && file.size > MAX_FILE) return toast.error("Files must be under 25 MB");
    setBusy(true);
    const fields = {
      title: f.title.trim() || file?.name || "Untitled", description: f.description.trim() || null,
      url: kind === "link" ? f.url.trim() : null, body: kind === "page" ? f.body : null,
      subject_id: f.subject === NONE ? null : f.subject, grade_level: f.grade === NONE ? null : Number(f.grade), shared: f.shared,
    };
    try {
      if (resource) {
        const { error } = await supabase.from("resources").update(fields).eq("id", resource.id);
        if (error) throw error;
      } else if (kind === "file" && file) {
        // The row comes first: the storage rules only accept an upload to a path a resource of yours points at.
        const id = crypto.randomUUID();
        const path = `${school!.id}/${id}/${file.name.replace(/[^\w.-]+/g, "_").slice(-80)}`;
        const { error } = await supabase.from("resources").insert({
          ...fields, id, school_id: school!.id, folder_id: folderId, kind, storage_path: path, file_name: file.name, size_bytes: file.size,
        });
        if (error) throw error;
        const { error: upError } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined });
        if (upError) {
          await supabase.from("resources").delete().eq("id", id);
          throw upError;
        }
      } else {
        const { error } = await supabase.from("resources").insert({ ...fields, school_id: school!.id, folder_id: folderId, kind });
        if (error) throw error;
      }
      toast.success(resource ? "Saved" : "Added");
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-3 text-sm">
      {kind === "file" && !resource && (
        <div className="space-y-1">
          <Label>File</Label>
          <label className="flex cursor-pointer items-center gap-2 rounded-sm border border-dashed px-3 py-4 hover:bg-accent">
            <Upload className="h-4 w-4 text-primary" />
            <span>{file ? `${file.name} (${Math.ceil(file.size / 1024)} KB)` : "Choose a file (PDF, Word, slides, images… up to 25 MB)"}</span>
            <input type="file" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
        </div>
      )}
      <div className="space-y-1"><Label>Title</Label><Input required={kind !== "file"} placeholder={kind === "file" ? "Uses the file name if empty" : ""} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
      {kind === "link" && <div className="space-y-1"><Label>Web address</Label><Input required type="url" placeholder="https://" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></div>}
      {kind === "page" && (
        <div className="space-y-1">
          <Label>Content</Label>
          <textarea required className="min-h-40 w-full rounded-sm border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
        </div>
      )}
      <div className="space-y-1"><Label>Description</Label><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Subject</Label>
          <Select value={f.subject} onValueChange={(v) => setF({ ...f, subject: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={NONE}>Any</SelectItem>{subjects.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Grade</Label>
          <Select value={f.grade} onValueChange={(v) => setF({ ...f, grade: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={NONE}>Any</SelectItem>{grades.map((g) => <SelectItem key={g} value={String(g)}>{g === 0 ? "KG" : `Grade ${g}`}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <label className="flex items-center gap-2"><Checkbox checked={f.shared} onCheckedChange={(v) => setF({ ...f, shared: v === true })} /> Share with all staff</label>
      <Button type="submit" disabled={busy}>{busy ? "Saving…" : resource ? "Save" : "Add"}</Button>
    </form>
  );
}
