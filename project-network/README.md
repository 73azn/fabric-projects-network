# Projects network

A Hyperledger Fabric **3.1.5** network that tracks projects between an **owner** (the client) and a **contractor**:
the work plan, the agreed price and the payments.

> **User documentation is in [`../docs`](../docs/README.md)** (getting started, API reference, data model, operations, troubleshooting). This file has the developer notes.

```
 curl / your app ──► REST API (container "projects-api": Node.js + Express + fabric-gateway, :4000)
                         │  X-Org: platform | admin   (picks whose user signs the request)
                         ▼
        ┌──────────────────────────────────────────────┐   channel: projects-channel
        │ peer0.platform.example.com   (PlatformMSP)   │   chaincode: projectcc (JavaScript)
        │ peer0.adminorg.example.com   (AdminOrgMSP)   │   endorsement: BOTH orgs on every write
        │ orderer.example.com          (OrdererMSP, Raft, 1 node)                               │
        └──────────────────────────────────────────────┘
```

| | Platform | AdminOrg | Orderer |
|---|---|---|---|
| MSP ID | `PlatformMSP` | `AdminOrgMSP` | `OrdererMSP` |
| Domain | `platform.example.com` | `adminorg.example.com` | `example.com` |
| Node | `peer0.platform.example.com` | `peer0.adminorg.example.com` | `orderer.example.com` |
| Peer / orderer port | 7051 | 9051 | 7050 (admin 7053) |
| Operations (`/healthz`, `/metrics`) | 9444 | 9445 | 9443 |
| Can do | create, update, add payments, read | read | – |

**Everything runs in Docker. The only thing you need is Docker.** You start it with the launcher in the repository root:

| Where | Command (from the repository root) |
|---|---|
| macOS, Linux, WSL2, Git Bash | `./pn start` |
| Windows PowerShell | `.\pn.ps1 start` |
| Windows cmd.exe | `pn.cmd start` |

The examples below use `./pn`; on Windows replace it with `.\pn.ps1` or `pn.cmd`. The `curl` examples work in a Linux/macOS/WSL shell or Git Bash;
in PowerShell use `curl.exe` (not the `curl` alias) with the JSON in single quotes, or `Invoke-RestMethod`.

## 1. Requirements and how it is packaged

* **Docker**: Docker Desktop (macOS, Windows with the WSL2 backend and *Linux containers*) or Docker Engine 26+ (Linux). Nothing else: no Bash, `jq`, Node.js or Fabric binaries on the host.
* The Fabric tarball **`hyperledger-fabric-linux-amd64-3.1.5.tar.gz`** in the repository root (not committed, it is 125 MB), **or** run `./pn start --download-fabric` once to fetch the official release (checked against a pinned SHA-256). Nothing else about Fabric is downloaded except the Docker images below.

How it works: `pn` builds a small **orchestrator** image ([`../orchestrator`](../orchestrator): Docker CLI + Compose + Bash + `jq`) and runs it with the host's Docker socket.
The orchestrator runs the Bash scripts of this folder and starts the other containers next to itself. Your repository is copied into a Docker volume (`fabricprojects_workspace`)
that also holds everything generated (certificates, channel artifacts, packaged chaincode); every container mounts only its own sub-folder of that volume.
So no host paths, line endings or file permissions are involved, which is what makes it behave the same on Windows, macOS and Linux. The orchestrator re-copies your sources on every `./pn` call, so edits you make in the repository are picked up.

The first `./pn start` pulls `hyperledger/fabric-peer:3.1.5`, `hyperledger/fabric-orderer:3.1.5`, `hyperledger/fabric-nodeenv:2.5`
(the Node.js chaincode runtime; Fabric publishes no 3.1 tag of it), `docker:29-cli`, `node:24-alpine` and `debian:bookworm-slim`, and builds `fabric-tools-local:3.1.5` from your tarball.

