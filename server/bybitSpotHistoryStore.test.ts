import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFileSpotHistoryStore } from "./bybitSpotHistory";

// Fully simulated filesystem: never creates directories, reads credentials, or
// touches the production archive. Assert syscall flags as well as behavior.
vi.mock("node:fs/promises", () => ({ lstat: vi.fn(), mkdir: vi.fn(), open: vi.fn(), rename: vi.fn(), unlink: vi.fn() }));
const ROOT = "/tmp/opencode/spot-store-tests";
const REF = "a".repeat(64);
const FILE = `${ROOT}/${REF}.json`;
const MARKER = `${ROOT}/${REF}.marker`;
const LOCK = `${ROOT}/${REF}.lock`;
const DEAD_PID = 543210;
const DEAD_NONCE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const deadLock = () => JSON.stringify({ pid: DEAD_PID, nonce: DEAD_NONCE });
type Entry = { type: "file" | "directory" | "symlink"; mode: number; text: string; uid: number; nlink: number; ino: number };
let entries: Map<string, Entry>;
let events: string[];
let nextInode = 1;
const entry = (type: Entry["type"], mode: number, text = ""): Entry => ({ type, mode, text, uid: process.getuid?.() ?? 0, nlink: 1, ino: nextInode++ });
const fsError = (code: string) => Object.assign(new Error("simulated filesystem error"), { code });
const stat = (e: Entry) => ({
  isDirectory: () => e.type === "directory", isSymbolicLink: () => e.type === "symlink", isFile: () => e.type === "file",
  mode: e.mode, uid: e.uid, nlink: e.nlink, size: Buffer.byteLength(e.text), mtimeMs: 1, ctimeMs: 1, dev: 1, ino: e.ino,
});
beforeEach(() => {
  vi.resetAllMocks(); entries = new Map(); events = [];
  // Never probe an actual process, even with signal 0.
  vi.spyOn(process, "kill").mockReturnValue(true);
  vi.mocked(mkdir).mockImplementation((async (path: string, options: { mode: number }) => {
    if (entries.has(path)) throw fsError("EEXIST");
    entries.set(path, entry("directory", options.mode)); events.push(`mkdir:${path}`);
  }) as never);
  vi.mocked(lstat).mockImplementation((async (path: string) => {
    const e = entries.get(path); if (!e) throw fsError("ENOENT"); return stat(e);
  }) as never);
  vi.mocked(open).mockImplementation((async (path: string, flags: number, mode: number) => {
    events.push(`open:${path}`);
    let e = entries.get(path);
    if (e && flags & constants.O_EXCL) throw fsError("EEXIST");
    if (e?.type === "symlink" && flags & constants.O_NOFOLLOW) throw fsError("ELOOP");
    if (!e) {
      if (!(flags & constants.O_CREAT)) throw fsError("ENOENT");
      e = entry("file", mode); entries.set(path, e);
    }
    const file = e;
    return {
      stat: async () => stat(file), readFile: async () => file.text,
      writeFile: async (value: string) => { file.text = value; events.push(`write:${path}`); },
      sync: async () => { events.push(`sync:${path}`); },
      close: async () => { events.push(`close:${path}`); },
    };
  }) as never);
  vi.mocked(rename).mockImplementation((async (from: string, to: string) => {
    const e = entries.get(from); if (!e) throw fsError("ENOENT");
    entries.set(to, e); entries.delete(from); events.push(`rename:${to}`);
  }) as never);
  vi.mocked(unlink).mockImplementation((async (path: string) => {
    if (!entries.delete(path)) throw fsError("ENOENT"); events.push(`unlink:${path}`);
  }) as never);
});
afterEach(() => vi.restoreAllMocks());
const initialize = async () => {
  const store = createFileSpotHistoryStore(ROOT);
  await store.withLock(REF, async io => { expect(await io.read()).toBeNull(); await io.write("archive-v1", () => undefined); });
  return store;
};

