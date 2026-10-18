import { describe, expect, it } from "vitest";
import { isSessionExpiry } from "../client/src/components/OwnerGate";

const origin = "https://www.thefinancialrevolution.com.au";

describe("single-login session expiry detection", () => {
  it("treats a 401 from any same-origin data route as an ended session", () => {
    expect(isSessionExpiry("/api/bull-rotation", 401, origin)).toBe(true);
    expect(isSessionExpiry(`${origin}/api/bybit/performance`, 401, origin)).toBe(true);
  });
  it("ignores a rejected login attempt, other statuses and other origins", () => {
    expect(isSessionExpiry("/api/bybit/login", 401, origin)).toBe(false);
    expect(isSessionExpiry("/api/bull-rotation", 500, origin)).toBe(false);
    expect(isSessionExpiry("https://api.binance.com/api/v3/ticker", 401, origin)).toBe(false);
    expect(isSessionExpiry("/bull-rotation", 401, origin)).toBe(false);
  });
});
