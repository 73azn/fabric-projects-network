#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Source it inside the orchestrator (./pn shell) to run the peer CLI as an organization admin:
#   . ./setOrgEnv.sh platform      (or: adminorg)
#   peer channel list
#   ../bin/peer chaincode query -C projects-channel -n projectcc -c '{"Args":["ReadProject","PRJ-001"]}'
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  echo "This script must be sourced:  . ./setOrgEnv.sh platform|adminorg" >&2
  exit 1
fi
. "$(dirname "${BASH_SOURCE[0]}")/scripts/envVar.sh"
setGlobals "${1:-platform}"
echo "Peer CLI is now set up as ${CORE_PEER_LOCALMSPID} (${CORE_PEER_ADDRESS})"
