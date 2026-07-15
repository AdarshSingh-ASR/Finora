import { cn } from "../../lib/utils";

export function BorderBeam({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("border-beam", className)} />;
}
