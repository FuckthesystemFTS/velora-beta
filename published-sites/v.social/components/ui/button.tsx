import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
};

export function Button({ className, variant = "primary", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-2xl px-4 py-2.5 text-sm font-semibold tracking-[0.01em] transition focus:outline-none focus:ring-2 focus:ring-[var(--gold)] disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" &&
          "border border-[rgba(255,120,102,0.18)] bg-[linear-gradient(180deg,#e1392f,#9f1714)] text-[var(--accent-foreground)] shadow-[0_12px_32px_rgba(190,30,20,0.35)] hover:brightness-110",
        variant === "secondary" &&
          "border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(42,45,55,0.95),rgba(20,21,28,0.98))] text-[var(--foreground)] hover:border-[rgba(255,120,102,0.24)] hover:bg-[linear-gradient(180deg,rgba(52,55,66,0.96),rgba(24,25,32,0.98))]",
        variant === "ghost" &&
          "border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] text-[var(--muted)] hover:border-[rgba(255,120,102,0.24)] hover:bg-[rgba(213,49,39,0.08)] hover:text-[var(--foreground)]",
        variant === "danger" &&
          "border border-[rgba(255,120,102,0.14)] bg-[linear-gradient(180deg,#f04438,#911313)] text-white shadow-[0_12px_32px_rgba(220,40,30,0.3)] hover:brightness-110",
        className,
      )}
      {...props}
    />
  );
}
