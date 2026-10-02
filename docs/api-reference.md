# API reference

Base URL: **`http://localhost:4000`** · JSON in, JSON out · machine-readable version: [openapi.yaml](openapi.yaml).

| Operation | Method and path | Who | Success |
|---|---|---|---|
| **Create** a project | `POST /projects` | Platform | `201` |
| **Read** a project (+ totals) | `GET /projects/{id}` | both | `200` |
| **Update** a project | `PUT /projects/{id}` | Platform | `200` |
| **Add a payment** | `POST /projects/{id}/payments` | Platform | `201` |
| **History** (all versions) | `GET /projects/{id}/history` | both | `200` |
| **Health** | `GET /health` | anyone | `200` / `503` |

There is **no delete**: that is by design. Projects stay on the ledger, and payments can never be edited or deleted. To see what changed over time, use the history.

## Conventions

* **Who is calling** — header `X-Org: platform` (default) or `X-Org: admin`. `platform` can read and write; `admin` (the AdminOrg user) can only read: a write returns `403`.
  Whether a key is needed depends on the server: see [Authentication](#authentication).
* **Money** — SAR with **at most 2 decimals** (like a database `numeric(12,2)` column), for example `250000`, `250000.75`, `99.99`; at most `9999999999.99`. Totals are exact. **Dates** — `YYYY-MM-DD`.
* **Content type** — send `Content-Type: application/json` with a body.
* **Writes take about a second or two**: both organizations must approve and the block has to be committed before the answer comes back.
* The examples below use `curl` (macOS, Linux, WSL, Git Bash). Set these once:

  ```bash
  B=http://localhost:4000
  J='Content-Type: application/json'
  ```

  Windows PowerShell versions are shown for each call (use `Invoke-RestMethod`, not the `curl` alias).


## Authentication

* **On your own computer** the API listens on `127.0.0.1` and, unless you set a key, needs none: the examples below work as written.
* **When the server has an `API_KEY`** (always the case when it is reachable from the internet) send it in every request, except `GET /livez`:

  ```bash
  curl -s -H "Authorization: Bearer $API_KEY" $B/projects/PRJ-001
  ```

  A missing, wrong or differently formatted key (for example a header named `X-API-Key`) gets `401` with `{"error": "...", "code": "UNAUTHORIZED"}` and a `WWW-Authenticate: Bearer` header.
  In PowerShell: `Invoke-RestMethod -Headers @{ Authorization = "Bearer $env:API_KEY" } "$B/projects/PRJ-001"`. Server setup: [operations.md](operations.md#making-it-reachable-from-the-internet-https--api-key).
* `GET /livez` is always public and returns `{"status":"ok"}` (the server is up); it tells nothing about the network. Use `GET /health` (needs the key) for the detailed check.

---

## Create a project

`POST /projects`

| Field | Required | Rules |
|---|---|---|
| `id` | yes | letters, digits, `.` `_` `-`, up to 64 characters, e.g. `PRJ-001` |
| `owner` | yes | the client, text up to 500 characters |
| `contractor` | yes | text up to 500 characters |
| `agreedPrice` | yes | SAR, greater than 0, at most 2 decimals (up to 9,999,999,999.99) |
| `currency` | no | only `SAR` (the default) |
| `milestone` | no | list of tasks (default: empty) |
| `payments` | no | must be absent or `[]`: payments are added only with *Add a payment* |

Each task in `milestone`:

| Field | Required | Rules |
|---|---|---|
| `description` | yes | what will be done, 1 to **5000** characters |
| `startDate` | no | `YYYY-MM-DD`, or `null` until the task starts |
| `finishDate` | no | `YYYY-MM-DD`, or `null` until it is finished. Needs a `startDate`, and cannot be before it |
| `status` | no | where the task stands: `proposed` (default), `accepted`, `done`, `approved`, `rejected` |

The **finish date exists exactly when the status is `done` or `approved`** (so `finishDate` is `null` for `proposed`, `accepted` and `rejected`), and it needs a `startDate` and cannot be before it.
Unknown fields are rejected.

```bash
curl -s -X POST $B/projects -H "$J" -d '{
  "id": "PRJ-001",
  "owner": "Ahmed Ali",
  "contractor": "Al-Bina Co.",
  "agreedPrice": 250000.75,
  "currency": "SAR",
  "milestone": [
    { "description": "Dig and pour the foundation",    "startDate": "2026-10-01", "finishDate": "2026-10-20", "status": "done" },
    { "description": "Build the ground floor columns", "startDate": "2026-10-21", "finishDate": null,         "status": "proposed" }
  ]
}'
```

PowerShell:

```powershell
$B = 'http://localhost:4000'
Invoke-RestMethod -Method Post -Uri "$B/projects" -ContentType 'application/json' -Body '{"id":"PRJ-001","owner":"Ahmed Ali","contractor":"Al-Bina Co.","agreedPrice":250000.75,"milestone":[{"description":"Dig and pour the foundation","startDate":"2026-10-01","finishDate":"2026-10-20"}]}'
```

**`201 Created`** — the project, with no payments yet:

```json
{
  "id": "PRJ-001", "owner": "Ahmed Ali", "contractor": "Al-Bina Co.",
  "agreedPrice": 250000.75, "currency": "SAR",
  "milestone": [
    { "description": "Dig and pour the foundation",    "startDate": "2026-10-01", "finishDate": "2026-10-20", "status": "done" },
    { "description": "Build the ground floor columns", "startDate": "2026-10-21", "finishDate": null,         "status": "proposed" }
  ],
  "payments": [],
  "totalPaid": 0,
  "remaining": 250000.75
}
```

Errors: `400` invalid input · `403` not allowed (`X-Org: admin`) · `409` the id already exists.

---

## Read a project

`GET /projects/{id}`

```bash
curl -s $B/projects/PRJ-001
```

```powershell
Invoke-RestMethod "$B/projects/PRJ-001"
```

**`200 OK`** — the same shape as above. `totalPaid` and `remaining` are **calculated** from the payments each time; they are not stored on the blockchain.

Errors: `404` no such project.

---

## Update a project

`PUT /projects/{id}`

Replaces `owner`, `contractor`, `agreedPrice`, `currency` and the **whole** `milestone` list. Send the complete new data, as in *Create* (without `id`, or with the same id as in the URL).

* **A missing `milestone` becomes an empty list**, so always send the full task list you want to keep.
* **To change a task's status** (for example the client accepts it, or it is done), update the project and send the full task list again with the new `status` (and, for `done`/`approved`, the `finishDate`). A task you send without `status` becomes `proposed`, so repeat the status of the tasks that must keep theirs.
* The **id** and the **payments cannot be changed** here. You may send `payments` back unchanged; anything else is rejected with `400`.
* `agreedPrice` cannot be set below what has already been paid.
* `totalPaid` and `remaining` are ignored if you send them back (handy when you edit a project you just read).

```bash
curl -s -X PUT $B/projects/PRJ-001 -H "$J" -d '{
  "owner": "Ahmed Ali",
  "contractor": "Al-Bina Co.",
  "agreedPrice": 300000.75,
  "currency": "SAR",
  "milestone": [
    { "description": "Dig and pour the foundation",    "startDate": "2026-10-01", "finishDate": "2026-10-20", "status": "done" },
    { "description": "Build the ground floor columns", "startDate": "2026-10-21", "finishDate": "2026-11-15", "status": "done" },
    { "description": "Roof slab", "startDate": null, "finishDate": null, "status": "proposed" }
  ]
}'
```

```powershell
Invoke-RestMethod -Method Put -Uri "$B/projects/PRJ-001" -ContentType 'application/json' -Body '{"owner":"Ahmed Ali","contractor":"Al-Bina Co.","agreedPrice":300000.75,"milestone":[{"description":"Roof slab","startDate":null,"finishDate":null}]}'
```

**`200 OK`** — the updated project. Errors: `400` · `403` · `404`.

---

## Add a payment

`POST /projects/{id}/payments`

A payment is money the owner paid to the contractor.

| Field | Required | Rules |
|---|---|---|
| `id` | yes | unique inside the project, e.g. `PAY-1` |
| `amount` | yes | SAR, greater than 0, at most 2 decimals (e.g. `100.10`) |
| `date` | yes | `YYYY-MM-DD` |
| `note` | no | text |

The **total of all payments can never be more than `agreedPrice`** (paying exactly the agreed price is allowed).

```bash
curl -s -X POST $B/projects/PRJ-001/payments -H "$J" \
  -d '{"id":"PAY-1","amount":50000.25,"date":"2026-10-03","note":"First payment"}'
```

```powershell
Invoke-RestMethod -Method Post -Uri "$B/projects/PRJ-001/payments" -ContentType 'application/json' -Body '{"id":"PAY-1","amount":50000.25,"date":"2026-10-03","note":"First payment"}'
```

**`201 Created`**

```json
{
  "payment": { "id": "PAY-1", "amount": 50000.25, "date": "2026-10-03", "note": "First payment" },
  "project": { "id": "PRJ-001", "...": "...", "payments": [ { "id": "PAY-1", "...": "..." } ], "totalPaid": 50000.25, "remaining": 250000.5 }
}
```

Errors: `400` (bad amount or date, duplicate payment id, or it would exceed the agreed price) · `403` · `404`.

---

## History

`GET /projects/{id}/history`

Every version of the project ever stored on the ledger, **oldest first**: the creation, each payment, each update.

```bash
curl -s $B/projects/PRJ-001/history
```

```powershell
Invoke-RestMethod "$B/projects/PRJ-001/history"
```

**`200 OK`**

```json
[
  { "txId": "884bae89d573…", "timestamp": "2026-09-30T17:29:23.299Z", "isDelete": false,
    "value": { "id": "PRJ-001", "agreedPrice": 250000.75, "payments": [], "...": "..." } },
  { "txId": "d59d08e96ff1…", "timestamp": "2026-09-30T17:29:25.386Z", "isDelete": false,
    "value": { "id": "PRJ-001", "agreedPrice": 250000.75, "payments": [ { "id": "PAY-1", "...": "..." } ], "...": "..." } }
]
```

`txId` is the blockchain transaction id; `timestamp` is when the transaction was recorded (UTC). Errors: `404`.

---

## Health

`GET /health`

Checks the orderer and both peers (through their `/healthz`), and the block height of each peer on `projects-channel`.

```bash
curl -s -i $B/health
```

**`200`** when everything is fine, **`503`** otherwise, with the reasons:

```json
{
  "status": "healthy",
  "reasons": [],
  "timestamp": "2026-09-30T17:29:13.567Z",
  "nodes": {
    "orderer":        { "status": "up", "url": "http://orderer.example.com:9443/healthz" },
    "peer0.platform": { "status": "up", "url": "http://peer0.platform.example.com:9444/healthz" },
    "peer0.adminorg": { "status": "up", "url": "http://peer0.adminorg.example.com:9445/healthz" }
  },
  "channel": {
    "name": "projects-channel",
    "peers": { "peer0.platform": { "height": 6 }, "peer0.adminorg": { "height": 6 } },
    "inSync": true,
    "heightGap": 0
  }
}
```

When a node is stopped: HTTP `503`, `"status": "unhealthy"`, and `reasons` such as `"peer0.adminorg is down (ENOTFOUND)"` with that peer's `height` as `null`.
A 1-block difference between the peers is normal for a few seconds after a write; it only counts as unhealthy if it lasts more than 10 seconds (setting `SYNC_GRACE_SECONDS`).

---

## Errors

Every error has the same shape: `{ "error": "<what is wrong>", "code": "<CODE>" }`.

| HTTP | `code` | Meaning | Example |
|---|---|---|---|
| 400 | `INVALID_INPUT` | The data is wrong | `payment of 999999 would make the total paid (1049999.25) exceed the agreed price (300000.75)` |
| 401 | `UNAUTHORIZED` | The server requires an API key and it is missing or wrong | send `Authorization: Bearer <key>` |
| 403 | `FORBIDDEN` | This organization may not do that | `organization AdminOrgMSP is not allowed to create projects` |
| 404 | `NOT_FOUND` | No such project (or route) | `project NOPE does not exist` |
| 409 | `ALREADY_EXISTS` | The id is taken | `project PRJ-001 already exists` |
| 409 | `CONFLICT` | Someone changed the same project at the same moment | retry the request |
| 503 | `NETWORK_UNAVAILABLE` | A peer or the orderer is not reachable; header `Retry-After: 5` | wait a few seconds and retry |
| 500 | `INTERNAL_ERROR` | Unexpected | look at `docker logs projects-api` |

Typical `400` messages: `"agreedPrice" must be greater than 0` · `finishDate (…) cannot be before startDate (…)` · `a task cannot have a finishDate without a startDate` ·
`payment id PAY-1 already exists in project PRJ-001` · `payments cannot be changed with UpdateProject; use AddPayment` ·
`agreedPrice (100) cannot be less than the total already paid (50000.25)` · `"status" must be one of proposed, accepted, done, approved, rejected` · `status "done" needs a finishDate` · `finishDate can only be set when the status is done or approved` · `"amount" must have at most 2 decimals` · `"date" … must be a real date in YYYY-MM-DD format` (for example `2026-02-30` is rejected).

> **After restarting a peer**, a *write* can return `503` for up to about half a minute until the peers see each other again. Just retry.

---

## From other languages

Ready-to-run clients (no dependencies):

* **Node.js 18+** — [examples/client.js](examples/client.js): `new ProjectsClient().createProject({...})`, `.getProject(id)`, `.updateProject(id, {...})`, `.addPayment(id, {...})`, `.getHistory(id)`; errors carry `status` and `code`.
* **Python 3.8+** — [examples/client.py](examples/client.py): the same methods in `snake_case`; errors are `ApiError` with `status` and `code`.
* **curl / bash** — [examples/crud-demo.sh](examples/crud-demo.sh) · **PowerShell** — [examples/crud-demo.ps1](examples/crud-demo.ps1)
* **Postman / Insomnia / Swagger UI** — import [openapi.yaml](openapi.yaml).
