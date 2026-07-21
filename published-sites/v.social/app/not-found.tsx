import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl items-center justify-center px-4">
      <Card className="max-w-xl space-y-4 text-center">
        <h1 className="font-serif text-5xl font-semibold">404</h1>
        <p className="text-[var(--muted)]">Pagina non trovata.</p>
        <Link href="/home">
          <Button>Torna al feed</Button>
        </Link>
      </Card>
    </main>
  );
}
