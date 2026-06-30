import { describe, expect, test } from "vitest";
import { createVelora } from "./index.js";

describe("Velora SDK", () => {
  test("returns typed NOT_YET_AVAILABLE when no host session exists", async () => {
    const velora = createVelora();
    await expect(velora.auth.getSession()).resolves.toMatchObject({
      available: false,
      status: "NOT_YET_AVAILABLE"
    });
  });

  test("resolves identity claims from a host-provided session", async () => {
    const velora = createVelora({
      sessionProvider: () => ({ available: true, userId: "u_1", identityLevel: 2, scopes: ["profile"] })
    });
    await expect(velora.identity.getClaims()).resolves.toMatchObject({
      available: true,
      verifiedEmail: true,
      verifiedDocument: true,
      level: 2
    });
  });
});
