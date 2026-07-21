import Link from "next/link";
import {
  Bell,
  Bookmark,
  Gavel,
  Home,
  Radio,
  Search,
  Settings,
  UserRound,
  UserPlus,
} from "lucide-react";

import { LogoutButton } from "@/components/layout/logout-button";
import { Card } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";

const links = [
  { href: "/feed", label: "Home", icon: Home },
  { href: "/explore", label: "Esplora", icon: Search },
  { href: "/notifications", label: "Notifiche", icon: Bell },
  { href: "/saved", label: "Salvati", icon: Bookmark },
  { href: "/live", label: "Live", icon: Radio },
  { href: "/invite", label: "Invita", icon: UserPlus },
  { href: "/jury", label: "Giuria", icon: Gavel },
  { href: "/settings", label: "Impostazioni", icon: Settings },
] as const;

export async function AppNav() {
  const user = await getCurrentUser();

  return (
    <Card className="space-y-2 p-3">
      {links.slice(0, 4).map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className="group flex items-center gap-3 rounded-[18px] border border-transparent px-3 py-3 text-sm font-medium text-[var(--muted)] transition hover:border-[rgba(255,88,62,0.16)] hover:bg-[rgba(213,49,39,0.1)] hover:text-[var(--foreground)]"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-2xl border border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.02)] text-[var(--accent)] transition group-hover:border-[rgba(255,88,62,0.24)]">
            <Icon size={16} />
          </span>
          {label}
        </Link>
      ))}

      {user ? (
        <Link
          href={`/profile/${user.username}`}
          className="group flex items-center gap-3 rounded-[18px] border border-transparent px-3 py-3 text-sm font-medium text-[var(--muted)] transition hover:border-[rgba(255,88,62,0.16)] hover:bg-[rgba(213,49,39,0.1)] hover:text-[var(--foreground)]"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-2xl border border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.02)] text-[var(--accent)]">
            <UserRound size={16} />
          </span>
          Profilo
        </Link>
      ) : null}

      {links.slice(4).map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className="group flex items-center gap-3 rounded-[18px] border border-transparent px-3 py-3 text-sm font-medium text-[var(--muted)] transition hover:border-[rgba(255,88,62,0.16)] hover:bg-[rgba(213,49,39,0.1)] hover:text-[var(--foreground)]"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-2xl border border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.02)] text-[var(--accent)]">
            <Icon size={16} />
          </span>
          {label}
        </Link>
      ))}

      <LogoutButton className="mt-2 w-full justify-center" />
    </Card>
  );
}
