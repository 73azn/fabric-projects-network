#!/usr/bin/env bash
# Starts Prometheus + Grafana for the projects network (the network must be running: ./start.sh).
#   ./start-monitoring.sh          start
#   ./start-monitoring.sh --down   stop (charts history is kept in Docker volumes)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
. scripts/utils.sh

if ! docker network inspect projects_net >/dev/null 2>&1; then
  fatalln "Docker network projects_net not found. Start the network first: ./start.sh"
fi

if [ "${1:-}" = "--down" ]; then
  docker compose -f prometheus-grafana/docker-compose.yaml down
  successln "Monitoring stopped"
  exit 0
fi

docker compose -f prometheus-grafana/docker-compose.yaml up -d

infoln "Waiting for Grafana ..."
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null http://localhost:3000/api/health; then break; fi
  sleep 2
done

successln "Monitoring is up"
println "  Grafana:    http://localhost:3000   (admin / admin)  -> dashboard 'Projects Network - Fabric Performance'"
println "  Prometheus: http://localhost:9090/targets"
