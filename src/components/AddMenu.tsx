import { ChevronDown, type LucideIcon } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type MenuItem = { label: string; icon: LucideIcon; color: string; onSelect: () => void; show?: boolean };
export type MenuGroup = { label?: string; items: MenuItem[] };

// A dark button that opens a grouped menu of actions, each with its own coloured icon.
export default function AddMenu({ label, icon: Icon, groups, className, align = "start" }: {
  label: string; icon: LucideIcon; groups: MenuGroup[]; className?: string; align?: "start" | "end";
}) {
  const visible = groups.map((g) => ({ ...g, items: g.items.filter((i) => i.show !== false) })).filter((g) => g.items.length > 0);
  if (!visible.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={cn("inline-flex h-8 items-center gap-2 rounded-sm bg-slate-700 px-3 text-sm font-semibold text-white shadow-sm hover:bg-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-slate-600", className)}>
          <Icon className="h-4 w-4" />
          {label}
          <ChevronDown className="h-4 w-4 opacity-80" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="max-h-[75vh] min-w-56 overflow-y-auto rounded-sm p-0 py-1">
        {visible.map((g, gi) => (
          <div key={g.label ?? gi}>
            {gi > 0 && <DropdownMenuSeparator className="my-1" />}
            {g.label && <DropdownMenuLabel className="px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{g.label}</DropdownMenuLabel>}
            {g.items.map((item) => (
              <DropdownMenuItem key={item.label} onSelect={item.onSelect} className="gap-3 rounded-none px-3 py-2 text-sm">
                <item.icon className={cn("h-4 w-4 shrink-0", item.color)} />
                {item.label}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
