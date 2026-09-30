#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Projects network: orderer + 2 organizations (Platform, AdminOrg), 1 peer each.
# Derived from fabric-samples/test-network/network.sh.  Normally you use ./start.sh and ./stop.sh;
# this script gives you the individual steps:
#
#   ./network.sh up                 generate crypto (first time) and start orderer + 2 peers
#   ./network.sh createChannel      create projects-channel, join both peers, set anchor peers
#   ./network.sh deployCC           package/install/approve/commit the projectcc chaincode
#   ./network.sh api                build + start the REST API container (joins the Fabric network)
#   ./network.sh status             what is running
#   ./network.sh down [-clean [-y]] stop the containers (-clean: ALSO delete ledgers, crypto, channel artifacts)
#
# All Fabric CLIs (peer, configtxgen, ...) run in a container built from the Fabric 3.1.5 Linux tarball,
# see ../bin and ../tools, so this works the same on macOS and Linux.

ROOTDIR="$(cd "$(dirname "$0")" && pwd)"
SAMPLES_DIR="$(dirname "$ROOTDIR")"
export PATH="${SAMPLES_DIR}/bin:${PATH}"
export FABRIC_CFG_PATH="${ROOTDIR}/configtx"
export VERBOSE=false

cd "$ROOTDIR" || exit 1
. scripts/utils.sh
. ./network.config
export FABRIC_IMAGE_TAG

if command -v docker-compose > /dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  COMPOSE="docker compose"
fi
COMPOSE_FILES=(-f compose/compose-project-net.yaml -f compose/docker/docker-compose-project-net.yaml)
API_COMPOSE_FILES=("${COMPOSE_FILES[@]}" -f compose/compose-api.yaml)

# Docker socket the peers use to build/run chaincode containers
SOCK="${DOCKER_HOST:-/var/run/docker.sock}"
export DOCKER_SOCK="${SOCK##unix://}"

NODES=(orderer.example.com peer0.platform.example.com peer0.adminorg.example.com)
OPERATIONS_PORTS=(9443 9444 9445)

printHelp() {
  println "Usage: ./network.sh <mode> [flags]"
  println
  println "  Modes:"
  println "    ${C_GREEN}up${C_RESET}             start the orderer and both peers (creates crypto material on first run)"
  println "    ${C_GREEN}createChannel${C_RESET}  create the channel, join both peers, set anchor peers (starts the network if needed)"
  println "    ${C_GREEN}deployCC${C_RESET}       install + approve (both orgs) + commit the chaincode; skipped if this version is already committed"
  println "    ${C_GREEN}api${C_RESET}            build and start the REST API as a container (http://localhost:4000)"
  println "    ${C_GREEN}status${C_RESET}         show containers, channel membership and the committed chaincode"
  println "    ${C_GREEN}down${C_RESET}           stop and remove the containers (ledgers are kept)"
  println
  println "  Flags:"
  println "    -c <channel>   channel name (default ${CHANNEL_NAME})"
  println "    -ccn <name>    chaincode name (default ${CC_NAME})"
  println "    -ccp <path>    chaincode path (default ${CC_SRC_PATH})"
  println "    -ccv <version> chaincode version (default ${CC_VERSION})"
  println "    -ccs <seq>     chaincode sequence: integer or auto (default ${CC_SEQUENCE})"
  println "    -ccep <policy> endorsement policy (default ${CC_END_POLICY})"
  println "    -r <n>         max retries (default ${MAX_RETRY})     -d <seconds> delay between retries (default ${CLI_DELAY})"
  println "    -f             with deployCC: deploy again even if this version is already committed"
  println "    -clean         with down: ALSO delete ledgers (Docker volumes), crypto material and channel artifacts"
  println "    -y             with down -clean: do not ask for confirmation"
  println "    -verbose       print the CORE_* environment used for each peer command"
  println "    -h             this help"
}

# ---------------------------------------------------------------- prerequisites

ensureImage() {
  local image=$1
  if docker image inspect "$image" > /dev/null 2>&1; then
    return 0
  fi
  infoln "Pulling Docker image ${image} (first run only) ..."
  docker pull "$image" || fatalln "Could not pull ${image}"
}

