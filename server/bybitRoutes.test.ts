import { scryptSync } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBybitRouter, createSiteApiGate, type BybitRouterOptions } from "./bybitRoutes";
import type { BybitAccountSnapshot } from "../shared/bybitAccount";

const ORIGIN = "https://thefinancialrevolution.com.au";
const COOKIE = "__Host-tfr_bybit_owner";
const PASSWORD = "  Private fixture password 🔒  ";
const WINDOW = 15 * 60 * 1000;
const TTL = 8 * 60 * 60 * 1000;
const record = {
  version: 1,
  kdf: "scrypt",
  N: 16384,
  r: 8,
  p: 1,
  keylen: 64,
  salt: "ab".repeat(32),
  password_hash: scryptSync(PASSWORD, Buffer.from("ab".repeat(32), "hex"), 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  }).toString("hex"),
  created_at: "2026-09-21T12:00:00.123456+00:00",
};
const snapshot: BybitAccountSnapshot = {
  status: "connected",
  retrieved_at: "2026-09-21T12:00:00Z",
  read_only_verified: true,
  ip_restricted: true,
  account_type: "UNIFIED",
  unified_margin_status: 5,
  margin_mode: "REGULAR_MARGIN",
  totals: {
    equity_usd: "123",
    wallet_balance_usd: "120",
    perpetual_unrealised_pnl_usd: "3",
    available_balance_usd: "100",
  },
  balances: [],
  positions: [],
  coverage: {
    wallet: true,
    linear_usdt: true,
    linear_usdc: true,
    inverse: true,
  },
  warnings: [],
};

let directory: string;
let file: string;
let time: number;
let servers: Server[];
let getSnapshot: ReturnType<typeof vi.fn<BybitRouterOptions["getSnapshot"]>>;

beforeEach(async () => {
  await mkdir("/tmp/opencode", { recursive: true });
  directory = await mkdtemp("/tmp/opencode/bybit-routes-");
  file = `${directory}/owner.json`;
  await writeFile(file, JSON.stringify(record), { mode: 0o600 });
  time = Date.parse("2026-09-21T12:00:00Z");
  servers = [];
  getSnapshot = vi.fn().mockResolvedValue(snapshot);
});

