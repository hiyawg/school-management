import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type PanelAction = { label: string; icon: LucideIcon; onClick: () => void; tone?: "add" | "remove" };

// A titled panel with a small icon toolbar, as in desktop records software.
export default function Panel({ title, actions = [], children, className, contentClassName, id }: {
  title: string; actions?: PanelAction[]; children: ReactNode; className?: string; contentClassName?: string; id?: string;
}) {
  return (
    <Card id={id} className={cn("scroll-mt-4", className)}>
      <CardHeader className="flex-row items-center justify-between space-y-0 py-1.5">
        <CardTitle className="text-base font-medium">{title}</CardTitle>
        {actions.length > 0 && (
          <div className="flex gap-0.5">
            {actions.map((a) => (
              <button key={a.label} onClick={a.onClick} title={a.label} aria-label={a.label}
                className="rounded p-1 hover:bg-white/15">
                <a.icon className={cn("h-4 w-4", a.tone === "add" && "text-emerald-200", a.tone === "remove" && "text-red-200")} />
              </button>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className={cn("p-3", contentClassName)}>{children}</CardContent>
    </Card>
  );
}
