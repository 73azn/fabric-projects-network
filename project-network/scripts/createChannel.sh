#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Creates the channel (genesis block -> orderer), joins both peers and sets the anchor peers.
# Safe to run again: every step is skipped if it is already done.
#   createChannel.sh <channel> <delay> <max_retry> <verbose>

. "$(dirname "${BASH_SOURCE[0]}")/envVar.sh"
. "${NET_HOME}/scripts/orderer.sh"
cd "$NET_HOME"

CHANNEL_NAME="${1:-projects-channel}"
DELAY="${2:-3}"
MAX_RETRY="${3:-5}"
VERBOSE="${4:-false}"

export DELAY MAX_RETRY
BLOCKFILE="${NET_HOME}/channel-artifacts/${CHANNEL_NAME}.block"
mkdir -p "${NET_HOME}/channel-artifacts"

createChannelGenesisBlock() {
  infoln "Generating channel genesis block '${CHANNEL_NAME}.block'"
  FABRIC_CFG_PATH="${NET_HOME}/configtx" configtxgen -profile ChannelUsingRaft -outputBlock "$BLOCKFILE" -channelID "$CHANNEL_NAME"
  verifyResult $? "Failed to generate the channel genesis block"
}

createChannel() {
  local rc=1 counter=1
  # Poll: the orderer may still be starting / electing its Raft leader
  while [ $rc -ne 0 ] && [ $counter -le "$MAX_RETRY" ]; do
    sleep "$DELAY"
    joinOrderer "$CHANNEL_NAME" "$BLOCKFILE" && rc=0 || rc=$?
    counter=$((counter + 1))
  done
  verifyResult $rc "Channel creation failed"
}

joinChannel() {
  local org=$1
  setGlobals "$org"
  if peer channel list 2>/dev/null | grep -qx "$CHANNEL_NAME"; then
    infoln "peer0.${org} is already on channel '$CHANNEL_NAME'"
    return 0
  fi
  local rc=1 counter=1
  # Sometimes join takes time (peer still starting), hence retry
  while [ $rc -ne 0 ] && [ $counter -le "$MAX_RETRY" ]; do
    sleep "$DELAY"
    peer channel join -b "$BLOCKFILE" && rc=0 || rc=$?
    counter=$((counter + 1))
  done
  verifyResult $rc "After $MAX_RETRY attempts, peer0.${org} has failed to join channel '$CHANNEL_NAME'"
}

if channelOnOrderer "$CHANNEL_NAME"; then
  infoln "Channel '$CHANNEL_NAME' already exists on the orderer"
  [ -f "$BLOCKFILE" ] || { setGlobals platform; peer channel fetch 0 "$BLOCKFILE" -o "$PN_ORDERER_ADDRESS" --ordererTLSHostnameOverride orderer.example.com -c "$CHANNEL_NAME" --tls --cafile "$PN_ORDERER_CA" || fatalln "Cannot fetch the genesis block"; }
else
  createChannelGenesisBlock
  infoln "Creating channel ${CHANNEL_NAME}"
  createChannel
  successln "Channel '$CHANNEL_NAME' created"
fi

for org in "${PN_ORGS[@]}"; do
  infoln "Joining ${org} peer to the channel..."
  joinChannel "$org"
done

for org in "${PN_ORGS[@]}"; do
  infoln "Setting anchor peer for ${org}..."
  "${NET_HOME}/scripts/setAnchorPeer.sh" "$org" "$CHANNEL_NAME" || exit 1
done

successln "Channel '$CHANNEL_NAME' joined by both organizations"
