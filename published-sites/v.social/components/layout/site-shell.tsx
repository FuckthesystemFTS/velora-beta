import Link from "next/link";
import { Radio } from "lucide-react";

import { LogoutButton } from "@/components/layout/logout-button";
import { MobileNav } from "@/components/layout/mobile-nav";
import { Card } from "@/components/ui/card";
import { appCopy } from "@/lib/config";

export function SiteShell({
  sidebar,
  children,
  rightRail,
}: {
  sidebar: React.ReactNode;
  children: React.ReactNode;
  rightRail?: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[1480px] overflow-x-clip px-2 py-3 md:px-4 lg:px-6">
      <div className="mb-4 flex min-w-0 items-center gap-2 overflow-hidden rounded-[22px] border border-[var(--border)] bg-[rgba(255,255,255,0.02)] px-3 py-3 lg:hidden">
        <Link href="/feed" className="font-serif text-2xl font-semibold text-[var(--foreground)]">
          V
        </Link>
        <div className="min-w-0 flex-1 truncate text-right text-sm font-medium text-[var(--foreground)]">
          {appCopy.tagline}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/live"
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] text-[var(--foreground)]"
            aria-label="Apri live"
          >
            <Radio size={16} />
          </Link>
          <LogoutButton compact />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[250px_minmax(0,1fr)_320px]">
        <aside className="hidden lg:block">{sidebar}</aside>
        <main className="min-w-0 space-y-4 pb-28 lg:pb-6">{children}</main>
        {rightRail ? <aside className="min-w-0 space-y-4">{rightRail}</aside> : null}
      </div>

      <MobileNav />
    </div>
  );
}

export function BrandPanel() {
  return (
    <Card className="sticky top-5 overflow-hidden p-0">
      <div className="relative min-h-[160px] bg-[linear-gradient(180deg,rgba(19,20,26,0.92),rgba(7,8,12,0.96))] p-6">
        <div className="absolute inset-y-0 left-0 w-[72px] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.01))]" />
        <div className="relative z-10 ml-8 md:ml-10">
          <div className="font-serif text-6xl font-semibold leading-none text-[var(--accent)]">V</div>
          <Link href="/" className="mt-4 block font-serif text-3xl font-semibold tracking-[0.04em] text-[var(--foreground)]">
            {appCopy.name}
          </Link>
        </div>
      </div>
    </Card>
  );
}
