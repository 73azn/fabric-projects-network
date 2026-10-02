# Operations

Commands: use `./pn` on macOS, Linux, WSL and Git Bash; `.\pn.ps1` in PowerShell; `pn.cmd` in cmd.exe. Run them from the repository folder.

## Commands

| Command | What it does |
|---|---|
| `./pn start` | build and start everything: network, channel, chaincode, REST API. Safe to repeat. |
| `./pn start --monitoring` | the same, plus Prometheus + Grafana |
| `./pn start --no-api` | everything except the REST API |
| `./pn start --download-fabric` | also download the Fabric 3.1.5 tarball if it is not in the repository folder |
| `./pn stop` | stop everything; **data is kept** |
| `./pn stop --clean` | stop and **delete** ledgers, certificates and channel artifacts (asks first; `--yes` skips the question) |
| `./pn status` | containers, block height of each peer, the committed chaincode |
| `./pn logs [container]` | follow logs; default `projects-api`; others: `orderer.example.com`, `peer0.platform.example.com`, `peer0.adminorg.example.com` |
| `./pn monitoring [--down]` | Prometheus + Grafana on / off |
| `./pn shell` | a shell inside the orchestrator container (see "Peer CLI" below) |
| `./pn net <mode>` | the individual steps: `up`, `createChannel`, `deployCC`, `status`, `api`, `down` (see `./pn net -h`) |

## Health

`GET http://localhost:4000/health` → `200 healthy` or `503 unhealthy` with reasons (details in the [API reference](api-reference.md#health)).
Quick test of the alerting: `docker stop peer0.adminorg.example.com` → `/health` returns `503` and names that peer; `docker start peer0.adminorg.example.com` → healthy again within a few seconds.

## Monitoring (live charts)

```bash
./pn monitoring
```

* **Grafana** — http://localhost:3000 — login `admin` / `admin` — dashboard **Projects Network – Fabric Performance** (chaincode requests, endorsements, block processing, blockchain height per node).
* **Prometheus** — http://localhost:9090/targets — scrapes the orderer and both peers (`/metrics` on ports 9443, 9444, 9445).

Change the Grafana password (and don't publish ports 3000/9090) before using this anywhere other than your own computer.

## Ports

| Port | What | Reachable from |
|---|---|---|
| 4000 | REST API | this computer only (`127.0.0.1`) |
| 7050 / 7053 | orderer (clients / admin) | all interfaces |
| 7051 / 9051 | peer Platform / peer AdminOrg | all interfaces |
| 9443 / 9444 / 9445 | operations (`/healthz`, `/metrics`): orderer / Platform peer / AdminOrg peer | all interfaces |
| 3000 / 9090 | Grafana / Prometheus (only with monitoring) | all interfaces |

## Settings

| File | Settings |
|---|---|
| `project-network/network.config` | channel name, chaincode name / **version** / sequence, endorsement policy, retries, Fabric image tag |
| `project-network/api/.env` | the REST API (see below). Optional: without it the defaults of `api/.env.example` are used. To change something, copy `api/.env.example` to `api/.env` in the repository folder, edit it, then run `./pn net api`. |

`api/.env` keys: `PORT` (published port, default 4000) · `CHANNEL_NAME` · `CHAINCODE_NAME` · `PLATFORM_*` and `ADMIN_*` (MSP id and the certificate/key paths of the user the API signs with) ·
`HEALTH_TIMEOUT_MS` · `SYNC_GRACE_SECONDS`. The peer addresses and health URLs in that file are for running the API outside Docker; inside Docker they are replaced by container names.
After changing the file or the API code run `./pn net api` (rebuilds and restarts only the API). For example `PORT=5000` makes the API available at http://localhost:5000.

## Upgrading the chaincode

Change the code in `project-network/chaincode/projectcc/`, raise `CC_VERSION` in `network.config` (for example `1.2` → `1.3`), then:

```bash
./pn start
```

It packages, installs, gets approval from both organizations and commits the new definition (the sequence number is increased automatically). **Existing data is kept.**

## Peer CLI (advanced)

```bash
./pn shell
. ./setOrgEnv.sh platform          # act as the Platform admin (or: adminorg)
peer channel list
peer chaincode query -C projects-channel -n projectcc -c '{"Args":["ReadProject","PRJ-001"]}'
exit
```

The generated certificates are in that shell too: `ls organizations/peerOrganizations`.

## Data: where it lives, how to reset

All data is in Docker volumes, not in the repository folder:

| Volume | Holds |
|---|---|
| `fabricprojects_orderer.example.com` | the orderer's ledger |
| `fabricprojects_peer0.platform.example.com`, `fabricprojects_peer0.adminorg.example.com` | each peer's ledger |
| `fabricprojects_workspace` | a copy of the sources plus the generated certificates and channel files |
| `fabricprojects-monitoring_*` | Grafana / Prometheus data |

`./pn stop` keeps all of them. `./pn stop --clean` deletes the ledgers and the generated certificates. Set the environment variable `PN_PROJECT` to another name to run a completely separate second copy.
Docker volumes survive restarts. They are deleted only if you delete them yourself (for example `docker volume rm`, `docker volume prune -a`, or removing volumes in Docker Desktop): don't do that while you need the data.

## Security

* **The REST API has no authentication.** `X-Org` only chooses whose identity signs; anyone who can reach port 4000 can write as the Platform. That is why it is published on `127.0.0.1` only.
  To use it from other computers, put a reverse proxy or firewall in front that checks who is calling (and keep the `ports:` line in `project-network/compose/compose-api.yaml` bound to localhost behind it).
* Grafana's default login is `admin` / `admin`.
* The Fabric ports (7050–9051, 9443–9445) are published on all interfaces; restrict them with a firewall on a public machine.
* Certificates are generated by `cryptogen`, which is meant for development. They live only in the Docker volume and are never written into the repository.
* Before exposing anything: change the Grafana password, and think about who must be allowed to create and pay.
