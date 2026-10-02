# Changelog

The chaincode `projectcc` and the REST API change together. The chaincode version is set in
`project-network/network.config` (`CC_VERSION`); `./pn start` upgrades a running network to the version in that file and keeps all data.

## 1.3 — decimal amounts, task status

* **Amounts can have 2 decimals** (SAR, like a database `numeric(12,2)` column, up to 9,999,999,999.99), for `agreedPrice` and payment `amount`. All sums are exact: they are done in halalas, so `0.1 + 0.2` is exactly `0.3`.
* **Task `status` replaces `clientApproved`**: `proposed` (default), `accepted`, `done`, `approved`, `rejected`.
* **`finishDate` exists exactly when the status is `done` or `approved`**, and still needs a `startDate` and cannot be before it.
* **Task `description` is required and can be up to 5000 characters** (was 500).
* Records written by earlier versions are read correctly: a task with a finish date → `done`, with `clientApproved: true` → `accepted`, otherwise `proposed`.
* **Breaking:** requests that send `clientApproved` now get `400` (unknown field); use `status`. Whole-number amounts keep working.
* API: `totalPaid` and `remaining` are exact decimals; every task in every response has a `status`.

## 1.2 — client agreement flag

* Each task got `clientApproved` (`true`/`false`, default `false`). Replaced by `status` in 1.3.

## 1.1 — history order

* `GET /projects/{id}/history` returns the versions **oldest first** (the ledger returns them newest first).

## 1.0 — first version

* Projects with owner, contractor, `agreedPrice` (whole SAR), `milestone` tasks (`description`, `startDate`, `finishDate`) and append-only `payments`.
* Functions `CreateProject`, `ReadProject`, `UpdateProject`, `AddPayment`, `ProjectExists`, `GetProjectHistory`; only the Platform organization writes, both read, both must endorse every write.
* REST API (`POST /projects`, `GET/PUT /projects/{id}`, `POST /projects/{id}/payments`, `GET /projects/{id}/history`, `GET /health`), Docker-only launcher (`pn`), Prometheus/Grafana.
