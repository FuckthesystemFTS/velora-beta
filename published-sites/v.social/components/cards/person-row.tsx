"use client";

import Link from "next/link";

import { FollowButton } from "@/components/forms/follow-button";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

type PersonRowProps = {
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  bio?: string | null;
  role?: string;
  href?: string;
  showFollow?: boolean;
};

export function PersonRow({ username, displayName, avatarUrl, bio, role, href, showFollow = true }: PersonRowProps) {
  const profileHref = href ?? `/profile/${username}`;

  return (
    <div className="flex items-center gap-3 rounded-[22px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-3">
      <Avatar name={displayName} src={avatarUrl} size={46} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link href={profileHref} className="truncate text-sm font-semibold text-[var(--foreground)]">
            {displayName}
          </Link>
          {role && role !== "USER" ? (
            <Badge className="border-[rgba(255,88,62,0.18)] text-[var(--foreground)]">{role.replaceAll("_", " ")}</Badge>
          ) : null}
        </div>
        <p className="truncate text-xs uppercase tracking-[0.14em] text-[var(--muted)]">@{username}</p>
        {bio ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--muted)]">{bio}</p> : null}
      </div>
      {showFollow ? <FollowButton username={username} compact /> : null}
    </div>
  );
}
