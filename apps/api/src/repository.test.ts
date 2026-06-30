import { describe, expect, test } from "vitest";
import { zoneCheckSchema } from "@velora/shared";

describe("api zone input contract", () => {
  test("accepts a beta zone check payload", () => {
    expect(zoneCheckSchema.parse({ category: "shop", slug: "beta-store" })).toEqual({
      category: "shop",
      slug: "beta-store"
    });
  });
});