describe("private archive filesystem boundary", () => {
  it("is lazy and defaults exclusively to /var/lib private storage", async () => {
    const store = createFileSpotHistoryStore();
    expect(open).not.toHaveBeenCalled(); expect(mkdir).not.toHaveBeenCalled();
    await store.withLock(REF, async io => { await io.read(); await io.write("private-history", () => undefined); });
    expect(Array.from(entries.keys()).some(p => p.startsWith("/var/lib/crypto-dashboard-private/bybit-spot/"))).toBe(true);
    expect(Array.from(entries.keys()).some(p => /\/public\/|\/data\//.test(p))).toBe(false);
  });
  it("creates 0700 directories and 0600 regular files using no-follow exclusive opens", async () => {
    await initialize();
    expect(entries.get(ROOT)?.mode).toBe(0o700);
    expect(entries.get(FILE)?.mode).toBe(0o600); expect(entries.get(MARKER)?.mode).toBe(0o600);
    expect(entries.has(LOCK)).toBe(false);
    for (const [, flags] of vi.mocked(open).mock.calls) expect((flags as number) & constants.O_NOFOLLOW).not.toBe(0);
    for (const [, flags] of vi.mocked(open).mock.calls.filter(([, flags]) => (flags as number) & constants.O_CREAT)) {
      expect((flags as number) & constants.O_EXCL).not.toBe(0);
    }
  });
  it("fsyncs private data before atomic rename and fsyncs its directory afterwards", async () => {
    await initialize();
    const moved = events.indexOf(`rename:${FILE}`);
    const temporary = vi.mocked(rename).mock.calls[0][0] as string;
    expect(events.indexOf(`sync:${temporary}`)).toBeLessThan(moved);
    expect(events.slice(moved + 1)).toContain(`sync:${ROOT}`);
    expect(Array.from(entries.keys()).some(p => p.endsWith(".tmp"))).toBe(false);
  });
  it("reads and atomically replaces an existing archive under an exclusive process lock", async () => {
    const store = await initialize();
    await store.withLock(REF, async io => {
      expect(await io.read()).toBe("archive-v1");
      const lock = JSON.parse(entries.get(LOCK)!.text);
      expect(lock.pid).toBe(process.pid); expect(lock.nonce).toMatch(/^[a-f0-9-]{36}$/);
      await expect(store.withLock(REF, async () => undefined)).rejects.toThrow("unavailable");
      await io.write("archive-v2", () => undefined);
    });
    expect(entries.get(FILE)?.text).toBe("archive-v2");
  });
  it("recovers a verified dead PID lock without modifying or resetting the archive", async () => {
    const store = await initialize(); entries.set(LOCK, entry("file", 0o600, deadLock()));
    vi.mocked(process.kill).mockImplementation(() => { throw fsError("ESRCH"); });
    await store.withLock(REF, async io => {
      expect(await io.read()).toBe("archive-v1");
      expect(JSON.parse(entries.get(LOCK)!.text).nonce).not.toBe(DEAD_NONCE);
    });
    expect(process.kill).toHaveBeenCalledTimes(2);
    expect(process.kill).toHaveBeenNthCalledWith(1, DEAD_PID, 0);
    expect(process.kill).toHaveBeenNthCalledWith(2, DEAD_PID, 0);
    expect(entries.get(FILE)?.text).toBe("archive-v1"); expect(entries.get(MARKER)?.text).toBe(REF);
    expect(entries.has(LOCK)).toBe(false); expect(entries.has(`${LOCK}.recover`)).toBe(false);
    expect(rename).toHaveBeenCalledTimes(1);
    expect(unlink).not.toHaveBeenCalledWith(FILE); expect(unlink).not.toHaveBeenCalledWith(MARKER);
  });
  it.each(["alive", "EPERM", "EACCES", "unknown"])("never steals a lock when process status is %s", async status => {
    const store = await initialize(); entries.set(LOCK, entry("file", 0o600, deadLock()));
    vi.mocked(process.kill).mockImplementation(() => {
      if (status === "alive") return true;
      throw status === "unknown" ? new Error("unknown") : fsError(status);
    });
    await expect(store.withLock(REF, async () => undefined)).rejects.toThrow("unavailable");
    expect(entries.get(LOCK)?.text).toBe(deadLock()); expect(entries.has(`${LOCK}.recover`)).toBe(false);
  });
  it("does not steal a PID that became live/reused during recovery", async () => {
    const store = await initialize(); entries.set(LOCK, entry("file", 0o600, deadLock()));
    vi.mocked(process.kill).mockImplementationOnce(() => { throw fsError("ESRCH"); }).mockReturnValue(true);
    await expect(store.withLock(REF, async () => undefined)).rejects.toThrow("unavailable");
    expect(entries.get(LOCK)?.text).toBe(deadLock()); expect(entries.has(`${LOCK}.recover`)).toBe(false);
  });
  it.each(["nonce", "inode"])("rechecks %s after determining that the old PID is dead", async changed => {
    const store = await initialize(); entries.set(LOCK, entry("file", 0o600, deadLock()));
    vi.mocked(process.kill).mockImplementation(() => {
      if (changed === "nonce") entries.get(LOCK)!.text = JSON.stringify({ pid: DEAD_PID, nonce: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
      else entries.set(LOCK, entry("file", 0o600, deadLock()));
      throw fsError("ESRCH");
    });
    const calls = vi.mocked(unlink).mock.calls.length;
    await expect(store.withLock(REF, async () => undefined)).rejects.toThrow("unavailable");
    expect(entries.has(LOCK)).toBe(true); expect(entries.has(`${LOCK}.recover`)).toBe(false);
    expect(vi.mocked(unlink).mock.calls.slice(calls).some(([path]) => path === LOCK)).toBe(false);
  });
  it("rechecks the nonce once more after the final PID probe", async () => {
    const store = await initialize(); entries.set(LOCK, entry("file", 0o600, deadLock()));
    let probes = 0;
    vi.mocked(process.kill).mockImplementation(() => {
      if (++probes === 2) entries.get(LOCK)!.text = JSON.stringify({ pid: DEAD_PID, nonce: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
      throw fsError("ESRCH");
    });
    await expect(store.withLock(REF, async () => undefined)).rejects.toThrow("unavailable");
    expect(entries.get(LOCK)?.text).toContain("aaaaaaaa"); expect(entries.has(`${LOCK}.recover`)).toBe(false);
  });
  it.each([
    "{broken", JSON.stringify({ pid: DEAD_PID, nonce: "old-nonce" }),
    JSON.stringify({ pid: 0, nonce: DEAD_NONCE }), JSON.stringify({ pid: -1, nonce: DEAD_NONCE }),
    JSON.stringify({ pid: "543210", nonce: DEAD_NONCE }), JSON.stringify({ pid: 1.5, nonce: DEAD_NONCE }),
  ])("fails busy without probing a malformed lock %s", async value => {
    const store = await initialize(); entries.set(LOCK, entry("file", 0o600, value));
    await expect(store.withLock(REF, async () => undefined)).rejects.toThrow("unavailable");
    expect(entries.get(LOCK)?.text).toBe(value); expect(process.kill).not.toHaveBeenCalled();
  });
  it.each(["symlink", "directory", "permissions", "owner", "hardlink"])("does not recover an unsafe %s lock", async unsafe => {
    const store = await initialize(); const e = entry("file", 0o600, deadLock()); entries.set(LOCK, e);
    if (unsafe === "symlink" || unsafe === "directory") e.type = unsafe;
    if (unsafe === "permissions") e.mode = 0o644;
    if (unsafe === "owner") e.uid++;
    if (unsafe === "hardlink") e.nlink = 2;
    await expect(store.withLock(REF, async () => undefined)).rejects.toThrow("unavailable");
    expect(entries.has(LOCK)).toBe(true); expect(process.kill).not.toHaveBeenCalled();
  });
  it("serializes competing reapers so only one can remove the abandoned lock", async () => {
    const store = await initialize(); entries.set(LOCK, entry("file", 0o600, deadLock()));
    vi.mocked(process.kill).mockImplementation(() => { throw fsError("ESRCH"); });
    let entered!: () => void, release!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const resume = new Promise<void>(resolve => { release = resolve; });
    const originalOpen = vi.mocked(open).getMockImplementation()!;
    let paused = false;
    vi.mocked(open).mockImplementation((async (...args: Parameters<typeof open>) => {
      const result = await originalOpen(...args);
      if (args[0] === `${LOCK}.recover` && !paused) { paused = true; entered(); await resume; }
      return result;
    }) as typeof originalOpen);
    const first = store.withLock(REF, async io => expect(await io.read()).toBe("archive-v1"));
    await waiting;
    await expect(store.withLock(REF, async () => undefined)).rejects.toThrow("unavailable");
    expect(entries.get(LOCK)?.text).toBe(deadLock());
    release(); await first;
    expect(entries.get(FILE)?.text).toBe("archive-v1"); expect(entries.has(LOCK)).toBe(false);
  });
  it("never clobbers a new writer that wins acquisition after dead-lock removal", async () => {
    const store = await initialize(); entries.set(LOCK, entry("file", 0o600, deadLock()));
    vi.mocked(process.kill).mockImplementation(() => { throw fsError("ESRCH"); });
    const originalUnlink = vi.mocked(unlink).getMockImplementation()!;
    const replacement = JSON.stringify({ pid: process.pid, nonce: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    vi.mocked(unlink).mockImplementation(async path => {
      await originalUnlink(path);
      if (path === LOCK) entries.set(LOCK, entry("file", 0o600, replacement));
    });
    await expect(store.withLock(REF, async () => undefined)).rejects.toThrow("unavailable");
    expect(entries.get(LOCK)?.text).toBe(replacement); expect(entries.get(FILE)?.text).toBe("archive-v1");
  });
  it("fails busy on an existing recovery guard rather than recursively stealing a reaper's guard", async () => {
    const store = await initialize(); entries.set(LOCK, entry("file", 0o600, deadLock()));
    entries.set(`${LOCK}.recover`, entry("file", 0o600, deadLock()));
    vi.mocked(process.kill).mockImplementation(() => { throw fsError("ESRCH"); });
    await expect(store.withLock(REF, async () => undefined)).rejects.toThrow("unavailable");
    expect(entries.get(LOCK)?.text).toBe(deadLock()); expect(entries.has(`${LOCK}.recover`)).toBe(true);
  });
  it("does not remove a lock whose nonce no longer belongs to this writer", async () => {
    const store = await initialize();
    await store.withLock(REF, async () => { entries.get(LOCK)!.text = JSON.stringify({ pid: 111, nonce: "other-writer" }); });
    expect(entries.get(LOCK)?.text).toContain("other-writer");
  });
  it.each(["archive", "marker"])("lost %s fails closed rather than becoming a new empty account", async what => {
    const store = await initialize(); entries.delete(what === "archive" ? FILE : MARKER);
    await expect(store.withLock(REF, io => io.read())).rejects.toThrow("unavailable");
  });
  it("rejects another account's marker", async () => {
    const store = await initialize(); entries.get(MARKER)!.text = "b".repeat(64);
    await expect(store.withLock(REF, io => io.read())).rejects.toThrow("unavailable");
  });
  it.each([FILE, MARKER, ROOT, "/tmp/opencode"])("rejects symlink at %s", async path => {
    const store = await initialize(); entries.set(path, entry("symlink", 0o600, "elsewhere"));
    await expect(store.withLock(REF, io => io.read())).rejects.toThrow();
  });
  it.each([0o644, 0o666, 0o400, 0o777])("rejects archive permissions %s", async mode => {
    const store = await initialize(); entries.get(FILE)!.mode = mode;
    await expect(store.withLock(REF, io => io.read())).rejects.toThrow("unavailable");
  });
  it("rejects group-accessible private directories", async () => {
    const store = await initialize(); entries.get(ROOT)!.mode = 0o750;
    await expect(store.withLock(REF, io => io.read())).rejects.toThrow("unavailable");
  });
  it("rejects wrong owners and hard-linked archives", async () => {
    const store = await initialize(); entries.get(FILE)!.uid++;
    await expect(store.withLock(REF, io => io.read())).rejects.toThrow("unavailable");
    entries.get(FILE)!.uid--; entries.get(FILE)!.nlink = 2;
    await expect(store.withLock(REF, io => io.read())).rejects.toThrow("unavailable");
  });
  it("checks generation immediately before replacing the archive", async () => {
    const store = await initialize(); const originalRenames = vi.mocked(rename).mock.calls.length;
    let n = 0;
    await expect(store.withLock(REF, async io => {
      await io.read(); await io.write("must-not-commit", () => { if (++n === 2) throw new Error("invalidated"); });
    })).rejects.toThrow("invalidated");
    expect(entries.get(FILE)?.text).toBe("archive-v1");
    expect(rename).toHaveBeenCalledTimes(originalRenames);
    expect(Array.from(entries.keys()).some(p => p.endsWith(".tmp"))).toBe(false);
  });
  it.each(["/", "/root/website/client/public/bybit", "/root/website/data/bybit"])("forbids web/data destination %s", directory => {
    expect(() => createFileSpotHistoryStore(directory)).toThrow(); expect(mkdir).not.toHaveBeenCalled();
  });
  it.each(["../escape", "raw-user-id", "x".repeat(64)])("rejects unsafe namespace %s", async ref => {
    await expect(createFileSpotHistoryStore(ROOT).withLock(ref, async () => undefined)).rejects.toThrow();
    expect(mkdir).not.toHaveBeenCalled();
  });
});
