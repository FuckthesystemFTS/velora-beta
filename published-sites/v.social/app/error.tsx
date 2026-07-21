"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl items-center justify-center px-4">
      <Card className="space-y-4 text-center">
        <h1 className="font-serif text-5xl font-semibold">500</h1>
        <p className="text-[var(--muted)]">Errore interno. I dettagli tecnici non vengono esposti in produzione.</p>
        <Button onClick={() => reset()}>Riprova</Button>
      </Card>
    </main>
  );
}
