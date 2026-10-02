// Supabase Edge Function: a small, locked-down relay to the blockchain REST API.
//
// Secrets (set them with `supabase secrets set`, never put them in code or in the app):
//   BLOCKCHAIN_API_URL   the public address of the server, e.g. https://chain.example.com
//   BLOCKCHAIN_API_KEY   the API_KEY configured on the server (./pn key)
// SUPABASE_SERVICE_ROLE_KEY is provided to every function by Supabase.
//
// Who may call it: only server-side code that holds the project's SERVICE ROLE key (a database webhook, pg_net,
// another Edge Function). The anon key and users' tokens are rejected, so a browser or mobile app can never write
// to the blockchain through this function.
//
// What it can do: exactly the operations below, nothing else (no free-form paths, so it cannot be abused to reach
// other URLs). Request body:
//   { "action": "createProject" | "getProject" | "updateProject" | "addPayment" | "getHistory" | "health",
//     "id": "PRJ-001",              // all but createProject and health
//     "data": { ... },              // createProject, updateProject, addPayment: the JSON body of the REST call
//     "org": "platform" | "admin" } // optional, default platform (admin can only read)

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const TIMEOUT_MS = 25_000;

type Action = 'health' | 'getProject' | 'getHistory' | 'createProject' | 'updateProject' | 'addPayment';
interface Input { action?: Action; id?: string; data?: Record<string, unknown>; org?: string }
interface Route { method: 'GET' | 'POST' | 'PUT'; path: string; body?: Record<string, unknown> }

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

/** Compares two secrets without leaking how much of them matches (digests of equal length, no early exit). */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Turns the request into one of the fixed REST calls, or returns an error message. */
function buildRoute(input: Input): Route | string {
  const needId = (): string | null => (typeof input.id === 'string' && ID_PATTERN.test(input.id) ? encodeURIComponent(input.id) : null);
  const needData = (): Record<string, unknown> | null => (isPlainObject(input.data) ? input.data : null);

  switch (input.action) {
    case 'health':
      return { method: 'GET', path: '/health' };
    case 'getProject': {
      const id = needId();
      return id ? { method: 'GET', path: `/projects/${id}` } : '"id" is required (letters, digits, . _ -; max 64)';
    }
    case 'getHistory': {
      const id = needId();
      return id ? { method: 'GET', path: `/projects/${id}/history` } : '"id" is required (letters, digits, . _ -; max 64)';
    }
    case 'createProject': {
      const data = needData();
      return data ? { method: 'POST', path: '/projects', body: data } : '"data" (the project) is required';
    }
    case 'updateProject': {
      const id = needId();
      const data = needData();
      if (!id) return '"id" is required (letters, digits, . _ -; max 64)';
      return data ? { method: 'PUT', path: `/projects/${id}`, body: data } : '"data" (the project) is required';
    }
    case 'addPayment': {
      const id = needId();
      const data = needData();
      if (!id) return '"id" is required (letters, digits, . _ -; max 64)';
      return data ? { method: 'POST', path: `/projects/${id}/payments`, body: data } : '"data" (the payment) is required';
    }
    default:
      return 'unknown "action" (use createProject, getProject, updateProject, addPayment, getHistory or health)';
  }
}

export async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'use POST' }, 405);

  // 1. only the service role may call this function
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.get('Authorization') ?? '')?.[1] ?? '';
  if (!serviceKey || !bearer || !(await sameSecret(bearer, serviceKey))) return json({ error: 'forbidden' }, 403);

  // 2. configuration
  const baseUrl = (Deno.env.get('BLOCKCHAIN_API_URL') ?? '').replace(/\/+$/, '');
  const apiKey = Deno.env.get('BLOCKCHAIN_API_KEY') ?? '';
  if (!baseUrl || !apiKey) return json({ error: 'not configured: set BLOCKCHAIN_API_URL and BLOCKCHAIN_API_KEY' }, 500);

  // 3. the request
  let input: Input;
  try {
    input = await req.json();
  } catch {
    return json({ error: 'the body must be JSON' }, 400);
  }
  if (!isPlainObject(input)) return json({ error: 'the body must be a JSON object' }, 400);
  const org = input.org === undefined ? 'platform' : input.org;
  if (org !== 'platform' && org !== 'admin') return json({ error: '"org" must be platform or admin' }, 400);
  const route = buildRoute(input);
  if (typeof route === 'string') return json({ error: route }, 400);

  // 4. call the blockchain API and pass its answer through (same status, same JSON)
  let upstream: Response;
  try {
    upstream = await fetch(baseUrl + route.path, {
      method: route.method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-Org': org,
        ...(route.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: route.body ? JSON.stringify(route.body) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return json({ error: 'the blockchain server is not reachable', code: 'UPSTREAM_UNAVAILABLE' }, 502);
  }

  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    return json({ error: 'unexpected answer from the blockchain server', code: 'UPSTREAM_ERROR' }, 502);
  }
  const retryAfter = upstream.headers.get('Retry-After');
  return json(payload, upstream.status, retryAfter ? { 'Retry-After': retryAfter } : {});
}
