import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isAuthorizedReviewToken } from "./reviewToken";

describe("isAuthorizedReviewToken", () => {
  it("matches identical tokens", () => {
    expect(isAuthorizedReviewToken("secret-token-123", "secret-token-123")).toBe(
      true
    );
  });

  it("rejects a mismatched token of the same length", () => {
    expect(isAuthorizedReviewToken("secret-token-124", "secret-token-123")).toBe(
      false
    );
  });

  it("rejects a token of a different length", () => {
    expect(isAuthorizedReviewToken("secret", "secret-token-123")).toBe(false);
  });

  it("fails closed when no token is configured", () => {
    expect(isAuthorizedReviewToken("anything", undefined)).toBe(false);
    expect(isAuthorizedReviewToken("anything", "")).toBe(false);
  });

  it("fails closed when no token is provided", () => {
    expect(isAuthorizedReviewToken(undefined, "secret-token-123")).toBe(false);
    expect(isAuthorizedReviewToken("", "secret-token-123")).toBe(false);
    expect(isAuthorizedReviewToken(null, "secret-token-123")).toBe(false);
  });

  it("never treats empty-vs-empty as authorized", () => {
    expect(isAuthorizedReviewToken("", "")).toBe(false);
  });
});
