# Connecting another system

Use this page when another application (a marketplace, an ERP, a mobile backend) keeps its own database and wants to **record projects, task agreements and payments on the blockchain**.
The blockchain does not replace that database: it is the tamper-evident record of what was agreed and paid. The REST API in [api-reference.md](api-reference.md) is the only thing to call.

## Mapping your data to a project

| Blockchain field | What to send |
|---|---|
| `id` | your project id. Letters, digits, `.` `_` `-`, up to 64 characters: a **uuid works as is** |
| `owner`, `contractor` | the display names (up to 500 characters). They are stored permanently: if people can ask to be forgotten, send ids instead of names |
| `agreedPrice` | the price both sides accepted, SAR with at most 2 decimals |
| `currency` | always `SAR` (the only currency) |
| `milestone[]` | the tasks: `description` (required, up to 5000), `startDate`, `finishDate`, `status` |
| `payments[]` | **only money that was actually paid** (see below) |

Task `status`: `proposed` (default), `accepted`, `done`, `approved`, `rejected`.
`finishDate` is set exactly when the status is `done` or `approved`, and it needs a `startDate`.
The chain checks that values are valid and consistent; **the order of status changes is your application's rule** (for example "only the owner may approve").

Dates are `YYYY-MM-DD`. If your database stores timestamps, convert them to the calendar day in the time zone that matters to you (for example Riyadh) before sending.

## When to call the API

| When, in your system | Call |
|---|---|
| the project is agreed (price and parties are final) | `POST /projects` with the id, names, price and the tasks |
| a task is added, accepted, finished, approved or rejected | `PUT /projects/{id}` with the **full** task list (it replaces the list) |
| a payment is confirmed as paid | `POST /projects/{id}/payments` with your payment id, the amount and the paid date |

Payments are **append-only**: they can never be edited or deleted, so do not send pending, failed or cancelled payments, and decide how you will record a refund (it cannot be a negative payment).
The total of the payments can never exceed the agreed price, and the price cannot be lowered below what is already paid.

## Making it safe to retry

* `POST /projects` returns `409 ALREADY_EXISTS` if the id exists: a retry after a timeout is safe, just treat 409 as "already recorded" (read it to compare if needed).
* `POST …/payments` returns `400` for a payment id that already exists in the project: use your own payment id so a retry cannot pay twice.
* `PUT` is idempotent: sending the same data again changes nothing important (it adds a new version with identical content).
* `503` / `409 CONFLICT`: wait a few seconds and retry; the API sends `Retry-After`.

## Who is calling

The API has **no authentication**; it is meant to be called by your own backend, on the same machine or private network (it listens on `127.0.0.1` by default).
Never call it from a browser or mobile app directly, and put an authenticating proxy in front of it if it must be reachable from elsewhere ([operations.md](operations.md#security)).
`X-Org: platform` (default) is the only identity that can write; `X-Org: admin` is read-only, useful for an auditor.

## Reading back

* `GET /projects/{id}` returns the project with calculated `totalPaid` and `remaining`.
* `GET /projects/{id}/history` returns every version with its transaction id and time, oldest first: keep the `txId` next to your own record if you want to prove later that a given state was written.

Ready-to-run examples in `curl`, PowerShell, Node.js and Python are in [examples/](examples).
