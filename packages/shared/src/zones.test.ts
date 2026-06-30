import { describe, expect, test } from "vitest";
import { zoneCheckSchema } from "./zones.js";

describe("zone validation", () => {
  test("accepts valid slugs", () => {
    expect(zoneCheckSchema.parse({ category: "shop", slug: "esempio-123" })).toBeTruthy();
  });

  test("rejects invalid slugs", () => {
    expect(() => zoneCheckSchema.parse({ category: "shop", slug: "-bad" })).toThrow();
  });
});
