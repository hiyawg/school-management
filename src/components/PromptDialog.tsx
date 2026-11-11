import { useCallback, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Ask = { title: string; label?: string; defaultValue?: string; confirmLabel?: string };

// In-app replacement for window.prompt: `const [dialog, ask] = usePrompt()`, render {dialog},
// then `const text = await ask({ title })` gives the text, or null when cancelled.
export function usePrompt() {
  const [open, setOpen] = useState<Ask | null>(null);
  const [value, setValue] = useState("");
  const resolver = useRef<(v: string | null) => void>();

  const ask = useCallback((a: Ask) => new Promise<string | null>((resolve) => {
    resolver.current = resolve;
    setValue(a.defaultValue ?? "");
    setOpen(a);
  }), []);

  const finish = (v: string | null) => {
    resolver.current?.(v);
    resolver.current = undefined;
    setOpen(null);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    finish(value);
  };

  const dialog = (
    <Dialog open={!!open} onOpenChange={(v) => !v && finish(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{open?.title}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Input autoFocus aria-label={open?.label ?? open?.title} placeholder={open?.label} value={value} onChange={(e) => setValue(e.target.value)} />
          <div className="flex gap-2">
            <Button type="submit">{open?.confirmLabel ?? "OK"}</Button>
            <Button type="button" variant="ghost" onClick={() => finish(null)}>Cancel</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
  return [dialog, ask] as const;
}
