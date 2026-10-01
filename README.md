# fabric-projects-network

A Hyperledger Fabric **3.1.5** network for tracking projects between an **owner** (client) and a **contractor**:
the work plan, the agreed price and the payments. Two organizations (**Platform**, **AdminOrg**) with one peer each and one Raft orderer,
a JavaScript chaincode (`projectcc`), a REST API (Express + `@hyperledger/fabric-gateway`), health checks and Prometheus/Grafana monitoring.

Full documentation, API examples (`curl` for every endpoint) and the health test are in **[project-network/README.md](project-network/README.md)**.

## Quick start (Windows, macOS, Linux)

The only requirement is **Docker** (Docker Desktop with Linux containers on Windows/macOS). Nothing else is installed on your machine.

```bash
git clone https://github.com/73azn/fabric-projects-network.git
cd fabric-projects-network

./pn start --download-fabric        # macOS / Linux / WSL2 / Git Bash   (first run: downloads the Fabric 3.1.5 tarball, pulls images)
.\pn.ps1 start --download-fabric    # Windows PowerShell
pn.cmd start --download-fabric      # Windows cmd.exe

curl -s localhost:4000/health       # {"status":"healthy", ...}
./pn stop                           # stop (data is kept);  ./pn stop --clean  deletes ledgers and certificates
```

If you already have `hyperledger-fabric-linux-amd64-3.1.5.tar.gz`, put it in this folder and leave out `--download-fabric` (later runs don't need it either way).
More commands: `./pn status`, `./pn logs`, `./pn monitoring`, `./pn shell`, `./pn help`.

## Layout

| Path | What |
|---|---|
| `pn`, `pn.ps1`, `pn.cmd` | launchers (Bash / PowerShell / cmd): build the orchestrator image and run it with the Docker socket |
| `orchestrator/` | the image that runs the scripts: Docker CLI + Compose + Bash + jq, so the host needs only Docker |
| `project-network/` | the network: compose files, `configtx`, scripts, `chaincode/projectcc`, `api/`, `prometheus-grafana/` |
| `bin/` | wrappers (`peer`, `configtxgen`, `cryptogen`, …) that run the real Fabric tools inside a Docker image |
| `tools/` | `Dockerfile` + `build-tools-image.sh` that build that image from the official Fabric tarball |

Everything runs in Docker: the orchestrator, the orderer, both peers, the chaincode containers, the REST API (`projects-api`), the Fabric CLI tools and Prometheus/Grafana.
Generated files (certificates, channel artifacts) and ledgers live in Docker volumes, not in this folder. Node.js is only needed on the host to run the unit tests.

Full documentation, API examples (`curl` for every endpoint), the health test and Windows notes: **[project-network/README.md](project-network/README.md)**.

## License

Apache-2.0 (see [LICENSE](LICENSE)). `project-network` is derived from `test-network` in
[hyperledger/fabric-samples](https://github.com/hyperledger/fabric-samples) (Apache-2.0).
