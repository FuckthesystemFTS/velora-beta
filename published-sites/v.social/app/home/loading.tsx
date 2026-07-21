import { Card } from "@/components/ui/card";

export default function HomeLoading() {
  return (
    <main className="mx-auto max-w-[1100px] px-4 py-6">
      <div className="space-y-4">
        <Card className="h-48 animate-pulse bg-black/20" />
        <Card className="h-72 animate-pulse bg-black/20" />
        <Card className="h-72 animate-pulse bg-black/20" />
      </div>
    </main>
  );
}
