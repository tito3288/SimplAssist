import { describe, expect, it } from "vitest";

import { POST } from "./route";

describe("POST /api/messaging/numbers/release", () => {
  it("is retired and cannot release Telnyx or local resources", async () => {
    const response = await POST();

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "Direct phone-number release is no longer supported.",
      code: "number_release_managed_by_lifecycle",
    });
  });
});
