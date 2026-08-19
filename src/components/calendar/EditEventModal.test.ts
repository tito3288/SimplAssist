import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("EditEventModal durable mutation identity", () => {
  const source = readFileSync(
    new URL("./EditEventModal.tsx", import.meta.url),
    "utf8"
  );

  it("retains the operation ID for exact retries and sends it on PATCH", () => {
    expect(source).toContain("nextCalendarMutationOperationId(");
    expect(source).toContain("operationId: operationIdRef.current");
    expect(source).toContain('method: "PATCH"');
  });

  it("never renders a private API/provider error payload", () => {
    expect(source).not.toContain("data.error");
    expect(source).toContain(
      'setError("We couldn\'t update this event. Please try again.")'
    );
  });
});
