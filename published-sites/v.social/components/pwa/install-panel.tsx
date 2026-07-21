"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export function InstallPanel() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">Installa app</h1>
        <p className="text-sm leading-7 text-[var(--muted)]">
          Su Android e Chrome puoi installare V come app. Su iPhone usa Condividi → Aggiungi a Home.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            onClick={async () => {
              if (!promptEvent) {
                setMessage("Prompt installazione non disponibile su questo dispositivo.");
                return;
              }
              await promptEvent.prompt();
              const choice = await promptEvent.userChoice;
              setMessage(choice.outcome === "accepted" ? "Installazione avviata." : "Installazione annullata.");
            }}
          >
            Installa
          </Button>
        </div>
        {message ? <p className="text-sm text-[var(--gold)]">{message}</p> : null}
      </Card>

      <Card className="space-y-3">
        <div className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">iPhone / iPad</div>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-[var(--muted)]">
          <li>Apri V in Safari.</li>
          <li>Tocca Condividi.</li>
          <li>Seleziona Aggiungi a Home.</li>
        </ol>
      </Card>
    </div>
  );
}