checkPrereqs() {
  docker version --format '{{.Server.Version}}' > /dev/null 2>&1 || fatalln "The Docker daemon is not running. Start Docker Desktop (or the docker service) and try again."
  command -v jq > /dev/null 2>&1 || fatalln "jq is required (macOS: /usr/bin/jq ships with the OS; Linux: apt install jq)."

  ensureImage "hyperledger/fabric-peer:${FABRIC_IMAGE_TAG}"
  ensureImage "hyperledger/fabric-orderer:${FABRIC_IMAGE_TAG}"
  # Node.js chaincode runtime used by the peer to build/run projectcc (newest published tag is 2.5)
  ensureImage "hyperledger/fabric-nodeenv:2.5"

  # CLI tools image built from the Fabric Linux tarball (skipped when it already exists)
  "${SAMPLES_DIR}/tools/build-tools-image.sh" > /dev/null || fatalln "Could not build the Fabric tools image (see ../tools/build-tools-image.sh)"

  local local_version image_version
  local_version=$(peer version | sed -ne 's/^ Version: //p')
  image_version=$(docker run --rm "hyperledger/fabric-peer:${FABRIC_IMAGE_TAG}" peer version | sed -ne 's/^ Version: //p')
  infoln "CLI tools version: ${local_version}   peer image version: ${image_version}"
  if [ "$local_version" != "$image_version" ]; then
    warnln "CLI tools and peer image versions differ. This may cause problems."
  fi
}

# ---------------------------------------------------------------- crypto material

createOrgs() {
  infoln "Generating certificates using cryptogen"
  local org
  for org in platform adminorg orderer; do
    infoln "Creating ${org} identities"
    cryptogen generate --config="./organizations/cryptogen/crypto-config-${org}.yaml" --output="organizations" || fatalln "Failed to generate certificates for ${org}"
  done
  infoln "Generating connection profiles for Platform and AdminOrg"
  ./organizations/ccp-generate.sh
}

# ---------------------------------------------------------------- network

waitForNodes() {
  infoln "Waiting for the nodes to report healthy on their operations endpoints ..."
  local i port n
  for i in "${!NODES[@]}"; do
    port=${OPERATIONS_PORTS[$i]}
    for n in $(seq 1 30); do
      if curl -fsS -o /dev/null "http://localhost:${port}/healthz"; then
        successln "${NODES[$i]} is up (http://localhost:${port}/healthz)"
        continue 2
      fi
      sleep 1
    done
    fatalln "${NODES[$i]} did not become healthy on port ${port}"
  done
}

networkUp() {
  checkPrereqs
  if [ ! -d "organizations/peerOrganizations" ]; then
    createOrgs
  fi
  ${COMPOSE} "${COMPOSE_FILES[@]}" up -d 2>&1
  docker ps -a --filter label=service=hyperledger-fabric --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
  waitForNodes
}

allNodesRunning() {
  local n running
  for n in "${NODES[@]}"; do
    running=$(docker inspect -f '{{.State.Running}}' "$n" 2>/dev/null)
    [ "$running" = "true" ] || return 1
  done
}

createChannel() {
  if ! allNodesRunning || [ ! -d "organizations/peerOrganizations" ]; then
    infoln "Bringing up the network first"
    networkUp
  fi
  scripts/createChannel.sh "$CHANNEL_NAME" "$CLI_DELAY" "$MAX_RETRY" "$VERBOSE" || fatalln "Creating the channel failed"
}

deployCC() {
  . scripts/envVar.sh
  . scripts/ccutils.sh
  if [ "$FORCE" != "true" ] && CHANNEL_NAME="$CHANNEL_NAME" CC_NAME="$CC_NAME" isCommitted "$CC_VERSION"; then
    successln "Chaincode ${CC_NAME} version ${CC_VERSION} is already committed on '${CHANNEL_NAME}' (use -f to deploy again)"
    return 0
  fi
  scripts/deployCC.sh "$CHANNEL_NAME" "$CC_NAME" "$CC_SRC_PATH" "$CC_SRC_LANGUAGE" "$CC_VERSION" "$CC_SEQUENCE" "$CC_END_POLICY" "$CLI_DELAY" "$MAX_RETRY" "$VERBOSE"
  [ $? -eq 0 ] || fatalln "Deploying chaincode failed"
}

