import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Trash2, Upload, UserRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { documentKindLabel, type DocumentKind, type Student, type StudentDocument } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Private bucket: files are opened through short-lived signed links, checked by the Storage policies.
const BUCKET = "student-files";
const MAX_PHOTO = 2 * 1024 * 1024;
const MAX_DOCUMENT = 10 * 1024 * 1024;

const folder = (s: Pick<Student, "school_id" | "id">) => `${s.school_id}/${s.id}`;

function useSignedUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: ["signed-url", path],
    enabled: !!path,
    staleTime: 50 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path!, 3600);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}

export function StudentPhoto({ student, size = 96, readOnly = false }: { student: Student; size?: number; readOnly?: boolean }) {
  const canManageStudents = useSchool().canManageStudents && !readOnly;
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { data: url } = useSignedUrl(student.photo_path);

  const upload = async (file: File) => {
    if (!file.type.startsWith("image/")) return toast.error("Choose an image file");
    if (file.size > MAX_PHOTO) return toast.error("The photo must be under 2 MB");
    setBusy(true);
    // A new name each time, so browsers never show the old photo from cache.
    const path = `${folder(student)}/photo-${Date.now()}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type });
    if (error) {
      setBusy(false);
      return toast.error(error.message);
    }
    const { error: saveError } = await supabase.from("students").update({ photo_path: path }).eq("id", student.id);
    if (saveError) {
      await supabase.storage.from(BUCKET).remove([path]);
      setBusy(false);
      return toast.error(saveError.message);
    }
    if (student.photo_path) await supabase.storage.from(BUCKET).remove([student.photo_path]);
    setBusy(false);
    toast.success("Photo saved");
    qc.invalidateQueries({ queryKey: ["students"] });
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="overflow-hidden rounded-md border bg-muted" style={{ width: size, height: size }}>
        {url ? (
          <img src={url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground"><UserRound className="h-1/2 w-1/2" /></div>
        )}
      </div>
      {canManageStudents && (
        <>
          <input ref={input} type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} />
          <Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
            {student.photo_path ? "Change photo" : "Add photo"}
          </Button>
        </>
      )}
    </div>
  );
}

export function StudentDocuments({ student, readOnly = false }: { student: Student; readOnly?: boolean }) {
  const canManageStudents = useSchool().canManageStudents && !readOnly;
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<DocumentKind>("birth_certificate");
  const [busy, setBusy] = useState(false);

  const { data: docs = [] } = useQuery({
    queryKey: ["student-documents", student.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("student_documents").select("*").eq("student_id", student.id).order("created_at", { ascending: false });
      if (error) throw error;
      return data as StudentDocument[];
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["student-documents", student.id] });

  const upload = async (file: File) => {
    if (file.size > MAX_DOCUMENT) return toast.error("Files must be under 10 MB");
    setBusy(true);
    const safe = file.name.replace(/[^\w.-]+/g, "_").slice(-80);
    const path = `${folder(student)}/docs/${crypto.randomUUID()}-${safe}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined });
    if (error) {
      setBusy(false);
      return toast.error(error.message);
    }
    const { error: rowError } = await supabase.from("student_documents").insert({
      school_id: student.school_id, student_id: student.id, kind, name: file.name, path, size_bytes: file.size,
    });
    setBusy(false);
    if (rowError) {
      await supabase.storage.from(BUCKET).remove([path]);
      return toast.error(rowError.message);
    }
    toast.success(`${documentKindLabel[kind]} uploaded`);
    refresh();
  };

  const open = async (d: StudentDocument) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(d.path, 300, { download: d.name });
    if (error) return toast.error(error.message);
    window.open(data.signedUrl, "_blank", "noopener");
  };

  const remove = async (d: StudentDocument) => {
    if (!confirm(`Delete ${d.name}?`)) return;
    const { error } = await supabase.from("student_documents").delete().eq("id", d.id);
    if (error) return toast.error(error.message);
    await supabase.storage.from(BUCKET).remove([d.path]);
    refresh();
  };

  return (
    <div className="space-y-3 text-sm">
      {docs.length === 0 && <p className="text-muted-foreground">No documents yet.</p>}
      {docs.length > 0 && (
        <div className="divide-y rounded-md border">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <div className="truncate">{d.name}</div>
                <div className="text-xs text-muted-foreground">
                  {documentKindLabel[d.kind]} · {d.created_at.slice(0, 10)}{d.size_bytes ? ` · ${Math.ceil(d.size_bytes / 1024)} KB` : ""}
                </div>
              </div>
              <div className="flex shrink-0">
                <Button variant="ghost" size="icon" aria-label={`Download ${d.name}`} onClick={() => open(d)}><Download className="h-4 w-4" /></Button>
                {canManageStudents && (
                  <Button variant="ghost" size="icon" aria-label={`Delete ${d.name}`} onClick={() => remove(d)}><Trash2 className="h-4 w-4" /></Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {canManageStudents && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label>Document type</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as DocumentKind)}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(documentKindLabel) as DocumentKind[]).map((k) => <SelectItem key={k} value={k}>{documentKindLabel[k]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <input ref={input} type="file" accept="image/*,application/pdf" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} />
          <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>
            <Upload className="mr-2 h-4 w-4" /> {busy ? "Uploading…" : "Upload file"}
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">PDF or image, up to 10 MB. Staff and this student's guardians can open these files.</p>
    </div>
  );
}
