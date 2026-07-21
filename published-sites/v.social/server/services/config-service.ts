import { defaultSystemConfig } from "@/lib/config";
import { prisma } from "@/lib/prisma";

export async function getSystemConfig() {
  const config = await prisma.systemConfig.findUnique({ where: { id: "default" } });
  if (config) return config;

  return prisma.systemConfig.create({
    data: {
      id: "default",
      ...defaultSystemConfig,
    },
  });
}
