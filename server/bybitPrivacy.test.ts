import { createServer, request as httpRequest, type Server } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, chmod, rm } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBybitRouter } from "./bybitRoutes";

let directory: string | undefined;
let server: Server | undefined;
afterEach(async () => {
  await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve());
  server = undefined;
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("Bybit private-data deployment boundaries", () => {
  it("accepts the Python setup's scrypt format and blocks navigation/alternate paths before account calls", async () => {
    directory = await mkdtemp('/tmp/opencode/bybit-cross-language-');
    const auth = path.join(directory, 'owner.json');
    // A fake test password only; neither real private configuration is read.
    const password = 'fake-owner-test-é-password';
    const raw = execFileSync('python3', ['-c',
      "import importlib.util,json; s=importlib.util.spec_from_file_location('owner_setup','scripts/setup_bybit_owner.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(json.dumps(m.make_record('fake-owner-test-é-password')))"],
      { cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8' });
    await writeFile(auth, raw, { mode: 0o600 });
    await chmod(auth, 0o600);
    const getSnapshot = vi.fn().mockResolvedValue({ testFixture: true });
    const app = express();
    app.use('/api/bybit', createBybitRouter({ ownerAuthFile: auth, getSnapshot,
      requireHttps: false, allowedOrigins: ['https://owner.example'] }));
    server = createServer(app);
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture server address');
    const base = `http://127.0.0.1:${address.port}`;
    const login = await fetch(base+'/api/bybit/login', { method: 'POST',
      headers: { Origin: 'https://owner.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    // Raw HTTP preserves Fetch Metadata instead of Undici rewriting it to cors.
    const navigationStatus = await new Promise<number>(resolve => {
      const request = httpRequest(base+'/api/bybit/account', {
        headers: { Cookie: cookie, 'Sec-Fetch-Mode': 'navigate' },
      }, response => { response.resume(); response.on('end', () => resolve(response.statusCode!)); });
      request.on('error', () => resolve(0));
      request.end();
    });
    expect(navigationStatus).toBe(403);
    for (const alternate of ['/API/BYBIT/account', '/api/bybit/account/']) {
      const result = await fetch(base+alternate, { headers: { Cookie: cookie } });
      expect(result.status).toBe(404);
      expect(result.headers.get('cache-control')).toBe('private, no-store');
    }
    expect(getSnapshot).not.toHaveBeenCalled();
    const result = await fetch(base+'/api/bybit/account', { headers: { Cookie: cookie } });
    expect(result.status).toBe(200);
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    const source = await readFile(new URL('./bybitRoutes.ts', import.meta.url), 'utf8');
    expect(source).toContain('req.get("Sec-Fetch-Mode") === "navigate"');
  });

  it("never reads or writes an offline cache for private requests, including uppercase and encoded paths", async () => {
    const source = await readFile(new URL('../client/public/sw.js', import.meta.url), 'utf8');
    const handlers: Record<string, (event: any) => void> = {};
    const network = vi.fn().mockResolvedValue({ ok: true });
    const caches = { match: vi.fn(), open: vi.fn(), keys: vi.fn() };
    vm.runInNewContext(source, { URL, fetch: network, caches,
      self: { location: { origin: 'https://owner.example' }, addEventListener: (name: string, handler: any) => { handlers[name] = handler; } },
    });
    for (const suffix of ['/api/bybit/account', '/API/BYBIT/account', '/%61pi/bybit/account']) {
      let result: Promise<unknown> | undefined;
      const request = { method: 'GET', url: 'https://owner.example'+suffix, mode: 'cors' };
      handlers.fetch({ request, respondWith: (promise: Promise<unknown>) => { result = promise; } });
      await result;
      expect(network).toHaveBeenLastCalledWith(request, { cache: 'no-store' });
    }
    network.mockRejectedValueOnce(new Error('offline'));
    let offline: Promise<unknown> | undefined;
    handlers.fetch({ request: { method: 'GET', url: 'https://owner.example/api/bybit/account' },
      respondWith: (promise: Promise<unknown>) => { offline = promise; } });
    await expect(offline).rejects.toThrow('offline');
    expect(caches.match).not.toHaveBeenCalled();
    expect(caches.open).not.toHaveBeenCalled();
  });

  it("mounts private middleware before the public parser/static fallback and excludes production telemetry", async () => {
    const index = await readFile(new URL('./index.ts', import.meta.url), 'utf8');
    expect(index.indexOf('app.use("/api/bybit"')).toBeLessThan(index.indexOf('app.use(express.json())'));
    expect(index.indexOf('app.use("/api/bybit"')).toBeLessThan(index.indexOf('app.use(express.static'));
    expect(index).toContain('app.set("trust proxy", "loopback")');
    expect(index).toContain('"script-src \'self\'"');
    expect(index).not.toContain('if (process.env.NODE_ENV === "production")');
    const config = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');
    expect(config).toContain('command === "serve" && process.env.TFR_ENABLE_BROWSER_DIAGNOSTICS === "1"');
    const html = await readFile(new URL('../client/index.html', import.meta.url), 'utf8');
    expect(html).not.toContain('VITE_ANALYTICS');
    expect(html).not.toContain('/umami');
    const ui = await readFile(new URL('../client/src/components/BybitAccount.tsx', import.meta.url), 'utf8');
    expect(ui).not.toContain('localStorage');
    expect(ui).not.toContain('sessionStorage');
    expect(ui).not.toContain('BYBIT_API_SECRET');
    expect(ui).not.toContain('BYBIT_API_KEY');
  });
});
