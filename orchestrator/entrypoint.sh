#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Entry point of the orchestrator container (run through ./pn, pn.cmd or pn.ps1).
#   /src   the repository on the host (read-only)
#   /work  the Docker volume "<project>_workspace": a working copy of the sources plus everything generated
#          (certificates, channel artifacts, packaged chaincode). All Fabric containers mount parts of this same
#          volume, so no host paths are involved (this is what makes it work the same on Windows, macOS, Linux).
set -euo pipefail

CMD="${1:-help}"
[ $# -gt 0 ] && shift

usage() {
  cat <<'USAGE'
Usage: pn <command> [options]

  start [--no-api] [--monitoring] [--download-fabric]
                                    build and start everything: network, channel, chaincode, REST API
                                    (--download-fabric fetches the Fabric 3.1.5 Linux tarball if it is not in the repository folder)
  stop [--clean [--yes]]            stop everything (data is kept); --clean also deletes ledgers and certificates
  status                            containers, channel, committed chaincode
  logs [container]                  follow the logs (default: projects-api; e.g. orderer.example.com)
  monitoring [--down]               start/stop Prometheus + Grafana (http://localhost:3000)
  shell                             a shell inside the orchestrator (peer CLI as an org: . ./setOrgEnv.sh platform)
  net <args>                        run ./network.sh with the given arguments (see: pn net -h)
USAGE
}

# Copies the repository from /src into the workspace volume. Nothing generated is overwritten or removed.
sync_sources() {
  [ -d /src/project-network ] || { echo "The repository is not mounted at /src (run this through ./pn, pn.cmd or pn.ps1)" >&2; exit 1; }
  mkdir -p /work
  local rs=(rsync -rlt --exclude node_modules --exclude 'organizations/peerOrganizations' --exclude 'organizations/ordererOrganizations'
            --exclude channel-artifacts --exclude '*.tar.gz' --exclude api.log --exclude api.pid --exclude log.txt --exclude .DS_Store)
  "${rs[@]}" /src/project-network/ /work/project-network/
  "${rs[@]}" /src/bin/ /work/bin/
  "${rs[@]}" --exclude linux-amd64 /src/tools/ /work/tools/

  # Windows checkouts may have CRLF line endings: they break Bash scripts and Dockerfiles. Make them LF.
  find /work/project-network /work/bin /work/tools -type f \
       ! -path '*/node_modules/*' ! -path '*/organizations/*Organizations/*' ! -path '*/linux-amd64/*' \
       \( -name '*.sh' -o -name 'network.config' -o -name 'Dockerfile' -o -name '.env*' -o -name '.*ignore' -o -path '*/bin/*' \) \
       -exec sed -i 's/\r$//' {} +
  find /work -type f \( -name '*.sh' -o -path '/work/bin/*' \) -exec chmod +x {} +

  [ -f /work/project-network/api/.env ] || cp /work/project-network/api/.env.example /work/project-network/api/.env
}

case "$CMD" in
  start|up)    sync_sources; cd /work/project-network; exec ./start.sh "$@" ;;
  stop|down)   sync_sources; cd /work/project-network; exec ./stop.sh "$@" ;;
  status)      sync_sources; cd /work/project-network; exec ./network.sh status ;;
  monitoring)  sync_sources; cd /work/project-network; exec ./start-monitoring.sh "$@" ;;
  net)         sync_sources; cd /work/project-network; exec ./network.sh "$@" ;;
  logs)        exec docker logs --tail 100 -f "${1:-projects-api}" ;;
  shell)       sync_sources; cd /work/project-network; export PATH="/work/bin:$PATH"; exec bash ;;
  help|-h|--help) usage ;;
  *)           echo "Unknown command: $CMD" >&2; usage >&2; exit 1 ;;
esac
