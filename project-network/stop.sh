#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Stops everything: REST API, Prometheus/Grafana (if running), orderer and peers.
# The ledgers and certificates are KEPT, so ./start.sh brings the same network back with all data.
#
#   ./stop.sh                  stop, keep data
#   ./stop.sh --clean          stop AND delete ledgers, crypto material, channel artifacts (asks first)
#   ./stop.sh --clean --yes    same, without asking
cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1
. scripts/utils.sh

CLEAN_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --clean) CLEAN_ARGS+=(-clean) ;;
    --yes|-y) CLEAN_ARGS+=(-y) ;;
    -h|--help) sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fatalln "Unknown option: $arg (see ./stop.sh --help)" ;;
  esac
done

if [ -f api/api.pid ]; then
  pid=$(cat api/api.pid)
  if kill -0 "$pid" 2> /dev/null; then
    infoln "Stopping the REST API (pid $pid)"
    kill "$pid" 2> /dev/null
  fi
  rm -f api/api.pid
fi

# Monitoring containers are attached to the Fabric network, stop them first
if docker ps -a --format '{{.Names}}' 2> /dev/null | grep -qx -e prometheus -e grafana; then
  infoln "Stopping Prometheus/Grafana"
  docker compose -f prometheus-grafana/docker-compose.yaml down
fi

./network.sh down "${CLEAN_ARGS[@]}"
successln "Stopped."
