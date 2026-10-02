# Operations

Commands: use `./pn` on macOS, Linux, WSL and Git Bash; `.\pn.ps1` in PowerShell; `pn.cmd` in cmd.exe. Run them from the repository folder.

## Commands

| Command | What it does |
|---|---|
| `./pn start` | build and start everything: network, channel, chaincode, REST API. Safe to repeat. |
| `./pn start --monitoring` | the same, plus Prometheus + Grafana |
| `./pn start --no-api` | everything except the REST API |
| `./pn start --download-fabric` | also download the Fabric 3.1.5 tarball if it is not in the repository folder |
| `./pn start --domain chain.example.com` | also publish the API over **HTTPS** on that domain (needs an `API_KEY`; see [Making it reachable from the internet](#making-it-reachable-from-the-internet-https--api-key)) |
| `./pn key` | print a new random API key |
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
| 80 / 443 | HTTPS proxy (only with `--domain`) | everyone: the proxy forwards to the API, which still requires the API key |
| 7050 / 7053 | orderer (clients / admin) | all interfaces |
| 7051 / 9051 | peer Platform / peer AdminOrg | all interfaces |
| 9443 / 9444 / 9445 | operations (`/healthz`, `/metrics`): orderer / Platform peer / AdminOrg peer | all interfaces |
| 3000 / 9090 | Grafana / Prometheus (only with monitoring) | all interfaces |

## Settings

| File | Settings |
|---|---|
| `project-network/network.config` | channel name, chaincode name / **version** / sequence, endorsement policy, retries, Fabric image tag |
| `project-network/api/.env` | the REST API (see below). Optional: without it the defaults of `api/.env.example` are used. To change something, copy `api/.env.example` to `api/.env` in the repository folder, edit it, then run `./pn net api`. |

`api/.env` keys: `API_KEY` (the secret every caller must send, see below) · `PORT` (published port, default 4000) · `CHANNEL_NAME` · `CHAINCODE_NAME` · `PLATFORM_*` and `ADMIN_*` (MSP id and the certificate/key paths of the user the API signs with) ·
`HEALTH_TIMEOUT_MS` · `SYNC_GRACE_SECONDS`. The peer addresses and health URLs in that file are for running the API outside Docker; inside Docker they are replaced by container names.
After changing the file or the API code run `./pn net api` (rebuilds and restarts only the API). For example `PORT=5000` makes the API available at http://localhost:5000.

## Upgrading the chaincode

Change the code in `project-network/chaincode/projectcc/`, raise `CC_VERSION` in `network.config` (for example `1.3` → `1.4`), then:

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

## Making it reachable from the internet (HTTPS + API key)

Use this when another service, for example a Supabase Edge Function, must call the API on a server. You need a **domain name** (a subdomain such as `chain.example.com` is perfect) and a server with Docker.

1. **DNS:** create an `A` record `chain.example.com` → the server's public IP. (If the domain is on Cloudflare, set the record to "DNS only" for now.)
2. **Firewall:** allow inbound **TCP 80 and 443** (and SSH from your own IP); keep everything else closed, including 4000. Port 80 is used to prove to Let's Encrypt that you own the domain.
3. **API key:** generate one and put it in `project-network/api/.env` (create the file by copying `api/.env.example` if it is missing):

   ```bash
   ./pn key
   ```

   ```
   API_KEY=<the 64 characters it printed>
   ```

   Keep the key secret (it is not committed: `api/.env` is git-ignored). Give the same key to the caller (see [integration.md](integration.md#from-a-supabase-edge-function)).
4. **Start with the domain:**

   ```bash
   ./pn start --domain chain.example.com
   ```

   This starts the usual services plus a small Caddy container (`projects-proxy`) that gets a free Let's Encrypt certificate, renews it by itself, redirects HTTP to HTTPS and forwards to the API. **It refuses to start without an API key.**
5. **Check:**

   ```bash
   curl -s https://chain.example.com/livez
   ```

   → `{"status":"ok"}`. Any other path without the key answers `401`; with `-H "Authorization: Bearer <key>"` it answers normally. If the certificate is not issued, see `./pn logs projects-proxy` and [troubleshooting.md](troubleshooting.md).

**Rotating the key:** run `./pn key`, put the new value in `api/.env`, run `./pn net api` (restarts only the API), then update the caller. The old key stops working immediately.
**Turning it off:** `./pn stop`, then `./pn start` (without `--domain`) brings the system back with the API on localhost only.

After a **server reboot** the Fabric nodes, the API and the proxy come back by themselves (they have a restart policy), unless you stopped them yourself with `./pn stop`.

## Security

* **API key.** When `API_KEY` is set in `api/.env`, every request except `GET /livez` must send `Authorization: Bearer <key>` (details in the [API reference](api-reference.md#authentication)); keys are compared in constant time and never logged.
  **Without a key the API is open to anyone who can reach it**, which is why it is only published on `127.0.0.1:4000` and why the HTTPS proxy refuses to start without one. The key proves *who is calling*; it does not limit *what* a caller may do: whoever holds it can create projects and add payments as the Platform, so keep it on servers only (never in a browser or mobile app) and give it to as few services as possible.
* Grafana's default login is `admin` / `admin`: change it, and keep ports 3000 / 9090 closed on a server (use an SSH tunnel).
* The Fabric ports (7050–9051, 9443–9445) are published on all interfaces; restrict them with the server's or the provider's firewall (on a server only 80/443 and SSH need to be open).
* Certificates for the Fabric network are generated by `cryptogen`, which is meant for development. They live only in the Docker volume and are never written into the repository.
* Before exposing anything: set the API key, change the Grafana password, and think about who must be allowed to create and pay.
