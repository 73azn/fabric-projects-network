#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Channel config helpers (need jq on the host; configtxlator runs in the tools container).

. "$(dirname "${BASH_SOURCE[0]}")/envVar.sh"

# fetchChannelConfig <org> <channel_id> <output_json>
# Writes the current channel config for a channel to a JSON file
fetchChannelConfig() {
  local org=$1 channel=$2 output=$3
  local art="${NET_HOME}/channel-artifacts"
  setGlobals "$org"

  infoln "Fetching the most recent configuration block for the channel"
  peer channel fetch config "${art}/config_block.pb" -o "$PN_ORDERER_ADDRESS" --ordererTLSHostnameOverride orderer.example.com -c "$channel" --tls --cafile "$PN_ORDERER_CA" || return 1

  infoln "Decoding config block to JSON and isolating config to ${output}"
  configtxlator proto_decode --input "${art}/config_block.pb" --type common.Block --output "${art}/config_block.json" || return 1
  jq .data.data[0].payload.data.config "${art}/config_block.json" > "$output"
}

# createConfigUpdate <channel_id> <original_config.json> <modified_config.json> <output.pb>
# Computes the config update transaction that turns the original config into the modified one
createConfigUpdate() {
  local channel=$1 original=$2 modified=$3 output=$4
  local art="${NET_HOME}/channel-artifacts"

  configtxlator proto_encode --input "$original" --type common.Config --output "${art}/original_config.pb" &&
  configtxlator proto_encode --input "$modified" --type common.Config --output "${art}/modified_config.pb" &&
  configtxlator compute_update --channel_id "$channel" --original "${art}/original_config.pb" --updated "${art}/modified_config.pb" --output "${art}/config_update.pb" &&
  configtxlator proto_decode --input "${art}/config_update.pb" --type common.ConfigUpdate --output "${art}/config_update.json" || return 1
  echo '{"payload":{"header":{"channel_header":{"channel_id":"'"$channel"'", "type":2}},"data":{"config_update":'"$(cat "${art}/config_update.json")"'}}}' | jq . > "${art}/config_update_in_envelope.json" &&
  configtxlator proto_encode --input "${art}/config_update_in_envelope.json" --type common.Envelope --output "$output"
}
