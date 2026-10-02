# Architecture

## The big picture

```
 you / your app
      │  HTTP + JSON      http://localhost:4000
      ▼
 ┌──────────────┐   gRPC (TLS)   ┌────────────────────────────┐        ┌────────────────────────────┐
 │ projects-api │ ─────────────► │ peer0.platform.example.com │◄──────►│ peer0.adminorg.example.com │
 │ Node.js +    │  X-Org picks   │ PlatformMSP   :7051        │ gossip │ AdminOrgMSP   :9051        │
 │ Express      │  the identity  │ chaincode "projectcc"      │        │ chaincode "projectcc"      │
 └──────────────┘                └─────────────┬──────────────┘        └──────────────┬─────────────┘
                                               │  ordered transactions (blocks)       │
                                               ▼                                      ▼
                                      ┌──────────────────────────────────────────────────┐
                                      │ orderer.example.com   OrdererMSP, Raft, :7050    │
                                      └──────────────────────────────────────────────────┘
                 channel: projects-channel  ·  endorsement policy: BOTH organizations on every write
```

* **Two organizations**, one peer each: **Platform** (`PlatformMSP`, domain `platform.example.com`) and **AdminOrg** (`AdminOrgMSP`, `adminorg.example.com`), plus the orderer organization (`OrdererMSP`, `example.com`).
* **One channel**, `projects-channel`. Both peers hold a full copy of the ledger.
* **One chaincode**, `projectcc` (JavaScript), defining the project records and rules. See [data-model.md](data-model.md).
* **The REST API** is the only thing you talk to. It signs requests with the `User1` identity of the organization chosen by the `X-Org` header.

## What happens on a write (e.g. add a payment)

1. The API receives `POST /projects/PRJ-001/payments` and asks its Fabric gateway to submit the transaction.
2. The gateway sends the proposal to a Platform peer **and** an AdminOrg peer. Each runs the chaincode in its own chaincode container, checks the caller's organization and the rules, and signs the result.
3. With both signatures the transaction goes to the **orderer**, which puts it in a block.
4. Both peers receive the block, validate the endorsement policy (both signatures present), and commit it to their ledger.
5. The API gets the commit result and answers `201`.

If one of the two peers is down, step 2 cannot collect both signatures and the API answers `503 NETWORK_UNAVAILABLE`.
A **read** is answered by a single peer and does not create a block.

## The containers

| Container | Image | Role |
|---|---|---|
| `orderer.example.com` | `hyperledger/fabric-orderer:3.1.5` | orders transactions into blocks (single-node Raft) |
| `peer0.platform.example.com` | `hyperledger/fabric-peer:3.1.5` | Platform's peer + ledger |
| `peer0.adminorg.example.com` | `hyperledger/fabric-peer:3.1.5` | AdminOrg's peer + ledger |
| `dev-peer0.<org>…-projectcc_<version>-…` | built from `hyperledger/fabric-nodeenv:2.5` | the chaincode, one container per peer (created by the peers) |
| `projects-api` | `projects-api:local` (built from `project-network/api/Dockerfile`, `node:24-alpine`) | the REST API |
| `prometheus`, `grafana` | `prom/prometheus`, `grafana/grafana` | optional monitoring |

All of them are on the Docker network **`projects_net`**, so they find each other by container name. Only the ports listed in [operations.md](operations.md#ports) are published to your computer.
Every Fabric node has an *operations* endpoint (`/healthz`, `/metrics`), which the health check and Prometheus use.

## How `pn` runs everything (and why it works on Windows, macOS and Linux)

```
host:   pn / pn.ps1 / pn.cmd ──docker run──►  orchestrator container   (image built from /orchestrator)
                                                │  has: Docker CLI + Compose, Bash, jq   (+ the host's Docker socket)
                                                │  runs: project-network/*.sh
                                                ▼
                                      docker compose / docker run  ─►  orderer, peers, API, Fabric tools ...
```

* The **orchestrator** is a small Linux container. It runs the project's Bash scripts, so the host needs nothing but Docker. It talks to the host's Docker through the mounted socket, so the containers it starts are normal containers next to it.
* Your repository is copied into the Docker volume **`fabricprojects_workspace`**, which is also where the generated certificates and channel files go.
  Every container mounts only the sub-folder it needs from that volume (for example the orderer gets its own `msp` and `tls` folders). No host paths are involved, which avoids Windows path, line-ending and permission problems.
  The orchestrator re-copies your sources on every `pn` call, so edits to the repository are picked up.
* The **Fabric command-line tools** (`peer`, `configtxgen`, `cryptogen`, `osnadmin`, …) come from the official Linux tarball. `bin/` contains wrappers that run the real tool inside the local image `fabric-tools-local:3.1.5`
  (built from that tarball by `tools/build-tools-image.sh`).

## Identities and certificates

`cryptogen` generates a certificate authority per organization, the node certificates (peers, orderer) and users `Admin@…` and `User1@…`. The scripts use the **Admin** identities to create the channel,
join the peers and approve the chaincode; the REST API uses **User1**. TLS is on everywhere. This tool is for development; for production you would use real certificate authorities.

## Repository layout

```
pn, pn.ps1, pn.cmd         launchers
orchestrator/              Dockerfile + entrypoint of the orchestrator image
bin/                       peer, configtxgen, cryptogen, ... wrappers (+ fabric-docker-run)
tools/                     builds the Fabric tools image from the official tarball
docs/                      this documentation
project-network/
  start.sh, stop.sh, network.sh, start-monitoring.sh    the scripts the orchestrator runs
  network.config           channel, chaincode name/version, endorsement policy
  compose/                 Docker Compose files (network, peer overlay, API)
  configtx/                channel and organization definitions
  organizations/cryptogen/ certificate definitions
  scripts/                 channel creation, chaincode install/approve/commit, anchor peers, ...
  chaincode/projectcc/     the smart contract (JavaScript) + tests
  api/                     the REST API (Node.js) + Dockerfile + tests
  prometheus-grafana/      monitoring configuration and dashboard
```

`project-network` started as a copy of `test-network` from [hyperledger/fabric-samples](https://github.com/hyperledger/fabric-samples) (Apache-2.0), adapted to this project.