startApi() {
  docker version --format '{{.Server.Version}}' > /dev/null 2>&1 || fatalln "The Docker daemon is not running."
  [ -f api/.env ] || cp api/.env.example api/.env
  [ -d organizations/peerOrganizations ] || fatalln "No crypto material yet: run ./network.sh up first"
  ensureImage "node:24-alpine"
  export API_UID API_GID
  API_UID=$(id -u); API_GID=$(id -g)
  API_PORT=$(grep -E '^PORT=' api/.env | head -1 | cut -d= -f2 | tr -d ' \r'); export API_PORT=${API_PORT:-4000}
  infoln "Building and starting the REST API container ..."
  ${COMPOSE} "${API_COMPOSE_FILES[@]}" up -d --build api 2>&1 || fatalln "Could not start the API container"
  local n
  for n in $(seq 1 30); do
    if curl -fs -o /dev/null "http://localhost:${API_PORT}/"; then
      successln "REST API container is up: http://localhost:${API_PORT}  (logs: docker logs projects-api)"
      return 0
    fi
    sleep 1
  done
  docker logs --tail 20 projects-api
  fatalln "The REST API container did not answer on port ${API_PORT}"
}

networkStatus() {
  docker ps -a --filter label=service=hyperledger-fabric --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
  [ -d organizations/peerOrganizations ] || { warnln "No crypto material yet: run ./network.sh up"; return 0; }
  . scripts/envVar.sh
  . scripts/ccutils.sh
  local org
  for org in "${PN_ORGS[@]}"; do
    setGlobals "$org" > /dev/null
    println
    infoln "peer0.${org}:"
    peer channel list 2>&1 | sed '1,1d;s/^/  channel: /'
    peer channel getinfo -c "$CHANNEL_NAME" 2>&1 | sed 's/^/  /'
  done
  println
  setGlobals platform > /dev/null
  peer lifecycle chaincode querycommitted --channelID "$CHANNEL_NAME" --name "$CC_NAME" 2>&1
}

networkDown() {
  if [ "$CLEAN" = "true" ]; then
    warnln "-clean will DELETE: the ledgers (Docker volumes), organizations/peerOrganizations, organizations/ordererOrganizations,"
    warnln "                    channel-artifacts/, the packaged chaincode (*.tar.gz), and the generated chaincode images."
    if [ "$ASSUME_YES" != "true" ]; then
      read -r -p "Delete all of that? [y/N] " answer
      if [ "$answer" != "y" ] && [ "$answer" != "Y" ]; then
        infoln "Not deleting anything: only stopping the containers."
        CLEAN=false
      fi
    fi
  fi

  ${COMPOSE} "${API_COMPOSE_FILES[@]}" down --remove-orphans

  # chaincode containers started by the peers (they are recreated on demand)
  docker rm -f $(docker ps -aq --filter name='dev-peer*') 2> /dev/null || true

  if [ "$CLEAN" = "true" ]; then
    docker volume rm projectnet_orderer.example.com projectnet_peer0.platform.example.com projectnet_peer0.adminorg.example.com 2> /dev/null || true
    docker image rm -f $(docker images -aq --filter reference='dev-peer*') 2> /dev/null || true
    rm -rf organizations/peerOrganizations organizations/ordererOrganizations channel-artifacts log.txt ./*.tar.gz
    successln "Network data deleted."
  fi
}

# ---------------------------------------------------------------- arguments

MODE=$1
[ $# -ge 1 ] && shift
FORCE=false
CLEAN=false
ASSUME_YES=false

while [[ $# -ge 1 ]]; do
  key="$1"
  case $key in
    -h ) printHelp; exit 0 ;;
    -c ) CHANNEL_NAME="$2"; shift ;;
    -r ) MAX_RETRY="$2"; shift ;;
    -d ) CLI_DELAY="$2"; shift ;;
    -ccl ) CC_SRC_LANGUAGE="$2"; shift ;;
    -ccn ) CC_NAME="$2"; shift ;;
    -ccv ) CC_VERSION="$2"; shift ;;
    -ccs ) CC_SEQUENCE="$2"; shift ;;
    -ccp ) CC_SRC_PATH="$2"; shift ;;
    -ccep ) CC_END_POLICY="$2"; shift ;;
    -f ) FORCE=true ;;
    -clean ) CLEAN=true ;;
    -y ) ASSUME_YES=true ;;
    -verbose ) VERBOSE=true ;;
    * ) errorln "Unknown flag: $key"; printHelp; exit 1 ;;
  esac
  shift
done

case "$MODE" in
  up )            infoln "Starting nodes (images ${FABRIC_IMAGE_TAG})"; networkUp ;;
  createChannel ) infoln "Creating channel '${CHANNEL_NAME}'"; createChannel ;;
  deployCC )      infoln "Deploying chaincode '${CC_NAME}' on channel '${CHANNEL_NAME}'"; deployCC ;;
  api )           infoln "Starting the REST API container"; startApi ;;
  status )        networkStatus ;;
  down )          infoln "Stopping network"; networkDown ;;
  * )             printHelp; exit 1 ;;
esac
