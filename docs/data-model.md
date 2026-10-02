# Data model and rules

## A project

One project is one record on the blockchain, stored under its `id`. Example after one payment:

```json
{
  "id": "PRJ-001",
  "owner": "Ahmed Ali",
  "contractor": "Al-Bina Co.",
  "agreedPrice": 250000,
  "currency": "SAR",
  "milestone": [
    { "description": "Dig and pour the foundation",    "startDate": "2026-10-01", "finishDate": "2026-10-20", "status": "done" },
    { "description": "Build the ground floor columns", "startDate": "2026-10-21", "finishDate": null,         "status": "proposed" }
  ],
  "payments": [
    { "id": "PAY-1", "amount": 50000, "date": "2026-10-03", "note": "First payment" }
  ]
}
```

| Field | Meaning |
|---|---|
| `id` | the project's identifier; also the key on the ledger |
| `owner` | the **client** |
| `contractor` | the company doing the work |
| `agreedPrice` | the price both sides agreed, whole SAR |
| `currency` | always `SAR` |
| `milestone` | the **list of tasks** (the work plan) |
| `payments` | money the **owner paid to the contractor** (starts empty) |

A task in `milestone` has only: `description` (what will be done), `startDate`, `finishDate` and **`status`** (where the task stands: `proposed`, `accepted`, `done`, `approved` or `rejected`, the same values as the Watad `task_status`). A payment has `id`, `amount`, `date`, `note`.

The API's answers add two **calculated** fields that are *not* stored on the chain: `totalPaid` (sum of the payments) and `remaining` (`agreedPrice − totalPaid`).

## Rules (enforced by the chaincode, so they hold no matter how the data is sent)

**Required:** `id`, `owner`, `contractor`, `agreedPrice`, and each task's `description`. Payments need `id`, `amount`, `date`.

**Money:** SAR with **at most 2 decimals**, exactly like the Watad columns `numeric(12,2)`: `250000`, `250000.5` and `99.99` are fine, `99.999` is not. `agreedPrice` and every payment `amount` must be greater than 0 and at most `9999999999.99`. All sums are exact (done in halalas, so `0.1 + 0.2` is exactly `0.3`).

**Dates:** real calendar dates written `YYYY-MM-DD` (so `2026-02-30` is rejected, and `2028-02-29` is accepted because 2028 is a leap year).
A task's `startDate` is `null` until the task starts and its `finishDate` is `null` until it is finished.
A task **cannot have a `finishDate` without a `startDate`**, and the `finishDate` cannot be **before** the `startDate`.

**Task status:** one of `proposed` (default), `accepted`, `done`, `approved`, `rejected`, the same as in Watad. In Watad the owner *accepts* or *rejects* a proposed task, the taker marks an accepted task *done*, and the owner then *approves* it (or sends it back to accepted).
**A task has a `finishDate` exactly when its status is `done` or `approved`** (as the check constraint in Watad), and a `finishDate` needs a `startDate` and cannot be before it.
The chain checks that the values are valid and consistent; the *order* of the status changes (who may move a task from where to where) is enforced by Watad's `set_task_status`, not by the chain.
Projects stored by earlier versions are read as: finish date set → `done`, old `clientApproved: true` → `accepted`, otherwise `proposed`.

**Payments:**
* they can only be **added** (`POST …/payments`); they can never be edited or deleted;
* each payment `id` is unique inside its project;
* the **total of all payments can never be more than `agreedPrice`**, and `agreedPrice` can never be lowered below what is already paid.

**Ids and text:** a project or payment `id` uses letters, digits, `.`, `_`, `-` (max 64 characters; a Watad uuid fits). A task `description` is up to **5000** characters (same as Watad); `owner`, `contractor` and the payment `note` are up to 500. Unknown fields are rejected, and a currency other than `SAR` is rejected.

**Create / update:**
* *Create* fails if the id already exists; a new project starts with **no payments** (sending payments is rejected).
* *Update* replaces owner, contractor, agreedPrice, currency and the whole task list. It cannot change the id or the payments, and it fails if the project does not exist.
* *Read*, *Update* and *Add payment* fail with "not found" if the project does not exist.

## Who may do what

| Operation | Platform user (`X-Org: platform`, the default) | AdminOrg user (`X-Org: admin`) |
|---|---|---|
| Create, update, add payment | yes | **no** (`403`) |
| Read, history, "exists" | yes | yes |

The chaincode checks the caller's organization (its MSP id: `PlatformMSP` or `AdminOrgMSP`); no other organization can even read.

**Every write needs both organizations.** The network's endorsement policy is `AND('PlatformMSP.peer','AdminOrgMSP.peer')`: the transaction is only accepted if the Platform peer **and** the AdminOrg peer both run and approve it.
That is why writes fail with `503` when one of the two peers is down, while reads of the *other* organization's side may still work.

## The chaincode (smart contract) `projectcc`

The REST API calls these functions for you; you only need this table if you talk to the chaincode directly (for example with the peer CLI inside `./pn shell`).

| Function | Arguments | Who |
|---|---|---|
| `CreateProject` | project JSON | Platform |
| `ReadProject` | project id | both |
| `UpdateProject` | project JSON (with `id`) | Platform |
| `AddPayment` | project id, payment JSON | Platform |
| `ProjectExists` | project id → `true`/`false` | both |
| `GetProjectHistory` | project id → list of versions, oldest first | both |

The code is **deterministic** (no clock and no random numbers inside the chaincode; history timestamps are converted from the transaction's own time), and values are saved as JSON with **sorted keys**,
so every peer produces the identical bytes. Source: `project-network/chaincode/projectcc/`; unit tests: `cd project-network/chaincode/projectcc && npm install && npm test` (Node.js 20+).

## History and "deleting"

Nothing is overwritten in a way you cannot see: every change creates a **new version** of the project, and `GET /projects/{id}/history` lists all of them with the transaction id and the time.
There is deliberately no delete operation. If a project was created by mistake, update it (for example fix the owner or tasks); the earlier version remains visible in the history.
