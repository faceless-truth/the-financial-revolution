import { createServer, type Server } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { scryptSync } from "node:crypto";
import path from "node:path";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBybitRouter } from "./bybitRoutes";
import type { BybitSpotPortfolio } from "../shared/bybitSpot";

let directory: string | undefined;
let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

async function fixture(getPortfolio = vi.fn().mockResolvedValue({ method: 'FIFO', orders: [{ side: 'Buy', first_fill_at: '2026-01-01T10:00:00Z' }] } as unknown as BybitSpotPortfolio)) {
  directory = await mkdtemp('/tmp/opencode/spot-portfolio-route-');
  const authFile = path.join(directory, 'owner.json');
  const password = 'synthetic-owner-test-password';
  const salt = Buffer.alloc(32, 23);
  await writeFile(authFile, JSON.stringify({ version: 1, kdf: 'scrypt', N: 16384, r: 8, p: 1, keylen: 64,
    salt: salt.toString('hex'), password_hash: scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64*1024*1024 }).toString('hex'),
    created_at: '2026-09-21T00:00:00Z' }), { mode: 0o600 });
  const getSnapshot = vi.fn();
  const app = express();
  app.use('/api/bybit', createBybitRouter({ getPortfolio, getSnapshot, ownerAuthFile: authFile,
    allowedOrigins: ['https://owner.example'], requireHttps: false }));
  server = createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test server address');
  const base = `http://127.0.0.1:${address.port}`;
  async function login() {
    const response = await fetch(base+'/api/bybit/login', { method: 'POST',
      headers: { Origin: 'https://owner.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    expect(response.status).toBe(200);
    return response.headers.get('set-cookie')!.split(';')[0];
  }
  return { base, login, getSnapshot, getPortfolio };
}

describe('Private actual spot performance route', () => {
  it('requires owner authorization before any history or account call', async () => {
    const f = await fixture();
    const response = await fetch(f.base+'/api/bybit/portfolio');
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(f.getPortfolio).not.toHaveBeenCalled();
    expect(f.getSnapshot).not.toHaveBeenCalled();
  });

  it('returns actual-portfolio contract, not the balance mirror, after login', async () => {
    const f = await fixture();
    const cookie = await f.login();
    const response = await fetch(f.base+'/api/bybit/portfolio', { headers: { Cookie: cookie } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ method: 'FIFO', orders: [{ side: 'Buy', first_fill_at: '2026-01-01T10:00:00Z' }] });
    expect(f.getPortfolio).toHaveBeenCalledTimes(1);
    expect(f.getSnapshot).not.toHaveBeenCalled();
  });

  it('does not release completed history after logout during import', async () => {
    let release!: (value: BybitSpotPortfolio) => void;
    let started!: () => void;
    const startedPromise = new Promise<void>(resolve => { started = resolve; });
    const reader = vi.fn().mockImplementation(() => { started(); return new Promise(resolve => { release = resolve; }); });
    const f = await fixture(reader);
    const cookie = await f.login();
    const responsePromise = fetch(f.base+'/api/bybit/portfolio', { headers: { Cookie: cookie } });
    await startedPromise;
    const logout = await fetch(f.base+'/api/bybit/logout', { method: 'POST', headers: { Cookie: cookie, Origin: 'https://owner.example' } });
    expect(logout.status).toBe(200);
    release({ method: 'FIFO', orders: [{ privateFixture: 'must not escape after logout' }] } as unknown as BybitSpotPortfolio);
    const response = await responsePromise;
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain('privateFixture');
  });
});
