#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Environment for running the peer CLI as a given organization.
#   setGlobals platform | adminorg
#
# The CLIs run inside the fabric-tools container attached to the projects_net Docker network
# (see ../bin/fabric-docker-run), so peers and the orderer are addressed by container name.

NET_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SAMPLES_HOME="$(dirname "$NET_HOME")"
. "${NET_HOME}/scripts/utils.sh"

export PATH="${SAMPLES_HOME}/bin:${PATH}"
export CORE_PEER_TLS_ENABLED=true
# the CLIs log every gRPC event at INFO; keep the output readable
export FABRIC_LOGGING_SPEC="${FABRIC_LOGGING_SPEC:-warning}"

export PN_ORDERER_ADDRESS=orderer.example.com:7050
export PN_ORDERER_ADMIN_ADDRESS=orderer.example.com:7053
export PN_ORDERER_CA="${NET_HOME}/organizations/ordererOrganizations/example.com/tlsca/tlsca.example.com-cert.pem"
export PN_ORDERER_ADMIN_CERT="${NET_HOME}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls/server.crt"
export PN_ORDERER_ADMIN_KEY="${NET_HOME}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls/server.key"

export PN_PLATFORM_CA="${NET_HOME}/organizations/peerOrganizations/platform.example.com/tlsca/tlsca.platform.example.com-cert.pem"
export PN_ADMINORG_CA="${NET_HOME}/organizations/peerOrganizations/adminorg.example.com/tlsca/tlsca.adminorg.example.com-cert.pem"

# Both organizations, in the order used when a step has to run for each of them
PN_ORGS=(platform adminorg)

# Sets CORE_PEER_* for the admin of the given organization
setGlobals() {
  local org="${OVERRIDE_ORG:-$1}"
  case "$org" in
    platform)
      export CORE_PEER_LOCALMSPID=PlatformMSP
      export CORE_PEER_TLS_ROOTCERT_FILE="$PN_PLATFORM_CA"
      export CORE_PEER_MSPCONFIGPATH="${NET_HOME}/organizations/peerOrganizations/platform.example.com/users/Admin@platform.example.com/msp"
      export CORE_PEER_ADDRESS=peer0.platform.example.com:7051
      ;;
    adminorg)
      export CORE_PEER_LOCALMSPID=AdminOrgMSP
      export CORE_PEER_TLS_ROOTCERT_FILE="$PN_ADMINORG_CA"
      export CORE_PEER_MSPCONFIGPATH="${NET_HOME}/organizations/peerOrganizations/adminorg.example.com/users/Admin@adminorg.example.com/msp"
      export CORE_PEER_ADDRESS=peer0.adminorg.example.com:9051
      ;;
    *)
      fatalln "Unknown organization '$org' (use platform or adminorg)"
      ;;
  esac
  export FABRIC_CFG_PATH="${SAMPLES_HOME}/config"
  if [ "${VERBOSE:-false}" = "true" ]; then env | grep '^CORE_'; fi
}

# parsePeerConnectionParameters <org> [<org> ...]  ->  PEER_CONN_PARMS (array) with address + TLS root per org
parsePeerConnectionParameters() {
  PEER_CONN_PARMS=()
  PEERS=""
  local org
  for org in "$@"; do
    setGlobals "$org"
    PEERS="${PEERS:+$PEERS }peer0.${org}"
    PEER_CONN_PARMS+=(--peerAddresses "$CORE_PEER_ADDRESS" --tlsRootCertFiles "$CORE_PEER_TLS_ROOTCERT_FILE")
  done
}

verifyResult() {
  if [ "$1" -ne 0 ]; then
    fatalln "$2"
  fi
}
