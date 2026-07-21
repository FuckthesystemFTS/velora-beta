import { notFound } from "next/navigation";

import { Card } from "@/components/ui/card";

const pages: Record<string, { title: string; body: string[] }> = {
  terms: {
    title: "Terms",
    body: [
      "Usando V accetti le regole della piattaforma, le policy e il modello di revisione dei contenuti previsto dal servizio.",
      "La prima segnalazione non produce danni automatici al contenuto o all'account.",
    ],
  },
  privacy: {
    title: "Privacy",
    body: [
      "Raccogliamo i dati necessari a far funzionare account, feed, sicurezza, notifiche e moderazione.",
      "I voti di moderazione restano anonimi verso gli utenti esterni e consultabili internamente solo per audit.",
    ],
  },
  cookie: {
    title: "Cookie Policy",
    body: [
      "Usiamo cookie essenziali per sessione, preferenze base e sicurezza.",
      "Nessun tracciamento pubblicitario obbligatorio nella versione attuale.",
    ],
  },
  "community-rules": {
    title: "Community Rules",
    body: [
      "Non sono ammessi violenza, hate, molestie, spam o contenuti illegali.",
      "Le decisioni sui contenuti segnalati passano per revisione distribuita e controllo finale del team.",
    ],
  },
  "moderation-rules": {
    title: "Moderation Policy",
    body: [
      "Segnalazione iniziale senza penalita immediate.",
      "Valutazione di una giuria casuale di utenti, poi di una giuria verificata, poi del team interno se la soglia viene superata.",
      "Non esiste appello formale: e possibile inviare feedback.",
    ],
  },
  "distributed-control": {
    title: "Jury System",
    body: [
      "Livello 0: report iniziale, nessuna penalizzazione automatica.",
      "Livello 1: 10 utenti casuali idonei votano.",
      "Livello 2: 5 utenti verificati rivedono il caso se il livello 1 supera la soglia.",
      "Livello 3: 3 membri del team decidono in maggioranza configurabile.",
    ],
  },
};

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = pages[slug];
  if (!page) notFound();

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <Card className="space-y-5">
        <h1 className="font-serif text-5xl font-semibold">{page.title}</h1>
        <div className="prose-v text-sm leading-8 text-[var(--muted)]">
          {page.body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </Card>
    </main>
  );
}
