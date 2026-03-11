import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock the DB helpers so tests don't need a real database
vi.mock("./db", () => ({
  getAppSetting: vi.fn(),
  setAppSetting: vi.fn(),
  // other exports used elsewhere — provide stubs
  getDb: vi.fn(),
  upsertUser: vi.fn(),
  getUserByOpenId: vi.fn(),
  savePushSubscription: vi.fn(),
  getAllPushSubscriptions: vi.fn(),
  deletePushSubscription: vi.fn(),
  getSignalState: vi.fn(),
  upsertSignalState: vi.fn(),
  insertTradeLog: vi.fn(),
  getTradeLog: vi.fn(),
  deleteTradeLogEntry: vi.fn(),
}));

import { getAppSetting, setAppSetting } from "./db";
import bcrypt from "bcryptjs";

const KNOWN_PASSWORD = "TestPassword123!";
let knownHash: string;

function createCtx(cookies: Record<string, string> = {}): {
  ctx: TrpcContext;
  setCookies: Array<{ name: string; value: string; options: Record<string, unknown> }>;
  clearedCookies: string[];
} {
  const setCookies: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
  const clearedCookies: string[] = [];

  const ctx: TrpcContext = {
    user: null,
    req: {
      protocol: "https",
      headers: { "x-forwarded-proto": "https" },
      cookies,
    } as unknown as TrpcContext["req"],
    res: {
      cookie: (name: string, value: string, options: Record<string, unknown>) => {
        setCookies.push({ name, value, options });
      },
      clearCookie: (name: string) => {
        clearedCookies.push(name);
      },
    } as unknown as TrpcContext["res"],
  };

  return { ctx, setCookies, clearedCookies };
}

describe("password.checkGate", () => {
  it("returns unlocked:false when no cookie is present", async () => {
    const { ctx } = createCtx({});
    const caller = appRouter.createCaller(ctx);
    const result = await caller.password.checkGate();
    expect(result).toEqual({ unlocked: false });
  });

  it("returns unlocked:false for an invalid/tampered cookie", async () => {
    const { ctx } = createCtx({ tfr_gate_v1: "invalid.jwt.token" });
    const caller = appRouter.createCaller(ctx);
    const result = await caller.password.checkGate();
    expect(result).toEqual({ unlocked: false });
  });
});

describe("password.unlock", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    knownHash = await bcrypt.hash(KNOWN_PASSWORD, 10);
    vi.mocked(getAppSetting).mockResolvedValue(knownHash);
    vi.mocked(setAppSetting).mockResolvedValue(undefined);
  });

  it("returns success:false for a wrong password", async () => {
    const { ctx, setCookies } = createCtx();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.password.unlock({ password: "WrongPassword!" });
    expect(result).toEqual({ success: false });
    expect(setCookies).toHaveLength(0);
  });

  it("returns success:true and sets a gate cookie for the correct password", async () => {
    const { ctx, setCookies } = createCtx();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.password.unlock({ password: KNOWN_PASSWORD });
    expect(result).toEqual({ success: true });
    expect(setCookies).toHaveLength(1);
    expect(setCookies[0]?.name).toBe("tfr_gate_v1");
    expect(setCookies[0]?.options).toMatchObject({
      httpOnly: true,
      path: "/",
      sameSite: "none",
    });
  });

  it("hashes and stores the default password on first run (no hash in DB)", async () => {
    vi.mocked(getAppSetting).mockResolvedValue(null); // no hash stored yet
    const { ctx } = createCtx();
    const caller = appRouter.createCaller(ctx);
    // Should not throw — it creates the hash on first call
    const result = await caller.password.unlock({ password: "*c@6$2gZaFUxzu3y" });
    expect(setAppSetting).toHaveBeenCalledWith(
      "dashboard_password_hash",
      expect.any(String)
    );
    // The stored hash should be a valid bcrypt hash
    const storedHash = vi.mocked(setAppSetting).mock.calls[0]?.[1] as string;
    expect(storedHash).toMatch(/^\$2[aby]\$/);
  });
});

describe("password.changePassword", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    knownHash = await bcrypt.hash(KNOWN_PASSWORD, 10);
    vi.mocked(getAppSetting).mockResolvedValue(knownHash);
    vi.mocked(setAppSetting).mockResolvedValue(undefined);
  });

  it("returns success:false when current password is wrong", async () => {
    const { ctx } = createCtx();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.password.changePassword({
      currentPassword: "WrongCurrent",
      newPassword: "NewPassword456!",
    });
    expect(result.success).toBe(false);
    expect(setAppSetting).not.toHaveBeenCalled();
  });

  it("updates the hash and sets a new cookie when current password is correct", async () => {
    const { ctx, setCookies } = createCtx();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.password.changePassword({
      currentPassword: KNOWN_PASSWORD,
      newPassword: "NewPassword456!",
    });
    expect(result.success).toBe(true);
    expect(setAppSetting).toHaveBeenCalledWith(
      "dashboard_password_hash",
      expect.any(String)
    );
    // New hash should be valid bcrypt and match the new password
    const newHash = vi.mocked(setAppSetting).mock.calls[0]?.[1] as string;
    expect(await bcrypt.compare("NewPassword456!", newHash)).toBe(true);
    // Cookie should be refreshed
    expect(setCookies).toHaveLength(1);
    expect(setCookies[0]?.name).toBe("tfr_gate_v1");
  });
});

describe("password.lock", () => {
  it("clears the gate cookie", async () => {
    const { ctx, clearedCookies } = createCtx();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.password.lock();
    expect(result).toEqual({ success: true });
    expect(clearedCookies).toContain("tfr_gate_v1");
  });
});
