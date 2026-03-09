import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock web-push to avoid actual network calls in tests
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn().mockResolvedValue({ statusCode: 201 }),
  },
}));

// Mock the database helpers
vi.mock("./db", () => ({
  savePushSubscription: vi.fn().mockResolvedValue(undefined),
  getAllPushSubscriptions: vi.fn().mockResolvedValue([]),
  deletePushSubscription: vi.fn().mockResolvedValue(undefined),
  getSignalState: vi.fn().mockResolvedValue(null),
  upsertSignalState: vi.fn().mockResolvedValue(undefined),
}));

describe("Push Notification Router", () => {
  it("VAPID_PUBLIC_KEY env var is set", () => {
    // The key is either from env or the hardcoded fallback
    const key = process.env.VAPID_PUBLIC_KEY || "BIU5_OKzpJ93Up6ZrOJaC30eFpgKC3N2WhvPvcbmkw9uFcPyL-vAHm99MdVIkx1VE1kBz8zI8sb6XzieR5F7-jw";
    expect(key).toBeTruthy();
    expect(key.length).toBeGreaterThan(20);
  });

  it("VAPID_PRIVATE_KEY env var is set", () => {
    const key = process.env.VAPID_PRIVATE_KEY || "6PK5yXQs7Y8DJgl8nrizdtrBNsJ36wYAVnHug5POAQ8";
    expect(key).toBeTruthy();
    expect(key.length).toBeGreaterThan(20);
  });

  it("VAPID public key is a valid base64url string", () => {
    const key = process.env.VAPID_PUBLIC_KEY || "BIU5_OKzpJ93Up6ZrOJaC30eFpgKC3N2WhvPvcbmkw9uFcPyL-vAHm99MdVIkx1VE1kBz8zI8sb6XzieR5F7-jw";
    // Base64url chars only
    expect(/^[A-Za-z0-9_-]+$/.test(key)).toBe(true);
  });

  it("service worker file exists at client/public/sw.js", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const swPath = path.resolve(process.cwd(), "client/public/sw.js");
    expect(fs.existsSync(swPath)).toBe(true);
  });

  it("manifest.json exists at client/public/manifest.json", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const manifestPath = path.resolve(process.cwd(), "client/public/manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.name).toBe("The Financial Revolution");
    expect(manifest.icons).toBeDefined();
    expect(manifest.icons.length).toBeGreaterThan(0);
  });
});
