/* eslint-disable @next/next/no-img-element */
import { initials } from "@/lib/utils";

export function Avatar({
  name,
  src,
  size = 48,
}: {
  name: string;
  src?: string | null;
  size?: number;
}) {
  if (src) {
    return (
      <div
        className="rounded-full p-[2px]"
        style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.24), rgba(213,49,39,0.3))" }}
      >
        <img src={src} alt={name} width={size} height={size} className="rounded-full object-cover" />
      </div>
    );
  }

  return (
    <div
      className="flex items-center justify-center rounded-full border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(213,49,39,0.1))] font-semibold text-[var(--foreground)] shadow-[0_10px_24px_rgba(0,0,0,0.35)]"
      style={{ width: size, height: size }}
      aria-label={name}
    >
      {initials(name)}
    </div>
  );
}
