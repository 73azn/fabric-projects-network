#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Orderer channel-participation helpers (osnadmin over the orderer admin endpoint, mutual TLS).
#   channelOnOrderer <channel>    -> exit 0 if the orderer already has the channel
#   joinOrderer <channel> <block> -> joins the orderer to the channel (creates it)
#
# osnadmin exits 0 even for HTTP errors (it prints "Status: <code>"), so the status line is checked.

_osn() {
  osnadmin channel "$@" -o "$PN_ORDERER_ADMIN_ADDRESS" --ca-file "$PN_ORDERER_CA" \
    --client-cert "$PN_ORDERER_ADMIN_CERT" --client-key "$PN_ORDERER_ADMIN_KEY" 2>&1
}

channelOnOrderer() {
  _osn list --channelID "$1" | grep -q '^Status: 200'
}

joinOrderer() {
  local out
  out=$(_osn join --channelID "$1" --config-block "$2")
  echo "$out"
  grep -q '^Status: 201' <<<"$out"
}
