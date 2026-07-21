"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const COOKIE_KEY = "v_cookie_preferences";

export function CookieBanner() {
  const [visible, setVisible] = useState(() => {
    if (typeof window === "undefined") return false;
    return !localStorage.getItem(COOKIE_KEY);
  });
  if (!visible) return null;

  return (
    <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-3xl">
      <Card className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <p className="text-sm text-[var(--muted)]">
          Usiamo cookie essenziali per login, sicurezza e preferenze base.
        </p>
        <div className="flex gap-3">
          <Button
            variant="secondary"
            onClick={() => {
              localStorage.setItem(COOKIE_KEY, JSON.stringify({ essential: true, analytics: false }));
              setVisible(false);
            }}
          >
            Solo essenziali
          </Button>
          <Button
            onClick={() => {
              localStorage.setItem(COOKIE_KEY, JSON.stringify({ essential: true, analytics: true }));
              setVisible(false);
            }}
          >
            Accetta
          </Button>
        </div>
      </Card>
    </div>
  );
}
