import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import {
  Router,
  json,
  type ErrorRequestHandler,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import type { BybitAccountSnapshot } from "../shared/bybitAccount";
import type { BybitSpotPortfolio } from "../shared/bybitSpot";
import type { AccountPerformance } from "../shared/cockpit";

const COOKIE = "__Host-tfr_bybit_owner";
const SESSION_MS = 8 * 60 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "strict" as const,
  path: "/",
};
const DEFAULT_ORIGINS = [
  "https://thefinancialrevolution.com.au",
  "https://www.thefinancialrevolution.com.au",
];

export interface BybitOwnerAuthRecord {
  version: 1;
  kdf: "scrypt";
  N: 16384;
  r: 8;
  p: 1;
  keylen: 64;
  salt: string;
  password_hash: string;
  created_at: string;
}

export interface BybitRouterOptions {
  getSnapshot: () => Promise<BybitAccountSnapshot>;
  getPortfolio?: () => Promise<BybitSpotPortfolio>;
  getPerformance?: () => Promise<AccountPerformance>;
  ownerAuthFile?: string;
  allowedOrigins?: string[];
  /** Leave enabled in production. The parent must trust only its loopback proxy. */
  requireHttps?: boolean;
  now?: () => number;
  /** Test seam only; production uses asynchronous scrypt and timingSafeEqual. */
  verifyPassword?: (
    password: string,
    record: Readonly<BybitOwnerAuthRecord>
  ) => Promise<boolean>;
}

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function loadAuth(
  path: string
): { record: BybitOwnerAuthRecord; fingerprint: string } | null {
  let fd: number | undefined;
  try {
    // NOFOLLOW rejects symlinks; NONBLOCK ensures a malicious FIFO cannot hang the server.
    fd = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      (stat.mode & 0o7777) !== 0o600 ||
      stat.size > 4096 ||
      stat.size === 0
    )
      return null;
    if (stat.uid !== 0 && stat.uid !== process.geteuid?.()) return null;
    const buffer = Buffer.alloc(4097);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > 4096) return null;
    const bytes = buffer.subarray(0, length);
    const record = JSON.parse(bytes.toString("utf8"));
    if (
      !record ||
      typeof record !== "object" ||
      Array.isArray(record) ||
      Object.keys(record).sort().join(",") !==
        "N,created_at,kdf,keylen,p,password_hash,r,salt,version" ||
      record.version !== 1 ||
      record.kdf !== "scrypt" ||
      record.N !== 16384 ||
      record.r !== 8 ||
      record.p !== 1 ||
      record.keylen !== 64 ||
      typeof record.salt !== "string" ||
      !/^[a-fA-F0-9]{64}$/.test(record.salt) ||
      typeof record.password_hash !== "string" ||
      !/^[a-fA-F0-9]{128}$/.test(record.password_hash) ||
      typeof record.created_at !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(
        record.created_at
      ) ||
      !Number.isFinite(Date.parse(record.created_at))
    )
      return null;
    return { record, fingerprint: hash(bytes) };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function verifyOwnerPassword(
  password: string,
  record: Readonly<BybitOwnerAuthRecord>
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      Buffer.from(record.salt, "hex"),
      record.keylen,
      { N: record.N, r: record.r, p: record.p, maxmem: 64 * 1024 * 1024 },
      (error, derived) => {
        if (error) return reject(error);
        resolve(
          timingSafeEqual(derived, Buffer.from(record.password_hash, "hex"))
        );
      }
    );
  });
}

function tokenHash(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header || header.length > 8192) return null;
  let token: string | undefined;
  for (const piece of header.split(";")) {
    const entry = piece.trim();
    const equal = entry.indexOf("=");
    const name = equal < 0 ? entry : entry.slice(0, equal).trim();
    if (name !== COOKIE) continue;
    // Reject duplicate, quoted, escaped, URL-encoded, or otherwise noncanonical values.
    if (token !== undefined || equal < 0 || entry.slice(0, equal) !== COOKIE)
      return null;
    token = entry.slice(equal + 1);
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
  }
  return token === undefined ? null : hash(token);
}

