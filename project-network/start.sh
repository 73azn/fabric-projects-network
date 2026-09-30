#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Starts everything: orderer + 2 peers, projects-channel, the projectcc chaincode, and the REST API.
# Safe to run again: steps that are already done are skipped, so it also restarts a stopped network
# with its ledgers intact.
#
#   ./start.sh                 network + channel + chaincode + REST API, all in Docker (http://localhost:4000)
#   ./start.sh --no-api        skip the REST API
#   ./start.sh --host-api      run the REST API with Node.js on this machine instead of in a container
#   ./start.sh --monitoring    also start Prometheus + Grafana (http://localhost:3000)
cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1
. scripts/utils.sh

START_API=true
API_IN_DOCKER=true
START_MONITORING=false
for arg in "$@"; do
  case "$arg" in
    --no-api) START_API=false ;;
    --host-api) API_IN_DOCKER=false ;;
    --monitoring) START_MONITORING=true ;;
    -h|--help) sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fatalln "Unknown option: $arg (see ./start.sh --help)" ;;
  esac
done

./network.sh up            || fatalln "Starting the network failed"
./network.sh createChannel || fatalln "Creating the channel failed"
./network.sh deployCC      || fatalln "Deploying the chaincode failed"

api_port() { grep -E '^PORT=' api/.env 2>/dev/null | head -1 | cut -d= -f2 | tr -d ' \r'; }

start_api() {
  command -v node > /dev/null 2>&1 || fatalln "Node.js (v20 or newer) is required for the REST API"
  [ -f api/.env ] || cp api/.env.example api/.env
  if [ -f api/api.pid ] && kill -0 "$(cat api/api.pid)" 2> /dev/null; then
    infoln "REST API is already running (pid $(cat api/api.pid))"
  else
    infoln "Starting the REST API ..."
    if [ ! -d api/node_modules ]; then
      (cd api && npm install --no-audit --no-fund --loglevel=error) || fatalln "npm install failed in api/"
    fi
    (cd api || exit 1; nohup node src/server.js > api.log 2>&1 & echo $! > api.pid)
  fi
  local port n
  port=$(api_port); port=${port:-4000}
  for n in $(seq 1 30); do
    if curl -fs -o /dev/null "http://localhost:${port}/"; then
      successln "REST API is up: http://localhost:${port}  (log: api/api.log)"
      return 0
    fi
    sleep 1
  done
  errorln "REST API did not start; see api/api.log"
  tail -20 api/api.log
  return 1
}

if [ "$START_API" = "true" ]; then
  if [ "$API_IN_DOCKER" = "true" ]; then
    ./network.sh api || fatalln "Starting the REST API container failed"
  else
    start_api || exit 1
  fi
fi
[ "$START_MONITORING" = "true" ] && ./start-monitoring.sh

successln "Everything is up."
println "  Health:  curl -s http://localhost:$(api_port)/health"
println "  Stop:    ./stop.sh        (add --clean to also delete the ledgers)"
