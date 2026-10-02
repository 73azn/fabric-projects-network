// Unit tests with a fake blockchain server (no network needed):
//   deno test --allow-env handler_test.ts
import assert from 'node:assert/strict';
import { handler } from './handler.ts';

const SERVICE_KEY = 'service-role-key-for-tests';
const API_KEY = 'blockchain-api-key-for-tests-0123456789';

Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY);
Deno.env.set('BLOCKCHAIN_API_URL', 'https://chain.example.com/');
Deno.env.set('BLOCKCHAIN_API_KEY', API_KEY);

interface Seen { url: string; method: string; headers: Headers; body: unknown }
const realFetch = globalThis.fetch;

/** Replaces fetch for one test; `answer` plays the blockchain server. */
async function withUpstream(answer: (seen: Seen) => Response | Promise<Response>, fn: (seen: Seen[]) => Promise<void>) {
  const seen: Seen[] = [];
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const s: Seen = { url: String(input), method: init?.method ?? 'GET', headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    seen.push(s);
    return await answer(s);
  }) as typeof fetch;
  try { await fn(seen); } finally { globalThis.fetch = realFetch; }
}

const call = (body: unknown, token: string | null = SERVICE_KEY, method = 'POST') =>
  handler(new Request('https://project.functions.supabase.co/blockchain', {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  }));
const ok = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

Deno.test('only the service role may call it (anon key, user tokens, no token: 403) and only with POST', async () => {
  await withUpstream(() => ok({}), async (seen) => {
    for (const token of [null, 'anon-key', 'a-users-jwt', SERVICE_KEY + 'x', '']) {
      assert.equal((await call({ action: 'health' }, token)).status, 403, String(token));
    }
    assert.equal((await call({ action: 'health' }, SERVICE_KEY, 'GET')).status, 405);
    assert.equal(seen.length, 0, 'nothing may reach the blockchain server');
    assert.equal((await call({ action: 'health' })).status, 200);
  });
});

Deno.test('every action becomes exactly the right REST call, with the API key and X-Org', async () => {
  await withUpstream(() => ok({ ok: true }), async (seen) => {
    const project = { id: 'PRJ-1', owner: 'a', contractor: 'b', agreedPrice: 100.5 };
    await call({ action: 'health' });
    await call({ action: 'createProject', data: project });
    await call({ action: 'getProject', id: 'PRJ-1' });
    await call({ action: 'getProject', id: 'PRJ-1', org: 'admin' });
    await call({ action: 'updateProject', id: 'PRJ-1', data: project });
    await call({ action: 'addPayment', id: 'PRJ-1', data: { id: 'PAY-1', amount: 10.25, date: '2026-10-01' } });
    await call({ action: 'getHistory', id: 'PRJ-1' });

    assert.deepEqual(seen.map((s) => `${s.method} ${s.url}`), [
      'GET https://chain.example.com/health',
      'POST https://chain.example.com/projects',
      'GET https://chain.example.com/projects/PRJ-1',
      'GET https://chain.example.com/projects/PRJ-1',
      'PUT https://chain.example.com/projects/PRJ-1',
      'POST https://chain.example.com/projects/PRJ-1/payments',
      'GET https://chain.example.com/projects/PRJ-1/history',
    ]);
    assert.ok(seen.every((s) => s.headers.get('authorization') === `Bearer ${API_KEY}`));
    assert.deepEqual(seen.map((s) => s.headers.get('x-org')), ['platform', 'platform', 'platform', 'admin', 'platform', 'platform', 'platform']);
    assert.deepEqual(seen[1].body, project);
    assert.deepEqual(seen[5].body, { id: 'PAY-1', amount: 10.25, date: '2026-10-01' });
  });
});

Deno.test('bad requests are 400 and never reach the server (no free-form paths, no path tricks)', async () => {
  await withUpstream(() => ok({}), async (seen) => {
    const bad: unknown[] = [
      {}, { action: 'deleteProject', id: 'PRJ-1' }, { action: 'getProject' }, { action: 'getProject', id: '../health' },
      { action: 'getProject', id: 'a/b' }, { action: 'getProject', id: 'PRJ-1?x=1' }, { action: 'getProject', id: 'x'.repeat(65) },
      { action: 'getProject', id: 42 }, { action: 'createProject' }, { action: 'createProject', data: [] }, { action: 'createProject', data: 'x' },
      { action: 'updateProject', data: {} }, { action: 'updateProject', id: 'PRJ-1' }, { action: 'addPayment', id: 'PRJ-1' },
      { action: 'health', org: 'org3' }, [], 'text',
    ];
    for (const b of bad) assert.equal((await call(b)).status, 400, JSON.stringify(b));
    assert.equal((await handler(new Request('https://x/y', { method: 'POST', headers: { Authorization: `Bearer ${SERVICE_KEY}` }, body: '{not json' }))).status, 400);
    assert.equal(seen.length, 0);
  });
});

Deno.test('the answer of the blockchain server is passed through: status, JSON and Retry-After', async () => {
  const answers: Record<string, Response> = {
    a: ok({ error: 'project PRJ-1 already exists', code: 'ALREADY_EXISTS' }, 409),
    b: ok({ error: 'a required peer is not reachable', code: 'NETWORK_UNAVAILABLE' }, 503),
    c: ok({ error: 'a valid API key is required', code: 'UNAUTHORIZED' }, 401),
  };
  for (const [key, status] of [['a', 409], ['b', 503], ['c', 401]] as const) {
    await withUpstream(() => { const r = answers[key].clone(); return key === 'b' ? new Response(r.body, { status: 503, headers: { 'Retry-After': '5' } }) : r; }, async () => {
      const res = await call({ action: 'getProject', id: 'PRJ-1' });
      assert.equal(res.status, status);
      if (key === 'b') assert.equal(res.headers.get('Retry-After'), '5');
    });
  }
  await withUpstream(() => ok({ id: 'PRJ-1', totalPaid: 0.3 }, 201), async () => {
    const res = await call({ action: 'createProject', data: { id: 'PRJ-1' } });
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { id: 'PRJ-1', totalPaid: 0.3 });
  });
});

Deno.test('an unreachable or misbehaving server gives 502, a missing configuration gives 500', async () => {
  await withUpstream(() => { throw new TypeError('network down'); }, async () => {
    const res = await call({ action: 'health' });
    assert.equal(res.status, 502);
    assert.equal((await res.json()).code, 'UPSTREAM_UNAVAILABLE');
  });
  await withUpstream(() => new Response('<html>oops</html>', { status: 200 }), async () => {
    assert.equal((await call({ action: 'health' })).status, 502);
  });
  Deno.env.set('BLOCKCHAIN_API_KEY', '');
  try {
    assert.equal((await call({ action: 'health' })).status, 500);
  } finally {
    Deno.env.set('BLOCKCHAIN_API_KEY', API_KEY);
  }
});
