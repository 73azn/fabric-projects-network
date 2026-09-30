# fabric-projects-network

A Hyperledger Fabric **3.1.5** network for tracking projects between an **owner** (client) and a **contractor**:
the work plan, the agreed price and the payments. Two organizations (**Platform**, **AdminOrg**) with one peer each and one Raft orderer,
a JavaScript chaincode (`projectcc`), a REST API (Express + `@hyperledger/fabric-gateway`), health checks and Prometheus/Grafana monitoring.

Full documentation, API examples (`curl` for every endpoint) and the health test are in **[project-network/README.md](project-network/README.md)**.

## Quick start (macOS or Linux)

Needs Docker (running), `jq`, and the Fabric Linux tarball. (Node.js is not needed: the API runs in a container.)

```bash
git clone https://github.com/73azn/fabric-projects-network.git
cd fabric-projects-network

# Fabric 3.1.5 CLI tools: copy hyperledger-fabric-linux-amd64-3.1.5.tar.gz into this folder, or fetch the official release
tools/build-tools-image.sh --download

cd project-network
./start.sh              # network + channel + chaincode + REST API on http://localhost:4000
curl -s localhost:4000/health
./stop.sh               # stop (data is kept);  ./stop.sh --clean  deletes ledgers and certificates
```

## Layout

| Path | What |
|---|---|
| `project-network/` | the network: compose files, `configtx`, scripts, `chaincode/projectcc`, `api/`, `prometheus-grafana/`, `start.sh`, `stop.sh` |
| `bin/` | wrappers (`peer`, `configtxgen`, `cryptogen`, …) that run the real Fabric tools inside a Docker image, so the same scripts work on macOS and Linux |
| `tools/` | `Dockerfile` + `build-tools-image.sh` that build that image from the official Fabric tarball |

Everything runs in Docker: the orderer, both peers, the chaincode containers, the REST API (`projects-api`), the Fabric CLI tools and Prometheus/Grafana.
Node.js is only needed on the host to run the unit tests or the API in `--host-api` mode.

## License

Apache-2.0 (see [LICENSE](LICENSE)). `project-network` is derived from `test-network` in
[hyperledger/fabric-samples](https://github.com/hyperledger/fabric-samples) (Apache-2.0).
