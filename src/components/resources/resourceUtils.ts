import { FileText, Link2, StickyNote } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Resource, ResourceKind } from "@/lib/types";

export const RESOURCE_BUCKET = "resources";

export const KIND_ICON: Record<ResourceKind, { icon: typeof FileText; color: string }> = {
  file: { icon: FileText, color: "text-orange-600" },
  link: { icon: Link2, color: "text-cyan-700" },
  page: { icon: StickyNote, color: "text-blue-800 dark:text-blue-300" },
};

export async function openResource(r: Resource, showPage: (r: Resource) => void) {
  if (r.kind === "link" && r.url) return void window.open(r.url, "_blank", "noopener");
  if (r.kind === "page") return showPage(r);
  if (r.storage_path) {
    const { data, error } = await supabase.storage.from(RESOURCE_BUCKET).createSignedUrl(r.storage_path, 300, { download: r.file_name ?? true });
    if (error) return void toast.error(error.message);
    window.open(data.signedUrl, "_blank", "noopener");
  }
}
