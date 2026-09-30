#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# setAnchorPeer.sh <org> <channel>  -- registers peer0 of the organization as its anchor peer.
# Anchor peers let the two organizations' peers find each other (gossip / service discovery),
# which the Gateway needs to collect endorsements from BOTH organizations.

. "$(dirname "${BASH_SOURCE[0]}")/configUpdate.sh"

ORG=$1
CHANNEL_NAME=$2
ART="${NET_HOME}/channel-artifacts"

setGlobals "$ORG"
case "$ORG" in
  platform) HOST=peer0.platform.example.com; PORT=7051 ;;
  adminorg) HOST=peer0.adminorg.example.com; PORT=9051 ;;
esac
CONFIG_JSON="${ART}/${CORE_PEER_LOCALMSPID}config.json"
MODIFIED_JSON="${ART}/${CORE_PEER_LOCALMSPID}modified_config.json"

# Right after a restart the orderer answers /healthz before its Raft leader is elected, so the first
# fetch can fail with SERVICE_UNAVAILABLE: retry for a while.
rc=1; attempt=1; max_attempts=$(( ${MAX_RETRY:-5} * 3 ))
while [ $rc -ne 0 ] && [ $attempt -le $max_attempts ]; do
  fetchChannelConfig "$ORG" "$CHANNEL_NAME" "$CONFIG_JSON" && rc=0 || {
    rc=$?
    warnln "Orderer is not ready yet (attempt ${attempt}/${max_attempts}), retrying in ${DELAY:-3}s"
    sleep "${DELAY:-3}"
  }
  attempt=$((attempt + 1))
done
verifyResult $rc "Failed to fetch the channel configuration"

if jq -e ".channel_group.groups.Application.groups.${CORE_PEER_LOCALMSPID}.values.AnchorPeers" "$CONFIG_JSON" >/dev/null 2>&1; then
  infoln "Anchor peer of ${CORE_PEER_LOCALMSPID} is already set on channel ${CHANNEL_NAME}"
  exit 0
fi

infoln "Generating anchor peer update for ${CORE_PEER_LOCALMSPID} on channel ${CHANNEL_NAME}"
jq ".channel_group.groups.Application.groups.${CORE_PEER_LOCALMSPID}.values += {\"AnchorPeers\":{\"mod_policy\": \"Admins\",\"value\":{\"anchor_peers\": [{\"host\": \"${HOST}\",\"port\": ${PORT}}]},\"version\": \"0\"}}" "$CONFIG_JSON" > "$MODIFIED_JSON"
verifyResult $? "Channel configuration update for anchor peer failed, make sure you have jq installed"

createConfigUpdate "$CHANNEL_NAME" "$CONFIG_JSON" "$MODIFIED_JSON" "${ART}/${CORE_PEER_LOCALMSPID}anchors.tx"
verifyResult $? "Could not compute the anchor peer config update"

peer channel update -o "$PN_ORDERER_ADDRESS" --ordererTLSHostnameOverride orderer.example.com -c "$CHANNEL_NAME" -f "${ART}/${CORE_PEER_LOCALMSPID}anchors.tx" --tls --cafile "$PN_ORDERER_CA"
verifyResult $? "Anchor peer update failed"
successln "Anchor peer set for org '${CORE_PEER_LOCALMSPID}' on channel '${CHANNEL_NAME}'"
