import { z } from "zod";
import { navigationCategories } from "./categories.js";

export const zoneSlugRegex = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;

export const zoneStatusSchema = z.enum([
  "AVAILABLE",
  "TEMPORARILY_RESERVED",
  "PENDING_REVIEW",
  "ASSIGNED",
  "BLOCKED",
  "RESERVED_NAME",
  "INVALID"
]);

export const zoneRequestStateSchema = z.enum([
  "DRAFT",
  "SUBMITTED",
  "PENDING_REVIEW",
  "MORE_INFO_REQUIRED",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "CANCELLED"
]);

export const zoneCheckSchema = z.object({
  category: z.enum(navigationCategories),
  slug: z.string().min(3).max(63).regex(zoneSlugRegex)
});

export const zoneRequestSchema = z.object({
  category: z.enum(navigationCategories),
  requestedSlug: z.string().min(3).max(63).regex(zoneSlugRegex),
  displayName: z.string().min(2).max(120),
  requesterType: z.enum(["INDIVIDUAL", "COMPANY", "NONPROFIT"]),
  legalNameOrDisplayName: z.string().min(2).max(160),
  country: z.string().min(2).max(56),
  contactEmail: z.email(),
  contactPhoneOptional: z.string().max(30).optional().or(z.literal("")),
  projectDescription: z.string().min(20).max(1500),
  businessDescription: z.string().min(20).max(1500),
  existingWebsiteOptional: z.string().url().optional().or(z.literal("")),
  socialLinkOptional: z.string().url().optional().or(z.literal("")),
  ownershipDeclaration: z.boolean().refine((value) => value),
  contentType: z.enum(["INFORMATIONAL", "COMMERCE", "COMMUNITY", "MEDIA"]),
  ageRating: z.enum(["ALL", "13+", "16+", "18+"]),
  familySafe: z.boolean(),
  expectedLanguages: z.array(z.string().min(2).max(16)).min(1),
  termsAccepted: z.boolean().refine((value) => value),
  privacyAccepted: z.boolean().refine((value) => value)
});

export type ZoneCheckInput = z.infer<typeof zoneCheckSchema>;
export type ZoneRequestInput = z.infer<typeof zoneRequestSchema>;
export type ZoneAvailabilityStatus = z.infer<typeof zoneStatusSchema>;
