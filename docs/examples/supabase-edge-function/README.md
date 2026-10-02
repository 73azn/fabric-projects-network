# Supabase Edge Function template

A small relay between a Supabase project and the blockchain REST API. It only accepts calls that carry the project's **service role** key, and it can only do the six operations listed in `handler.ts`
(no free-form paths). The blockchain server's answer is passed through unchanged (same status and JSON).

| File | |
|---|---|
| `handler.ts` | the logic |
| `index.ts` | the entry point (`Deno.serve(handler)`) |
| `handler_test.ts` | unit tests with a fake blockchain server |

## Set it up

1. **Server side** (once): give the blockchain server a domain, an API key and HTTPS: [docs/operations.md](../../operations.md#making-it-reachable-from-the-internet-https--api-key). You end up with an address such as `https://chain.example.com` and an `API_KEY`.
2. **Secrets** (Supabase CLI, or Dashboard → Edge Functions → Secrets):

   ```bash
   supabase secrets set BLOCKCHAIN_API_URL=https://chain.example.com BLOCKCHAIN_API_KEY=<the API_KEY> --project-ref <project-ref>
   ```

3. **Deploy** (copy the three `.ts` files except the test into `supabase/functions/blockchain/`):

   ```bash
   supabase functions deploy blockchain --project-ref <project-ref>
   ```

## Call it (server side only)

From a database webhook, `pg_net`, or another function, with the **service role** key:

```bash
curl -s -X POST "https://<project-ref>.supabase.co/functions/v1/blockchain" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
  -d '{"action":"addPayment","id":"PRJ-001","data":{"id":"PAY-1","amount":50000.25,"date":"2026-10-03","note":"First payment"}}'
```

| `action` | needs | does |
|---|---|---|
| `createProject` | `data` | `POST /projects` |
| `getProject` | `id` | `GET /projects/{id}` |
| `updateProject` | `id`, `data` | `PUT /projects/{id}` |
| `addPayment` | `id`, `data` | `POST /projects/{id}/payments` |
| `getHistory` | `id` | `GET /projects/{id}/history` |
| `health` | – | `GET /health` |

`org` (`platform`, the default, or `admin`, which can only read) is optional. The request and response formats are those of the [API reference](../../api-reference.md).
**Never call this function from a browser or a mobile app and never ship the service role key there.** If end users must trigger a blockchain action, let your own server code decide whether they may, then call the function.

## Test

```bash
deno test --allow-env handler_test.ts
```
