import { cn } from "../../lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("ui-skeleton", className)} />;
}
