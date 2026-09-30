#!/usr/bin/env bash
# Streams the logs of every container on the projects network (logspout), at http://127.0.0.1:8000/logs
#   ./monitordocker.sh [docker-network] [port]
# Needs the gliderlabs/logspout image (pulled on first use).
DOCKER_NETWORK="${1:-projects_net}"
PORT="${2:-8000}"

echo "Starting monitoring on all containers on the network ${DOCKER_NETWORK}"

docker kill logspout 2> /dev/null 1>&2 || true
docker rm logspout 2> /dev/null 1>&2 || true

trap "docker kill logspout" SIGINT

docker run -d --rm --name="logspout" \
	--volume=/var/run/docker.sock:/var/run/docker.sock \
	--publish=127.0.0.1:${PORT}:80 \
	--network "${DOCKER_NETWORK}" \
	gliderlabs/logspout
sleep 3
curl "http://127.0.0.1:${PORT}/logs"
