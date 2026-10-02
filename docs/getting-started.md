# Getting started

## 1. What you need

* **Docker**, running:
  * Windows: Docker Desktop with the **WSL2 backend** and **Linux containers** (the default).
  * macOS: Docker Desktop.
  * Linux: Docker Engine **26 or newer** (and your user allowed to run `docker`).
* A terminal: PowerShell or cmd (Windows), Terminal (macOS/Linux), or WSL2.
* About **3 GB of disk** for the Docker images and an internet connection **the first time** (the images are downloaded).

Nothing else: no Node.js, no Bash, no `jq`, no Fabric binaries. Everything runs inside Docker.

## 2. Get the project

```bash
git clone https://github.com/73azn/fabric-projects-network.git
cd fabric-projects-network
```

On Windows, git may check files out with Windows line endings; that is handled automatically.

## 3. Start it

Run **one** of these from the repository folder (the first run takes a few minutes: it downloads images and builds the network):

| Where | Command |
|---|---|
| macOS, Linux, WSL2, Git Bash | `./pn start --download-fabric` |
| Windows PowerShell | `.\pn.ps1 start --download-fabric` |
| Windows cmd.exe | `pn.cmd start --download-fabric` |

`--download-fabric` downloads the official Hyperledger Fabric 3.1.5 Linux tarball (125 MB) the first time. If you already have
`hyperledger-fabric-linux-amd64-3.1.5.tar.gz`, put it in the repository folder and leave the flag out. After the first run you never need it again.

It does everything in one go: creates the certificates, starts the orderer and the two peers, creates the channel `projects-channel`,
installs the chaincode `projectcc`, and starts the REST API. When you see:

```
Everything is up.
  API:     http://localhost:4000
```

it is ready. The command is safe to run again at any time: finished steps are skipped.

Options: `--no-api` (no REST API), `--monitoring` (also start Prometheus + Grafana, see [operations.md](operations.md)).

## 4. Check that it works

```bash
curl -s http://localhost:4000/health
```

You should see `"status":"healthy"` with all three nodes `up`. (Windows PowerShell: `Invoke-RestMethod http://localhost:4000/health`.)

## 5. Use it

Create a project, read it, add a payment — see the [API reference](api-reference.md), or run a full guided demo that creates a sample project,
adds payments, updates it, shows the history, and demonstrates the error cases:

```bash
docs/examples/crud-demo.sh
```

On Windows PowerShell: `.\docs\examples\crud-demo.ps1`. Other languages: [examples/client.js](examples/client.js) (Node.js) and [examples/client.py](examples/client.py) (Python).

## 6. Stop, restart, reset

| I want to… | Command (replace `./pn` with `.\pn.ps1` or `pn.cmd` on Windows) |
|---|---|
| Stop everything and **keep my data** | `./pn stop` |
| Start it again with the same data | `./pn start` |
| See what is running | `./pn status` |
| Delete everything (ledgers + certificates) and start clean | `./pn stop --clean`, then `./pn start` |

`./pn stop --clean` is the **only** command that deletes data, and it asks for confirmation first.

## 7. Using it on another computer or a server

Repeat sections 2–3 there: the project does not depend on anything of this computer. Notes:

* **Each installation has its own ledger.** The data lives in Docker volumes (`fabricprojects_*`) on the machine where it runs; cloning the repository does not copy data.
* **The API has no login.** By default it is reachable only from the same machine (`127.0.0.1:4000`). To use it from other machines, put it behind a reverse proxy or firewall
  that authenticates callers. See [operations.md](operations.md#security).
* Linux servers: the Fabric tools image is built for amd64. On an ARM server Docker needs QEMU emulation for it (see [troubleshooting.md](troubleshooting.md)); not tested here.

## 8. Where things are

| Path | What |
|---|---|
| `pn`, `pn.ps1`, `pn.cmd` | the launcher you run |
| `project-network/` | the network, the chaincode (`chaincode/projectcc`), the REST API (`api/`), settings (`network.config`, `api/.env`) |
| `docs/` | this documentation |

More about each part: [architecture.md](architecture.md).
