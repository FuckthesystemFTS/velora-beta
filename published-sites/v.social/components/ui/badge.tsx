import { cn } from "@/lib/utils";

export function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-[rgba(255,255,255,0.07)] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] px-3 py-1 text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--muted)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]",
        className,
      )}
    >
      {children}
    </span>
  );
}