**How the Fabric CLI tools run.** The tarball only contains Linux/amd64 binaries. `../bin/peer`, `../bin/configtxgen`, `../bin/cryptogen`, … are small wrappers
([`../bin/fabric-docker-run`](../bin/fabric-docker-run)) that run the real tool inside `fabric-tools-local:3.1.5`, joined to the Fabric Docker network
(Apple Silicon and Windows-on-ARM run the amd64 tools through Docker's emulation).

## 2. Start and stop

```bash
./pn start                  # network + channel + chaincode + REST API, everything in Docker  (http://localhost:4000)
./pn start --monitoring     # the same, plus Prometheus + Grafana
./pn start --no-api         # network + channel + chaincode only
./pn start --download-fabric   # also download the Fabric 3.1.5 tarball if it is not in the repository folder

./pn status                 # containers, channel height of both peers, committed chaincode
./pn logs [container]       # follow logs (default projects-api; e.g. orderer.example.com)
./pn monitoring [--down]    # Prometheus + Grafana on/off
./pn shell                  # a shell inside the orchestrator (peer CLI as an org admin: . ./setOrgEnv.sh platform)

./pn stop                   # stops API, monitoring, peers, orderer. Ledgers + certificates are KEPT
./pn stop --clean           # ALSO deletes ledgers, certificates, channel artifacts (asks first; add --yes to skip the question)
```

`start` is safe to run again: it generates certificates only the first time, skips a channel / chaincode that already exists, and after `stop` it brings
the same network back **with all data**. Changing `CC_VERSION` in [`network.config`](network.config) and running `./pn start` upgrades the chaincode (new sequence, data is kept).
Individual steps: `./pn net up | createChannel | deployCC | status | down` (see `./pn net -h`).

Where the data lives: the Docker volumes `fabricprojects_*` (ledgers, the workspace with the certificates) — nothing is written into the repository folder.
`PN_PROJECT` (default `fabricprojects`) changes the name prefix if you want a second, separate copy.

## 3. Chaincode `projectcc`

One asset per project, stored under its `id` (example after one payment):

```json
{
  "id": "PRJ-001", "owner": "Ahmed Ali", "contractor": "Al-Bina Co.",
  "agreedPrice": 250000, "currency": "SAR",
  "milestone": [
    { "description": "Dig and pour the foundation",     "startDate": "2026-10-01", "finishDate": "2026-10-20", "clientApproved": true },
    { "description": "Build the ground floor columns",  "startDate": "2026-10-21", "finishDate": null,         "clientApproved": false }
  ],
  "payments": [ { "id": "PAY-1", "amount": 50000, "date": "2026-10-03", "note": "First payment" } ]
}
```

| Function | Who | What |
|---|---|---|
| `CreateProject(projectJson)` | Platform | New project, starts with no payments. Fails if the id exists. |
| `ReadProject(id)` | both | Fails if missing. |
| `UpdateProject(projectJson)` | Platform | Replaces owner / contractor / agreedPrice / currency / milestone. Cannot change the id or the payments (payments may be sent back unchanged, anything else is rejected). `agreedPrice` can't go below what is already paid. Fails if missing. |
| `AddPayment(id, paymentJson)` | Platform | Append-only: payments can never be edited or deleted. Fails if the project is missing. |
| `ProjectExists(id)` | both | `true` / `false`. |
| `GetProjectHistory(id)` | both | Every version on the ledger, oldest first: `[{txId, timestamp, isDelete, value}]`. |

Validation (all errors start with a code: `INVALID_INPUT`, `NOT_FOUND`, `ALREADY_EXISTS`, `FORBIDDEN`):
required `id`, `owner`, `contractor`, `agreedPrice`, task `description`; `id` = letters/digits/`.`/`_`/`-` (max 64); money = whole numbers in SAR (no decimals), `agreedPrice > 0`, payment `amount > 0`;
dates must be real `YYYY-MM-DD` dates (`null` allowed for task dates; a task can't have `finishDate` without `startDate`, nor finish before start); payment ids unique per project;
**total payments can never exceed `agreedPrice`** (also when `agreedPrice` is updated); unknown fields are rejected.
The caller's MSP ID decides who may write. The code is deterministic: no `Date`, `Date.now()` or random values (timestamps in the history are converted by hand from the transaction time); values are saved as JSON with sorted keys.

Unit tests (no network needed, Node.js 20+ on the host): `cd chaincode/projectcc && npm install && npm test`.

## 4. REST API

Base URL `http://localhost:4000`. JSON in, JSON out. Header **`X-Org: platform`** (default) or **`X-Org: admin`** selects the organization whose user (`User1`) signs the request.
`totalPaid` and `remaining` are calculated in the API from the payments; they are not stored on the chain.

| Method & path | Does | Success |
|---|---|---|
| `GET /projects/:id` | read + `totalPaid`, `remaining` | 200 |
| `POST /projects` | create (id in the body) | 201 |
| `PUT /projects/:id` | update (payments can't be changed) | 200 |
| `POST /projects/:id/payments` | add a payment | 201 |
| `GET /projects/:id/history` | all past versions | 200 |
| `GET /health` | see section 5 | 200 / 503 |

Errors: `400` bad input · `403` not allowed · `404` not found · `409` already exists · `503` network/peer unreachable (with `Retry-After`), body `{"error": "...", "code": "..."}`.

```bash
B=http://localhost:4000
J='Content-Type: application/json'

# Create (Platform)                                                          -> 201
curl -s -X POST $B/projects -H "$J" -d '{
  "id": "PRJ-001", "owner": "Ahmed Ali", "contractor": "Al-Bina Co.", "agreedPrice": 250000, "currency": "SAR",
  "milestone": [
    {"description": "Dig and pour the foundation",    "startDate": "2026-10-01", "finishDate": "2026-10-20"},
    {"description": "Build the ground floor columns", "startDate": "2026-10-21", "finishDate": null}
  ]}'

# Read (+ totalPaid and remaining)                                          -> 200
curl -s $B/projects/PRJ-001

# Read as the AdminOrg user                                                 -> 200
curl -s -H 'X-Org: admin' $B/projects/PRJ-001

# Add a payment                                                              -> 201
curl -s -X POST $B/projects/PRJ-001/payments -H "$J" \
  -d '{"id": "PAY-1", "amount": 50000, "date": "2026-10-03", "note": "First payment"}'

# Update (replaces the data; payments untouched)                            -> 200
curl -s -X PUT $B/projects/PRJ-001 -H "$J" -d '{
  "owner": "Ahmed Ali", "contractor": "Al-Bina Co.", "agreedPrice": 300000, "currency": "SAR",
  "milestone": [
    {"description": "Dig and pour the foundation",    "startDate": "2026-10-01", "finishDate": "2026-10-20"},
    {"description": "Build the ground floor columns", "startDate": "2026-10-21", "finishDate": "2026-11-15"},
    {"description": "Roof slab", "startDate": null, "finishDate": null}
  ]}'

# History (every version on the ledger, oldest first)                       -> 200
curl -s $B/projects/PRJ-001/history | jq .

# Health                                                                     -> 200 or 503
curl -s -i $B/health
```

Error cases (all verified):

```bash
curl -s -X POST $B/projects -H "$J" -d '{"id":"PRJ-001","owner":"x","contractor":"y","agreedPrice":1}'       # 409 ALREADY_EXISTS
curl -s -X POST $B/projects/PRJ-001/payments -H "$J" -d '{"id":"PAY-9","amount":999999,"date":"2026-10-10"}'   # 400 total would exceed the agreed price
curl -s -X POST $B/projects/PRJ-001/payments -H "$J" -d '{"id":"PAY-1","amount":1,"date":"2026-10-10"}'        # 400 duplicate payment id
curl -s $B/projects/NOPE                                                                                        # 404
curl -s -X POST -H 'X-Org: admin' $B/projects -H "$J" -d '{"id":"P","owner":"a","contractor":"b","agreedPrice":1}'  # 403 AdminOrg can't write
curl -s -X PUT $B/projects/PRJ-001 -H "$J" -d '{"owner":"a","contractor":"b","agreedPrice":300000,"payments":[]}'    # 400 payments can't be changed
curl -s -H 'X-Org: nobody' $B/projects/PRJ-001                                                                  # 400 bad X-Org
```

The API runs as the container **`projects-api`** (image built from [`api/Dockerfile`](api/Dockerfile), service in [`compose/compose-api.yaml`](compose/compose-api.yaml)) on the same Docker network as the peers,
so it reaches them by name (`peer0.platform.example.com:7051`, `http://orderer.example.com:9443/healthz`, ...). Start/rebuild it alone with `./pn net api`; logs: `docker logs -f projects-api`.
The certificates are mounted read-only from the workspace volume; the container runs as the non-root `node` user. It is published on `127.0.0.1:4000` only.

Configuration lives in [`api/.env`](api/.env.example) (MSP IDs, channel, chaincode, certificate paths, health timing, port). `./pn start` creates it from `api/.env.example` if missing;
the peer and health addresses are overridden with container names in `compose/compose-api.yaml`.
After editing the code or `.env` run `./pn net api` (rebuilds and restarts only the API). Unit tests need Node.js 20+ on the host: `cd api && npm install && npm test`.

## 5. Health

`GET /health` checks:

* each node – `orderer`, `peer0.platform`, `peer0.adminorg` – through its operations service `GET /healthz` → `"up"` or `"down"`;
* each peer's block height on `projects-channel` (`qscc` `GetChainInfo`) and whether the peers are in sync (same height). A 1-block gap is normal for a few seconds after a write, so it is tolerated for `SYNC_GRACE_SECONDS` (10 s, in `api/.env`); a bigger gap is unhealthy immediately.

**HTTP 200 `"healthy"`** if everything is OK, otherwise **HTTP 503 `"unhealthy"`** with `reasons`.

```bash
curl -s -i $B/health
docker stop peer0.adminorg.example.com        # -> 503, "peer0.adminorg is down (ECONNREFUSED)", its height is null
curl -s -i $B/health
docker start peer0.adminorg.example.com       # -> back to 200 within a few seconds
curl -s -i $B/health
```

Right after a peer restarts, a *write* can return `503` for a few more seconds until the peers' gossip marks it alive again (both orgs must endorse). Retry.

## 6. Prometheus + Grafana (live charts)

```bash
./pn monitoring                  # needs the network running; stop with ./pn monitoring --down (or ./pn stop)
```

* Grafana <http://localhost:3000> (login `admin` / `admin`) → dashboard **Projects Network – Fabric Performance**: chaincode requests, endorsements, block processing, blockchain height per node.
* Prometheus <http://localhost:9090/targets> scrapes `orderer.example.com:9443`, `peer0.platform.example.com:9444`, `peer0.adminorg.example.com:9445`.
* The sample's cAdvisor / node-exporter containers and their Docker/host CPU panels were left out (cAdvisor's image doesn't work on Docker Desktop). Images used: `prom/prometheus:v2.32.1`, `grafana/grafana:8.3.4`.

## 7. What was changed compared with `test-network`

`project-network` started as a copy of [`hyperledger/fabric-samples`](https://github.com/hyperledger/fabric-samples)'s `test-network` (Apache-2.0) and then:

* The sample's two default organizations were replaced by **Platform / AdminOrg** everywhere (crypto config, `configtx.yaml`, compose, scripts, connection profiles `organizations/peerOrganizations/*/connection-*.json|yaml`), channel `projects-channel`,
  chaincode endorsement policy `AND('PlatformMSP.peer','AdminOrgMSP.peer')` and channel policy `ALL Endorsement`. A case-insensitive search of this folder for the sample's old organization names finds nothing.
* Left out of the copy because this network doesn't use them: the add-a-third-org sample, BFT, Fabric-CA/cfssl, CouchDB, podman files, the CaaS tutorial. Only cryptogen certificates and JavaScript chaincode are supported.
* Docker images are pinned to `3.1.5`; network `projects_net`, Compose project `fabricprojects`.
* The scripts, the CLI tools and the API all run in containers (section 1), so nodes are addressed by container name instead of `localhost`, and generated files live in a Docker volume instead of the repository folder.

## 8. Troubleshooting

* **Windows**: use Docker Desktop with the WSL2 backend and *Linux containers*, and run `.\pn.ps1 start` (PowerShell) or `pn.cmd start`. Git may check files out with CRLF line endings; `.gitattributes` forces LF and the orchestrator also converts them, so this needs no action.
  If a port is refused, Windows may have reserved it: `netsh interface ipv4 show excludedportrange protocol=tcp` (the network uses 7050, 7051, 7053, 9051, 9443–9445, 4000, 3000, 9090). On WSL2 you can also just use `./pn` from the Ubuntu shell.
* **`docker pull` hangs with no output** (seen on one Mac): the Docker credential helper (`credsStore: desktop`) can block when the macOS keychain isn't reachable. Public images need no login, so run `pn` with a config that has no credential store:
  `mkdir -p ~/.docker-nocreds && echo '{"auths":{}}' > ~/.docker-nocreds/config.json && ln -sfn ~/.docker/cli-plugins ~/.docker-nocreds/cli-plugins && DOCKER_CONFIG=~/.docker-nocreds ./pn start`
  (the pulls the orchestrator itself makes already run without credentials).
* **"mount source subpath ... " / unknown volume option** – Docker is too old; the workspace volume needs Docker Engine 26+ (Docker Desktop 4.29+).
* **Ports in use** – stop anything else on those ports, e.g. the original `test-network`.
* **Stopped containers with random names** in `Created` state appear after chaincode deploys (Docker image build steps of the peers). They are harmless; `docker container prune` removes them.
* `./pn stop --clean` is the only command that deletes data. To start from zero: `./pn stop --clean` then `./pn start`.
* To look at the generated files: `./pn shell`, then `ls organizations/` (they are inside the workspace volume, not in the repository folder).

## 9. Security notes (read before putting this on a server)

* **The REST API has no authentication.** `X-Org` only chooses which organization's user signs the transaction; anyone who can reach the port can write as Platform.
  It is therefore published on `127.0.0.1:4000` only (the `ports:` line in `compose/compose-api.yaml`). Put it behind a reverse proxy or firewall that authenticates callers before exposing it.
* Grafana's login is the sample default `admin` / `admin` (`prometheus-grafana/grafana/config.monitoring`): change it, and don't publish ports 3000 / 9090.
* The compose files publish the Fabric ports (7050, 7051, 7053, 9051, 9443–9445) on all interfaces; restrict them with a firewall on a public host.
* Certificates are generated by `cryptogen` (development use) inside the Docker volume `fabricprojects_workspace`; they are never written into the repository, so they cannot be committed by accident.
