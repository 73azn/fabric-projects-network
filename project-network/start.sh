#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Starts everything: orderer + 2 peers, projects-channel, the projectcc chaincode and the REST API (a container).
# Safe to run again: steps that are already done are skipped, so it also restarts a stopped network
# with its ledgers intact.
#
#   ./pn start                 network + channel + chaincode + REST API, all in Docker (http://localhost:4000)
#   ./pn start --no-api        skip the REST API
#   ./pn start --monitoring    also start Prometheus + Grafana (http://localhost:3000)
#   ./pn start --download-fabric   download the official Fabric 3.1.5 Linux tarball if it is not in the repository folder

# Not inside the orchestrator? Hand over to the launcher (it runs this script in a container).
if [ -z "${PN_IN_CONTAINER:-}" ]; then
  exec "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/pn" start "$@"
fi
cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1
. scripts/utils.sh

START_API=true
START_MONITORING=false
DOMAIN="${PN_DOMAIN:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --no-api) START_API=false ;;
    --monitoring) START_MONITORING=true ;;
    --download-fabric) export PN_DOWNLOAD_FABRIC=true ;;
    --domain) DOMAIN="${2:-}"; [ -n "$DOMAIN" ] || fatalln "--domain needs a name, for example --domain chain.example.com"; shift ;;
    -h|--help) sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fatalln "Unknown option: $1 (see ./pn start --help)" ;;
  esac
  shift
done

./network.sh up            || fatalln "Starting the network failed"
./network.sh createChannel || fatalln "Creating the channel failed"
./network.sh deployCC      || fatalln "Deploying the chaincode failed"

if [ "$START_API" = "true" ]; then
  ./network.sh api || fatalln "Starting the REST API container failed"
fi
if [ -n "$DOMAIN" ]; then
  [ "$START_API" = "true" ] || fatalln "--domain needs the API (do not combine it with --no-api)"
  PN_DOMAIN="$DOMAIN" ./network.sh proxy || fatalln "Starting the HTTPS proxy failed"
fi
if [ "$START_MONITORING" = "true" ]; then
  ./start-monitoring.sh || fatalln "Starting Prometheus/Grafana failed"
fi

API_PORT=$(grep -E '^PORT=' api/.env 2>/dev/null | head -1 | cut -d= -f2 | tr -d ' \r')
successln "Everything is up."
println "  API:     http://localhost:${API_PORT:-4000}   (health: curl -s http://localhost:${API_PORT:-4000}/health)"
println "  Stop:    ./pn stop        (add --clean to also delete the ledgers)"
