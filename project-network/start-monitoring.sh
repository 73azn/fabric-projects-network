#!/usr/bin/env bash
# Starts Prometheus + Grafana for the projects network (the network must be running: ./start.sh).
#   ./pn monitoring          start
#   ./pn monitoring --down   stop (charts history is kept in Docker volumes)
set -euo pipefail
if [ -z "${PN_IN_CONTAINER:-}" ]; then
  exec "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/pn" monitoring "$@"
fi
cd "$(dirname "${BASH_SOURCE[0]}")"
. scripts/utils.sh
export PN_PROJECT="${PN_PROJECT:-fabricprojects}"
export PN_WORKSPACE_VOLUME="${PN_WORKSPACE_VOLUME:-${PN_PROJECT}_workspace}"

if ! docker network inspect projects_net >/dev/null 2>&1; then
  fatalln "Docker network projects_net not found. Start the network first: ./pn start"
fi

if [ "${1:-}" = "--down" ]; then
  docker compose -f prometheus-grafana/docker-compose.yaml down
  successln "Monitoring stopped"
  exit 0
fi

docker compose -f prometheus-grafana/docker-compose.yaml up -d

infoln "Waiting for Grafana ..."
# "localhost" would be this orchestrator container, so join the Fabric network and reach Grafana by name
docker network connect projects_net "$(hostname)" > /dev/null 2>&1 || true
for _ in $(seq 1 30); do
  if curl -fs -o /dev/null http://grafana:3000/api/health; then break; fi
  sleep 2
done
docker network disconnect -f projects_net "$(hostname)" > /dev/null 2>&1 || true

successln "Monitoring is up"
println "  Grafana:    http://localhost:3000   (admin / admin)  -> dashboard 'Projects Network - Fabric Performance'"
println "  Prometheus: http://localhost:9090/targets"
