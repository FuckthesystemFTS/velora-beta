import { Role } from "@prisma/client";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { processPendingCases } from "@/server/services/moderation-service";

export async function POST() {
  const user = await requireUser();
  if (user.role !== Role.ADMIN && user.role !== Role.SUPERADMIN) {
    redirect("/forbidden");
  }

  await processPendingCases();
  redirect("/admin?processed=1");
}
