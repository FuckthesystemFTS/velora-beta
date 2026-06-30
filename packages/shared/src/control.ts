import { z } from "zod";

export const signedAdminCommandSchema = z.object({
  commandVersion: z.literal(1),
  commandId: z.uuid(),
  adminId: z.string().min(8),
  adminCertificateId: z.string().min(8),
  action: z.string().min(3),
  targetType: z.string().min(3),
  targetId: z.string().min(3),
  payload: z.record(z.string(), z.unknown()),
  nonce: z.string().min(12),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  signature: z.string().min(32)
});

export type SignedAdminCommand = z.infer<typeof signedAdminCommandSchema>;
