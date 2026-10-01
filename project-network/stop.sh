#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Stops everything: REST API container, Prometheus/Grafana (if running), orderer and peers.
# The ledgers and certificates are KEPT, so ./pn start brings the same network back with all data.
#
#   ./pn stop                  stop, keep data
#   ./pn stop --clean          stop AND delete ledgers, crypto material, channel artifacts (asks first)
#   ./pn stop --clean --yes    same, without asking

# Not inside the orchestrator? Hand over to the launcher (it runs this script in a container).
if [ -z "${PN_IN_CONTAINER:-}" ]; then
  exec "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/pn" stop "$@"
fi
cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1
. scripts/utils.sh

CLEAN_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --clean) CLEAN_ARGS+=(-clean) ;;
    --yes|-y) CLEAN_ARGS+=(-y) ;;
    -h|--help) sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fatalln "Unknown option: $arg (see ./pn stop --help)" ;;
  esac
done

# Monitoring containers are attached to the Fabric network, stop them first
if docker ps -a --format '{{.Names}}' 2> /dev/null | grep -qx -e prometheus -e grafana; then
  infoln "Stopping Prometheus/Grafana"
  ./start-monitoring.sh --down || true
fi

./network.sh down "${CLEAN_ARGS[@]}"
successln "Stopped."
