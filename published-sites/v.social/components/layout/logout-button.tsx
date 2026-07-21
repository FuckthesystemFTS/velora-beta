"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";

export function LogoutButton({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function logout() {
    if (!window.confirm("Vuoi disconnetterti da V per Verita?")) {
      return;
    }

    setLoading(true);

    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  if (compact) {
    return (
      <Button
        type="button"
        variant="ghost"
        onClick={() => void logout()}
        className={className ?? "h-10 w-10 rounded-2xl px-0"}
        aria-label="Logout"
        disabled={loading}
      >
        <LogOut size={16} />
      </Button>
    );
  }

  return (
    <Button type="button" variant="ghost" onClick={() => void logout()} className={className} disabled={loading}>
      {loading ? "Uscita..." : "Logout"}
    </Button>
  );
}