function failure(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

const SAFE_CLIENT_ERRORS: Record<string, string> = {
  CONFIGURATION: "The private account connection is not configured.",
  READ_ONLY_REQUIRED:
    "The private account connection requires read-only access.",
  UNSUPPORTED_ACCOUNT: "This private account type is not supported.",
  UPSTREAM_HTTP: "The private account connection is temporarily unavailable.",
  UPSTREAM_API: "The private account connection could not be verified.",
  UPSTREAM_UNAVAILABLE:
    "The private account connection is temporarily unavailable.",
  INVALID_RESPONSE:
    "The private account connection returned an invalid response.",
  CLOCK_INVALID:
    "The private account connection could not synchronize its clock.",
  CACHE_INVALIDATED: "The private account connection changed. Try again.",
  BYBIT_NOT_CONFIGURED: "The private account connection is not configured.",
  BYBIT_UNAVAILABLE:
    "The private account connection is temporarily unavailable.",
  BYBIT_AUTH_FAILED: "The private account connection could not be verified.",
  BYBIT_READ_ONLY_REQUIRED:
    "The private account connection requires read-only access.",
  BYBIT_IP_RESTRICTION_REQUIRED:
    "The private account connection requires IP restrictions.",
  BYBIT_RATE_LIMITED:
    "The private account connection is temporarily rate limited.",
};

/**
 * Mount at /api after the owner router. Every API route needs the owner
 * session, except the cron push trigger, which checks NOTIFY_SECRET itself.
 */
export function createSiteApiGate(requireOwner: RequestHandler): RequestHandler {
  return (req, res, next) => {
    if (req.method === "POST" && req.path === "/push/trigger") return next();
    return requireOwner(req, res, next);
  };
}

/** The owner router plus a guard that puts any other route behind the same owner session. */
export type BybitOwnerRouter = Router & { requireOwner: RequestHandler };

/** Mount at /api/bybit before static/SPA routes. No client or credentials are constructed here. */
export function createBybitRouter(options: BybitRouterOptions): BybitOwnerRouter {
  const router = Router();
  const now = options.now ?? Date.now;
  const verify = options.verifyPassword ?? verifyOwnerPassword;
  const origins = new Set(options.allowedOrigins ?? DEFAULT_ORIGINS);
  const authPath =
    options.ownerAuthFile ?? "/etc/crypto-dashboard/bybit-owner-auth.json";
  // Keys are SHA-256 digests only. Raw bearer tokens exist only while issuing a cookie.
  const sessions = new Map<string, { expiresAt: number; generation: number }>();
  const attempts = new Map<string, { count: number; expiresAt: number }>();
  let globalAttempts = { count: 0, expiresAt: 0 };
  let fingerprint: string | null = null;
  let generation = 0;

  function refreshAuth() {
    const auth = loadAuth(authPath);
    if ((auth?.fingerprint ?? null) !== fingerprint) {
      fingerprint = auth?.fingerprint ?? null;
      generation++;
      sessions.clear();
    }
    for (const [key, session] of Array.from(sessions)) {
      if (session.expiresAt <= now()) sessions.delete(key);
    }
    return auth;
  }

  function authenticated(req: Request): boolean {
    const key = tokenHash(req);
    const session = key ? sessions.get(key) : undefined;
    return (
      !!fingerprint &&
      !!session &&
      session.expiresAt > now() &&
      session.generation === generation
    );
  }

  function revoke(req: Request, res: Response) {
    const key = tokenHash(req);
    if (key) sessions.delete(key);
    res.clearCookie(COOKIE, COOKIE_OPTIONS);
  }

  function rateLimited(req: Request, res: Response): boolean {
    const time = now();
    for (const [ip, attempt] of Array.from(attempts))
      if (attempt.expiresAt <= time) attempts.delete(ip);
    if (globalAttempts.expiresAt <= time)
      globalAttempts = { count: 0, expiresAt: time + WINDOW_MS };
    const ip = req.ip || "unknown";
    const attempt = attempts.get(ip) ?? {
      count: 0,
      expiresAt: time + WINDOW_MS,
    };
    if (
      attempt.count >= 5 ||
      globalAttempts.count >= 30 ||
      (!attempts.has(ip) && attempts.size >= 1024)
    ) {
      const reset =
        attempt.count >= 5 ? attempt.expiresAt : globalAttempts.expiresAt;
      res.setHeader(
        "Retry-After",
        String(Math.max(1, Math.ceil((reset - time) / 1000)))
      );
      failure(
        res,
        429,
        "RATE_LIMITED",
        "Too many login attempts. Try again later."
      );
      return true;
    }
    attempt.count++;
    globalAttempts.count++;
    attempts.set(ip, attempt);
    return false;
  }

  router.use((req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.vary("Cookie");
    res.setHeader("X-Content-Type-Options", "nosniff");
    refreshAuth();
    const canonicalPaths = new Set(["/api/bybit/session", "/api/bybit/login", "/api/bybit/logout", "/api/bybit/account", "/api/bybit/portfolio", "/api/bybit/performance"]);
    if (!canonicalPaths.has(req.originalUrl.split("?", 1)[0])) {
      failure(res, 404, "NOT_FOUND", "This private account endpoint does not exist.");
      return;
    }
    if ((options.requireHttps ?? true) && !req.secure) {
      failure(res, 403, "HTTPS_REQUIRED", "A secure connection is required.");
      return;
    }
    // Older service workers cache navigations. Private JSON is fetch-only so
    // an authenticated address-bar navigation can never seed such a cache.
    if (req.method === "GET" && req.get("Sec-Fetch-Mode") === "navigate") {
      failure(res, 403, "FETCH_REQUIRED", "Use the private account view to read this data.");
      return;
    }
    if (
      req.method === "POST" &&
      (!req.headers.origin || !origins.has(req.headers.origin))
    ) {
      failure(res, 403, "ORIGIN_REJECTED", "This request is not allowed.");
      return;
    }
    next();
  });
  router.use(json({ limit: "4kb" }));

  router.get("/session", (req, res) => {
    res.json({
      authenticated: authenticated(req),
      login_configured: fingerprint !== null,
    });
  });

  router.post("/login", async (req, res) => {
    if (rateLimited(req, res)) return;
    const auth = refreshAuth();
    if (!auth) {
      failure(
        res,
        503,
        "LOGIN_UNAVAILABLE",
        "Private account login is unavailable."
      );
      return;
    }
    const password: unknown = req.body?.password;
    // Count Unicode code points like the Python setup CLI; never trim or normalize.
    if (
      typeof password !== "string" ||
      Array.from(password).length < 12 ||
      Array.from(password).length > 256
    ) {
      revoke(req, res);
      failure(
        res,
        401,
        "LOGIN_FAILED",
        "The private account password was not accepted."
      );
      return;
    }
    const startedGeneration = generation;
    try {
      const valid = await verify(password, auth.record);
      const current = refreshAuth();
      if (
        !current ||
        startedGeneration !== generation ||
        auth.fingerprint !== current.fingerprint
      ) {
        failure(
          res,
          503,
          "LOGIN_UNAVAILABLE",
          "Private account login is unavailable."
        );
        return;
      }
      if (!valid) {
        revoke(req, res);
        failure(
          res,
          401,
          "LOGIN_FAILED",
          "The private account password was not accepted."
        );
        return;
      }
      const previous = tokenHash(req);
      if (previous) sessions.delete(previous);
      while (sessions.size >= 64)
        sessions.delete(sessions.keys().next().value!);
      const token = randomBytes(32).toString("hex");
      sessions.set(hash(token), { expiresAt: now() + SESSION_MS, generation });
      res.cookie(COOKIE, token, { ...COOKIE_OPTIONS, maxAge: SESSION_MS });
      res.json({ authenticated: true, login_configured: true });
    } catch {
      failure(
        res,
        503,
        "LOGIN_UNAVAILABLE",
        "Private account login is unavailable."
      );
    }
  });

  router.post("/logout", (req, res) => {
    revoke(req, res);
    res.json({ authenticated: false, login_configured: fingerprint !== null });
  });

  const servePrivate = (read?: () => Promise<BybitAccountSnapshot | BybitSpotPortfolio | AccountPerformance>) => async (req: Request, res: Response) => {
    const deny = () =>
      failure(
        res,
        401,
        "AUTH_REQUIRED",
        "Unlock the private Bybit account view."
      );
    if (!authenticated(req)) {
      deny();
      return;
    }
    if (!read) {
      failure(res, 503, "CONFIGURATION", "This private account view is not configured.");
      return;
    }
    try {
      const snapshot = await read();
      // Rotation/logout/expiry during an in-flight fetch must not release private data.
      refreshAuth();
      if (!authenticated(req)) {
        deny();
        return;
      }
      res.json(snapshot);
    } catch (error) {
      const code =
        error &&
        typeof error === "object" &&
        "code" in error &&
        typeof error.code === "string" &&
        Object.hasOwn(SAFE_CLIENT_ERRORS, error.code)
          ? error.code
          : "BYBIT_UNAVAILABLE";
      failure(res, 503, code, SAFE_CLIENT_ERRORS[code]);
    }
  };
  router.get("/account", servePrivate(options.getSnapshot));
  router.get("/portfolio", servePrivate(options.getPortfolio));
  router.get("/performance", servePrivate(options.getPerformance));

  router.use((_req, res) => {
    failure(
      res,
      404,
      "NOT_FOUND",
      "This private account endpoint does not exist."
    );
  });
  const errorHandler: ErrorRequestHandler = (_error, _req, res, _next) => {
    failure(res, 400, "INVALID_REQUEST", "The request could not be processed.");
  };
  router.use(errorHandler);
  // Single site login: every other data route uses this same owner session.
  const requireOwner: RequestHandler = (_req, res, next) => {
    refreshAuth();
    if (authenticated(_req)) {
      next();
      return;
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.vary("Cookie");
    failure(res, 401, "LOGIN_REQUIRED", "Sign in to view this dashboard.");
  };
  return Object.assign(router, { requireOwner });
}
