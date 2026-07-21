import { ReportReason, Role, Visibility } from "@prisma/client";
import { z } from "zod";

function isMediaUrl(value: string) {
  if (value.startsWith("/")) return true;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export const registerSchema = z.object({
  email: z.string().trim().email("Inserisci un indirizzo email valido."),
  username: z
    .string()
    .trim()
    .min(3, "Lo username deve avere almeno 3 caratteri.")
    .max(24, "Lo username non puo superare 24 caratteri.")
    .regex(/^[a-z0-9_]+$/i, "Lo username puo contenere solo lettere, numeri e underscore."),
  displayName: z
    .string()
    .trim()
    .min(2, "Il nome visibile deve avere almeno 2 caratteri.")
    .max(50, "Il nome visibile non puo superare 50 caratteri."),
  password: z
    .string()
    .min(10, "La password deve avere almeno 10 caratteri.")
    .regex(/[A-Z]/, "La password deve contenere almeno una lettera maiuscola.")
    .regex(/[a-z]/, "La password deve contenere almeno una lettera minuscola.")
    .regex(/[0-9]/, "La password deve contenere almeno un numero."),
  acceptPolicies: z.literal(true, "Devi accettare policy e regole prima di creare l'account."),
});

export const loginSchema = z.object({
  identifier: z.string().min(3),
  password: z.string().min(1),
});

export const forgotPasswordSchema = z.object({
  identifier: z.string().min(3),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(10),
  newPassword: z
    .string()
    .min(10)
    .regex(/[A-Z]/, "Serve una maiuscola")
    .regex(/[a-z]/, "Serve una minuscola")
    .regex(/[0-9]/, "Serve un numero"),
});

export const postSchema = z
  .object({
    content: z.string().max(5000),
    visibility: z.nativeEnum(Visibility).default(Visibility.PUBLIC),
    media: z
      .array(
        z.object({
          secureUrl: z.string().refine(isMediaUrl, "URL media non valido"),
          publicId: z.string().min(1),
          resourceType: z.enum(["IMAGE", "VIDEO"]),
          format: z.string().optional().nullable(),
          width: z.number().int().optional().nullable(),
          height: z.number().int().optional().nullable(),
          duration: z.number().int().optional().nullable(),
          bytes: z.number().int().optional().nullable(),
          fingerprint: z.string().optional().nullable(),
        }),
      )
      .max(6)
      .default([]),
    shareOfPostId: z.string().optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (!value.content.trim() && value.media.length === 0 && !value.shareOfPostId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["content"],
        message: "Il contenuto del post non puo essere vuoto.",
      });
    }
  });

export const postUpdateSchema = z.object({
  content: z.string().max(5000),
  visibility: z.nativeEnum(Visibility).default(Visibility.PUBLIC),
});

export const commentSchema = z.object({
  postId: z.string().min(1),
  content: z.string().min(1).max(1000),
  parentCommentId: z.string().optional().nullable(),
});

export const reportSchema = z.object({
  postId: z.string().min(1),
  reason: z.nativeEnum(ReportReason),
  reasonText: z.string().max(1000).optional().nullable(),
});

export const voteSchema = z.object({
  decision: z.enum(["REMOVE", "KEEP", "CONFIRM_REMOVE", "RESTORE"]),
  note: z.string().max(1000).optional().nullable(),
});

export const teamDecisionSchema = z.object({
  caseId: z.string().min(1),
  outcome: z.enum(["CONFIRM_SUSPENSION", "REMOVE_FINAL", "RESTORE_CONTENT"]),
  note: z.string().max(1000).optional().nullable(),
});

export const feedbackSchema = z.object({
  moderationCaseId: z.string().optional().nullable(),
  message: z.string().min(10).max(2000),
});

export const roleUpdateSchema = z.object({
  userId: z.string(),
  role: z.nativeEnum(Role),
});
