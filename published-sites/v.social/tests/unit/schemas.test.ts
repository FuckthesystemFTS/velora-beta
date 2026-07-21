import { describe, expect, it } from "vitest";

import { loginSchema, postSchema, postUpdateSchema, registerSchema, reportSchema } from "@/server/services/schemas";

describe("validation schemas", () => {
  it("accetta una registrazione valida", () => {
    const result = registerSchema.safeParse({
      email: "test@v.local",
      username: "testuser",
      displayName: "Test User",
      password: "SecurePass123",
      acceptPolicies: true,
    });
    expect(result.success).toBe(true);
  });

  it("blocca password deboli", () => {
    const result = registerSchema.safeParse({
      email: "test@v.local",
      username: "testuser",
      displayName: "Test User",
      password: "weak",
      acceptPolicies: true,
    });
    expect(result.success).toBe(false);
  });

  it("valida il payload API per post", () => {
    const result = postSchema.safeParse({
      content: "Hello V",
      visibility: "PUBLIC",
      media: [],
    });
    expect(result.success).toBe(true);
  });

  it("valida report e login", () => {
    expect(loginSchema.safeParse({ identifier: "demo@v.local", password: "Password123" }).success).toBe(true);
    expect(reportSchema.safeParse({ postId: "abc", reason: "HARASSMENT" }).success).toBe(true);
  });

  it("accetta media locali con URL relativo", () => {
    const result = postSchema.safeParse({
      content: "Post con immagine locale",
      visibility: "PUBLIC",
      media: [
        {
          secureUrl: "/uploads/test.png",
          publicId: "local/test.png",
          resourceType: "IMAGE",
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("accetta share senza testo originale", () => {
    const result = postSchema.safeParse({
      content: "",
      visibility: "PUBLIC",
      media: [],
      shareOfPostId: "post_1",
    });

    expect(result.success).toBe(true);
  });

  it("accetta post con solo media", () => {
    const result = postSchema.safeParse({
      content: "",
      visibility: "PUBLIC",
      media: [
        {
          secureUrl: "/api/media/local/example.png",
          publicId: "local/example.png",
          resourceType: "IMAGE",
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("valida aggiornamento post", () => {
    const result = postUpdateSchema.safeParse({
      content: "Testo aggiornato",
      visibility: "FOLLOWERS_ONLY",
    });

    expect(result.success).toBe(true);
  });
});
