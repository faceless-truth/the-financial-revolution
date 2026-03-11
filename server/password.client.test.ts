import { describe, it, expect } from "vitest";
import { createHash } from "crypto";

// Replicate the browser sha256 using Node crypto for testing
function sha256(message: string): string {
  return createHash("sha256").update(message).digest("hex");
}

const DEFAULT_HASH = "e773972be28a7d8545e37e55b86ea8cd40750cacf341f441c3ea5cc78ba31cc1";

describe("Client-side password gate", () => {
  it("TFR2026 hashes to the correct DEFAULT_HASH", () => {
    expect(sha256("TFR2026")).toBe(DEFAULT_HASH);
  });

  it("wrong password does not match DEFAULT_HASH", () => {
    expect(sha256("wrongpassword")).not.toBe(DEFAULT_HASH);
    expect(sha256("TFR2025")).not.toBe(DEFAULT_HASH);
    expect(sha256("tfr2026")).not.toBe(DEFAULT_HASH);
  });

  it("empty string does not match DEFAULT_HASH", () => {
    expect(sha256("")).not.toBe(DEFAULT_HASH);
  });
});
