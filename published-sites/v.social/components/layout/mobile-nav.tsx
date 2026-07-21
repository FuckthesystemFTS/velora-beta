import Link from "next/link";
import { Bell, Bookmark, Home, Radio, Search, UserRound } from "lucide-react";

import { getCurrentUser } from "@/lib/auth";

const links = [
  { href: "/feed", label: "Home", icon: Home },
  { href: "/explore", label: "Esplora", icon: Search },
  { href: "/live", label: "Live", icon: Radio },
  { href: "/notifications", label: "Notifiche", icon: Bell },
  { href: "/saved", label: "Salvati", icon: Bookmark },
] as const;

export async function MobileNav() {
  const user = await getCurrentUser();

  if (!user) {
    return null;
  }

  return (
    <nav className="fixed inset-x-2 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 mx-auto max-w-[420px] rounded-[24px] border border-[var(--border)] bg-[rgba(10,10,12,0.94)] p-2 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur lg:hidden">
      <div className="grid grid-cols-6 gap-1">
        {links.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className="min-w-0 flex flex-col items-center gap-1 rounded-[18px] px-1 py-2 text-[10px] uppercase tracking-[0.1em] text-[var(--muted)]">
            <Icon size={18} />
            <span className="truncate">{label}</span>
          </Link>
        ))}
        <Link href={`/profile/${user.username}`} className="min-w-0 flex flex-col items-center gap-1 rounded-[18px] px-1 py-2 text-[10px] uppercase tracking-[0.1em] text-[var(--muted)]">
          <UserRound size={18} />
          <span className="truncate">Profilo</span>
        </Link>
      </div>
    </nav>
  );
}