afterEach(async () => {
  await Promise.all(
    servers.map(
      server =>
        new Promise<void>((resolve, reject) => {
          server.close(error => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        })
    )
  );
  await rm(directory, { recursive: true, force: true });
});

async function serve(
  overrides: Partial<BybitRouterOptions> = {},
  trustLoopback = false,
  parseBefore = false
) {
  const app = express();
  if (trustLoopback) app.set("trust proxy", "loopback");
  if (parseBefore) app.use(express.json());
  app.use(
    "/api/bybit",
    createBybitRouter({
      getSnapshot,
      ownerAuthFile: file,
      requireHttps: false,
      now: () => time,
      ...overrides,
    })
  );
  const server = await new Promise<Server>(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/bybit`;
  return {
    request: (path: string, init: RequestInit = {}) =>
      fetch(`${base}${path}`, init),
    login: (
      password: unknown = PASSWORD,
      headers: Record<string, string> = {}
    ) =>
      fetch(`${base}/login`, {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({ password }),
      }),
  };
}

function cookie(response: globalThis.Response) {
  const value = response.headers.get("set-cookie");
  expect(value).toMatch(new RegExp(`^${COOKIE}=[a-f0-9]{64};`));
  return value!.split(";")[0];
}

function privateHeaders(response: globalThis.Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toContain("Cookie");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
}

async function denied(response: globalThis.Response) {
  expect(response.status).toBe(401);
  privateHeaders(response);
  expect(await response.json()).toEqual({
    error: {
      code: "AUTH_REQUIRED",
      message: "Unlock the private Bybit account view.",
    },
  });
}

describe("private Bybit owner routes (local HTTP only; no Bybit client)", () => {
  it("returns only session booleans without fetching account data", async () => {
    const api = await serve();
    const response = await api.request("/session");
    privateHeaders(response);
    expect(await response.json()).toEqual({
      authenticated: false,
      login_configured: true,
    });
    await denied(await api.request("/account"));
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it("rejects forged tokens, legacy frontend cookies and remember flags", async () => {
    const api = await serve();
    for (const forged of [
      `${COOKIE}=${"a".repeat(64)}`,
      `${COOKIE}=unsigned.fake.jwt`,
      "tfr_gate_v1=old.jwt; tfr_gate=unlocked; remember=true; password=old-default",
    ])
      await denied(
        await api.request("/account", { headers: { Cookie: forged } })
      );
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it("uses real async scrypt, exact password bytes, and a secure opaque owner cookie", async () => {
    const api = await serve();
    expect((await api.login(PASSWORD.trim())).status).toBe(401);
    const response = await api.login();
    expect(response.status).toBe(200);
    privateHeaders(response);
    expect(await response.json()).toEqual({
      authenticated: true,
      login_configured: true,
    });
    const bearer = cookie(response);
    const attributes = response.headers.get("set-cookie")!;
    for (const part of [
      "HttpOnly",
      "Secure",
      "SameSite=Strict",
      "Path=/",
      "Max-Age=28800",
      "Expires=",
    ])
      expect(attributes).toContain(part);
    expect(attributes).not.toContain("Domain=");
    expect(attributes).not.toContain(record.password_hash);
    expect(attributes).not.toContain(record.salt);
    expect(bearer).not.toContain(PASSWORD);
    expect(getSnapshot).not.toHaveBeenCalled();
    const session = await api.request("/session", {
      headers: { Cookie: bearer },
    });
    expect(await session.json()).toEqual({
      authenticated: true,
      login_configured: true,
    });
    const account = await api.request("/account", {
      headers: { Cookie: bearer },
    });
    privateHeaders(account);
    expect(await account.json()).toEqual(snapshot);
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    const second = cookie(await api.login());
    expect(second).not.toEqual(bearer);
  });

  it("rejects duplicate and malformed cookies even when one token is valid", async () => {
    const api = await serve({ verifyPassword: async () => true });
    const bearer = cookie(await api.login());
    const token = bearer.split("=")[1];
    for (const value of [
      `${bearer}; ${bearer}`,
      `${COOKIE}=bad; ${bearer}`,
      `${bearer}; ${COOKIE}`,
      `${COOKIE}="${token}"`,
      `${COOKIE} =${token}`,
      `${COOKIE}=%61${token.slice(1)}`,
    ])
      await denied(
        await api.request("/account", { headers: { Cookie: value } })
      );
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it("expires absolutely after eight hours; session polling does not extend it", async () => {
    const api = await serve({ verifyPassword: async () => true });
    const bearer = cookie(await api.login());
    time += TTL - 1;
    expect(
      await (
        await api.request("/session", { headers: { Cookie: bearer } })
      ).json()
    ).toEqual({ authenticated: true, login_configured: true });
    time += 1;
    await denied(
      await api.request("/account", { headers: { Cookie: bearer } })
    );
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it("requires exact allowed origins on login and logout, including anonymous logout", async () => {
    const verifyPassword = vi.fn(async () => true);
    const api = await serve({ verifyPassword });
    const bearer = cookie(await api.login());
    verifyPassword.mockClear();
    for (const origin of [
      undefined,
      "null",
      "https://evil.example",
      `${ORIGIN}.evil.example`,
      `${ORIGIN}/`,
      "http://thefinancialrevolution.com.au",
    ]) {
      for (const path of ["/login", "/logout"]) {
        const response = await api.request(path, {
          method: "POST",
          headers: {
            ...(origin ? { Origin: origin } : {}),
            Cookie: bearer,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ password: PASSWORD }),
        });
        expect(response.status).toBe(403);
        privateHeaders(response);
      }
    }
    expect(verifyPassword).not.toHaveBeenCalled();
    expect(
      await (
        await api.request("/session", { headers: { Cookie: bearer } })
      ).json()
    ).toMatchObject({ authenticated: true });
    expect(getSnapshot).not.toHaveBeenCalled();
    expect(
      (
        await api.login(PASSWORD, {
          Origin: "https://www.thefinancialrevolution.com.au",
        })
      ).status
    ).toBe(200);
  });

  it("allows a configured exact origin, without wildcard or prefix matching", async () => {
    const api = await serve({
      allowedOrigins: ["https://owner.example"],
      verifyPassword: async () => true,
    });
    expect((await api.login()).status).toBe(403);
    expect(
      (await api.login(PASSWORD, { Origin: "https://owner.example" })).status
    ).toBe(200);
  });

  it("logout revokes only the presented session and clears the correct cookie", async () => {
    const api = await serve({ verifyPassword: async () => true });
    const first = cookie(await api.login());
    const second = cookie(await api.login());
    const response = await api.request("/logout", {
      method: "POST",
      headers: { Origin: ORIGIN, Cookie: first },
    });
    expect(response.status).toBe(200);
    privateHeaders(response);
    const clear = response.headers.get("set-cookie")!;
    expect(clear).toContain(`${COOKIE}=;`);
    for (const part of [
      "Path=/",
      "HttpOnly",
      "Secure",
      "SameSite=Strict",
      "01 Jan 1970",
    ])
      expect(clear).toContain(part);
    await denied(await api.request("/account", { headers: { Cookie: first } }));
    expect(
      await (
        await api.request("/session", { headers: { Cookie: second } })
      ).json()
    ).toMatchObject({ authenticated: true });
    expect(
      (
        await api.request("/logout", {
          method: "POST",
          headers: { Origin: ORIGIN },
        })
      ).status
    ).toBe(200);
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it("wrong login revokes an existing session without disclosing its identity", async () => {
    const api = await serve();
    const bearer = cookie(await api.login());
    const response = await api.login("incorrect-password", { Cookie: bearer });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "LOGIN_FAILED",
        message: "The private account password was not accepted.",
      },
    });
    await denied(
      await api.request("/account", { headers: { Cookie: bearer } })
    );
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it("revokes all sessions on fresh password-file rotation, removal, or permission failure", async () => {
    const api = await serve({ verifyPassword: async () => true });
    const first = cookie(await api.login());
    const second = cookie(await api.login());
    const changed = { ...record, password_hash: "cd".repeat(64) };
    await writeFile(`${file}.new`, JSON.stringify(changed), { mode: 0o600 });
    await rename(`${file}.new`, file);
    for (const bearer of [first, second])
      await denied(
        await api.request("/account", { headers: { Cookie: bearer } })
      );
    const third = cookie(await api.login());
    await chmod(file, 0o644);
    await denied(await api.request("/account", { headers: { Cookie: third } }));
    await chmod(file, 0o600);
    await denied(await api.request("/account", { headers: { Cookie: third } }));
    const fourth = cookie(await api.login());
    await rm(file);
    await denied(
      await api.request("/account", { headers: { Cookie: fourth } })
    );
    await writeFile(file, JSON.stringify(changed), { mode: 0o600 });
    await denied(
      await api.request("/account", { headers: { Cookie: fourth } })
    );
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it.each([
    "missing",
    "mode644",
    "mode400",
    "symlink",
    "directory",
    "oversize",
    "invalidJSON",
    "extraField",
    "badKdf",
    "badN",
    "badR",
    "badP",
    "badLength",
    "badSalt",
    "badHash",
    "badDate",
  ])("fails closed with %s authentication file", async kind => {
    if (kind === "missing") await rm(file);
    else if (kind === "mode644") await chmod(file, 0o644);
    else if (kind === "mode400") await chmod(file, 0o400);
    else if (kind === "symlink") {
      await rename(file, `${file}.target`);
      await symlink(`${file}.target`, file);
    } else if (kind === "directory") {
      await rm(file);
      await mkdir(file);
    } else if (kind === "oversize") await writeFile(file, " ".repeat(4097));
    else if (kind === "invalidJSON")
      await writeFile(file, "PRIVATE-FILE-MARKER");
    else {
      const bad = {
        extraField: { unknown: true },
        badKdf: { kdf: "bcrypt" },
        badN: { N: 32768 },
        badR: { r: 9 },
        badP: { p: 2 },
        badLength: { keylen: 32 },
        badSalt: { salt: "secret" },
        badHash: { password_hash: "secret" },
        badDate: { created_at: "yesterday" },
      }[kind];
      await writeFile(file, JSON.stringify({ ...record, ...bad }));
    }
    const verifyPassword = vi.fn(async () => true);
    const api = await serve({ verifyPassword });
    const session = await api.request("/session");
    privateHeaders(session);
    expect(await session.json()).toEqual({
      authenticated: false,
      login_configured: false,
    });
    const response = await api.login();
    expect(response.status).toBe(503);
    privateHeaders(response);
    expect(await response.json()).toEqual({
      error: {
        code: "LOGIN_UNAVAILABLE",
        message: "Private account login is unavailable.",
      },
    });
    await denied(await api.request("/account"));
    expect(verifyPassword).not.toHaveBeenCalled();
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it("does not create a session if the owner file rotates while password verification runs", async () => {
    const api = await serve({
      verifyPassword: async () => {
        await writeFile(
          file,
          JSON.stringify({ ...record, salt: "cd".repeat(32) })
        );
        return true;
      },
    });
    const response = await api.login();
    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
    await denied(await api.request("/account"));
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it("does not release a snapshot if the password rotates during collection", async () => {
    getSnapshot.mockImplementation(async () => {
      await writeFile(
        file,
        JSON.stringify({ ...record, salt: "cd".repeat(32) })
      );
      return snapshot;
    });
    const api = await serve({ verifyPassword: async () => true });
    const bearer = cookie(await api.login());
    await denied(
      await api.request("/account", { headers: { Cookie: bearer } })
    );
  });

  it("enforces five attempts per IP before KDF, ignores untrusted forwarded IPs, and resets after 15 minutes", async () => {
    const verifyPassword = vi.fn(async () => false);
    const api = await serve({ verifyPassword });
    for (let i = 0; i < 5; i++)
      expect(
        (
          await api.login(PASSWORD, {
            "X-Forwarded-For": `198.51.100.${i + 1}`,
          })
        ).status
      ).toBe(401);
    const response = await api.login();
    expect(response.status).toBe(429);
    privateHeaders(response);
    expect(response.headers.get("retry-after")).toBe("900");
    expect(await response.json()).toMatchObject({
      error: { code: "RATE_LIMITED" },
    });
    expect(verifyPassword).toHaveBeenCalledTimes(5);
    time += WINDOW;
    expect((await api.login()).status).toBe(401);
    expect(verifyPassword).toHaveBeenCalledTimes(6);
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it("enforces 30 global attempts across distinct proxy-validated IPs before KDF", async () => {
    const verifyPassword = vi.fn(async () => false);
    const api = await serve({ verifyPassword }, true);
    for (let i = 0; i < 30; i++)
      expect(
        (
          await api.login(PASSWORD, {
            "X-Forwarded-For": `198.51.100.${i + 1}`,
          })
        ).status
      ).toBe(401);
    const response = await api.login(PASSWORD, {
      "X-Forwarded-For": "203.0.113.1",
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("900");
    expect(verifyPassword).toHaveBeenCalledTimes(30);
    time += WINDOW;
    expect((await api.login()).status).toBe(401);
    expect(verifyPassword).toHaveBeenCalledTimes(31);
  });

  it("counts malformed password attempts without calling KDF, including pre-parsed bodies", async () => {
    const verifyPassword = vi.fn(async () => false);
    const api = await serve({ verifyPassword }, false, true);
    for (const password of [null, 123, "short", "a".repeat(257), {}])
      expect((await api.login(password)).status).toBe(401);
    expect((await api.login()).status).toBe(429);
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it("matches Python character length for Unicode passwords and does not normalize", async () => {
    const verifyPassword = vi.fn(async () => true);
    const api = await serve({ verifyPassword });
    const password = "🔒".repeat(256);
    expect((await api.login(password)).status).toBe(200);
    expect(verifyPassword).toHaveBeenCalledWith(password, record);
    expect((await api.login("🔒".repeat(11))).status).toBe(401);
    expect((await api.login("🔒".repeat(257))).status).toBe(401);
    expect(verifyPassword).toHaveBeenCalledTimes(1);
  });

  it("bounds active sessions to 64 and does not evict newer tokens first", async () => {
    const api = await serve({ verifyPassword: async () => true });
    const tokens: string[] = [];
    for (let i = 0; i < 65; i++) {
      if (i && i % 5 === 0) time += WINDOW;
      tokens.push(cookie(await api.login()));
    }
    expect(new Set(tokens).size).toBe(65);
    await denied(
      await api.request("/account", { headers: { Cookie: tokens[0] } })
    );
    for (const token of [tokens[1], tokens[64]]) {
      expect(
        await (
          await api.request("/session", { headers: { Cookie: token } })
        ).json()
      ).toMatchObject({ authenticated: true });
    }
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it("keeps tokens hashed in the private in-memory map with no debugging exposure", async () => {
    // White-box storage invariant, in addition to black-box forged-cookie tests.
    const source = await readFile(
      new URL("./bybitRoutes.ts", import.meta.url),
      "utf8"
    );
    expect(source).toContain("sessions.set(hash(token),");
    expect(source).not.toContain("sessions.set(token,");
    const api = await serve();
    for (const path of ["/config", "/cache", "/credentials", "/sessions"]) {
      const response = await api.request(path);
      expect(response.status).toBe(404);
      privateHeaders(response);
      expect(await response.text()).not.toContain(record.password_hash);
    }
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it("requires HTTPS by default, never trusting arbitrary forwarded protocol headers", async () => {
    const api = await serve({ requireHttps: undefined });
    for (const path of ["/session", "/account"]) {
      const response = await api.request(path, {
        headers: { "X-Forwarded-Proto": "https" },
      });
      expect(response.status).toBe(403);
      privateHeaders(response);
    }
    expect(
      (await api.login(PASSWORD, { "X-Forwarded-Proto": "https" })).status
    ).toBe(403);
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it("supports req.secure when the parent trusts only the loopback TLS proxy", async () => {
    const api = await serve(
      { requireHttps: true, verifyPassword: async () => true },
      true
    );
    expect((await api.login()).status).toBe(403);
    const response = await api.login(PASSWORD, {
      "X-Forwarded-Proto": "https",
    });
    expect(response.status).toBe(200);
    cookie(response);
  });

  it.each([
    "CONFIGURATION",
    "READ_ONLY_REQUIRED",
    "INVALID_RESPONSE",
    "BYBIT_AUTH_FAILED",
    "BYBIT_10003",
    "__proto__",
    "API-SECRET-MARKER",
  ])("sanitizes client error %s to a fixed safe 503 response", async code => {
    getSnapshot.mockRejectedValue(
      Object.assign(new Error(`API-SECRET-MARKER ${file} ${PASSWORD}`), {
        code,
        httpStatus: 200,
        credentials: { secret: "API-SECRET-MARKER" },
      })
    );
    const api = await serve({ verifyPassword: async () => true });
    const bearer = cookie(await api.login());
    const response = await api.request("/account", {
      headers: { Cookie: bearer },
    });
    expect(response.status).toBe(503);
    privateHeaders(response);
    const text = await response.text();
    for (const secret of [
      "API-SECRET-MARKER",
      PASSWORD,
      record.password_hash,
      record.salt,
      file,
    ])
      expect(text).not.toContain(secret);
    expect(JSON.parse(text)).toMatchObject({
      error: { code: expect.any(String), message: expect.any(String) },
    });
  });

  it("never leaks unexpected password verifier errors", async () => {
    const api = await serve({
      verifyPassword: async () => {
        throw new Error(`PASSWORD-MARKER ${PASSWORD} ${file}`);
      },
    });
    const response = await api.login();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "LOGIN_UNAVAILABLE",
        message: "Private account login is unavailable.",
      },
    });
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it("sanitizes malformed/oversized local JSON parser failures and applies private headers", async () => {
    const api = await serve();
    for (const body of [
      '{"password":"PRIVATE-BODY-MARKER"',
      JSON.stringify({ password: "PRIVATE-BODY-MARKER".repeat(500) }),
    ]) {
      const response = await api.request("/login", {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body,
      });
      expect(response.status).toBe(400);
      privateHeaders(response);
      expect(await response.json()).toEqual({
        error: {
          code: "INVALID_REQUEST",
          message: "The request could not be processed.",
        },
      });
    }
    expect(getSnapshot).not.toHaveBeenCalled();
  });
});

describe("single site login (owner session gates every API route)", () => {
  async function site() {
    const app = express();
    const owner = createBybitRouter({ getSnapshot, ownerAuthFile: file, requireHttps: false, now: () => time });
    app.use("/api/bybit", owner);
    app.use("/api", createSiteApiGate(owner.requireOwner));
    app.get("/api/bull-rotation", (_req, res) => { res.json({ strategy: "data" }); });
    app.post("/api/push/trigger", (_req, res) => { res.json({ ok: true }); });
    app.get("/bull-rotation", (_req, res) => { res.send("<html>shell</html>"); });
    const server = await new Promise<Server>(resolve => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    servers.push(server);
    const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const login = () => fetch(`${root}/api/bybit/login`, {
      method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    return { root, login };
  }

  it("refuses strategy data without the owner session and serves it with one", async () => {
    const { root, login } = await site();
    const anonymous = await fetch(`${root}/api/bull-rotation`);
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("cache-control")).toBe("private, no-store");
    expect(await anonymous.json()).toEqual({ error: { code: "LOGIN_REQUIRED", message: "Sign in to view this dashboard." } });
    const forged = await fetch(`${root}/api/bull-rotation`, { headers: { Cookie: `${COOKIE}=${"a".repeat(64)}` } });
    expect(forged.status).toBe(401);
    const bearer = cookie(await login());
    const allowed = await fetch(`${root}/api/bull-rotation`, { headers: { Cookie: bearer } });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ strategy: "data" });
  });

  it("leaves the page shell and the secret-checked push trigger reachable", async () => {
    const { root } = await site();
    expect((await fetch(`${root}/bull-rotation`)).status).toBe(200);
    const trigger = await fetch(`${root}/api/push/trigger`, { method: "POST" });
    expect(trigger.status).toBe(200);
    // Only POST is exempt: a GET to the same path still needs the session.
    expect((await fetch(`${root}/api/push/trigger`)).status).toBe(401);
  });
});
