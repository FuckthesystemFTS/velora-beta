import { Card } from "@/components/ui/card";

export default function PostLoading() {
  return (
    <main className="mx-auto max-w-[900px] px-4 py-6">
      <Card className="h-[520px] animate-pulse bg-black/20" />
    </main>
  );
}
