#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Chaincode lifecycle helpers. Expect CHANNEL_NAME, CC_NAME, CC_VERSION, CC_SEQUENCE, CC_END_POLICY,
# PACKAGE_ID, DELAY and MAX_RETRY to be set by the caller (deployCC.sh).

# installChaincode <org>
installChaincode() {
  local org=$1
  setGlobals "$org"
  if peer lifecycle chaincode queryinstalled --output json | jq -r 'try (.installed_chaincodes[].package_id)' | grep -qx "$PACKAGE_ID"; then
    infoln "Chaincode ${PACKAGE_ID} is already installed on peer0.${org}"
    return 0
  fi
  peer lifecycle chaincode install "${NET_HOME}/${CC_NAME}.tar.gz"
  verifyResult $? "Chaincode installation on peer0.${org} has failed"
  successln "Chaincode is installed on peer0.${org}"
}

# queryInstalled <org>
queryInstalled() {
  local org=$1
  setGlobals "$org"
  peer lifecycle chaincode queryinstalled --output json | jq -r 'try (.installed_chaincodes[].package_id)' | grep -qx "$PACKAGE_ID"
  verifyResult $? "Query installed on peer0.${org} has failed"
  successln "Query installed successful on peer0.${org}"
}

# approveForMyOrg <org>
approveForMyOrg() {
  local org=$1
  setGlobals "$org"
  peer lifecycle chaincode approveformyorg -o "$PN_ORDERER_ADDRESS" --ordererTLSHostnameOverride orderer.example.com --tls --cafile "$PN_ORDERER_CA" \
    --channelID "$CHANNEL_NAME" --name "$CC_NAME" --version "$CC_VERSION" --package-id "$PACKAGE_ID" --sequence "$CC_SEQUENCE" \
    --signature-policy "$CC_END_POLICY"
  verifyResult $? "Chaincode definition approved on peer0.${org} on channel '$CHANNEL_NAME' failed"
  successln "Chaincode definition approved on peer0.${org} on channel '$CHANNEL_NAME'"
}

# checkCommitReadiness <org> <expected-json-fragment>...
checkCommitReadiness() {
  local org=$1; shift
  setGlobals "$org"
  infoln "Checking the commit readiness of the chaincode definition on peer0.${org} on channel '$CHANNEL_NAME'..."
  local rc=1 counter=1 out var
  while [ $rc -ne 0 ] && [ $counter -le "$MAX_RETRY" ]; do
    sleep "$DELAY"
    out=$(peer lifecycle chaincode checkcommitreadiness --channelID "$CHANNEL_NAME" --name "$CC_NAME" --version "$CC_VERSION" --sequence "$CC_SEQUENCE" \
      --signature-policy "$CC_END_POLICY" --output json 2>&1)
    rc=0
    for var in "$@"; do
      grep -q "$var" <<<"$out" || rc=1
    done
    counter=$((counter + 1))
  done
  echo "$out"
  [ $rc -eq 0 ] || fatalln "After $MAX_RETRY attempts, check commit readiness result on peer0.${org} is INVALID!"
  infoln "Commit readiness is as expected on peer0.${org}"
}

# commitChaincodeDefinition <org> [<org> ...]   (endorsed by all the given orgs)
commitChaincodeDefinition() {
  parsePeerConnectionParameters "$@"
  peer lifecycle chaincode commit -o "$PN_ORDERER_ADDRESS" --ordererTLSHostnameOverride orderer.example.com --tls --cafile "$PN_ORDERER_CA" \
    --channelID "$CHANNEL_NAME" --name "$CC_NAME" "${PEER_CONN_PARMS[@]}" --version "$CC_VERSION" --sequence "$CC_SEQUENCE" \
    --signature-policy "$CC_END_POLICY"
  verifyResult $? "Chaincode definition commit failed on channel '$CHANNEL_NAME'"
  successln "Chaincode definition committed on channel '$CHANNEL_NAME'"
}

# queryCommitted <org>
queryCommitted() {
  local org=$1
  setGlobals "$org"
  local expected="Version: ${CC_VERSION}, Sequence: ${CC_SEQUENCE}, Endorsement Plugin: escc, Validation Plugin: vscc"
  infoln "Querying chaincode definition on peer0.${org} on channel '$CHANNEL_NAME'..."
  local rc=1 counter=1 out value
  while [ $rc -ne 0 ] && [ $counter -le "$MAX_RETRY" ]; do
    sleep "$DELAY"
    out=$(peer lifecycle chaincode querycommitted --channelID "$CHANNEL_NAME" --name "$CC_NAME" 2>&1) && {
      value=$(grep -o "^Version: ${CC_VERSION}, Sequence: [0-9]*, Endorsement Plugin: escc, Validation Plugin: vscc" <<<"$out")
      [ "$value" = "$expected" ] && rc=0
    }
    counter=$((counter + 1))
  done
  echo "$out"
  [ $rc -eq 0 ] || fatalln "After $MAX_RETRY attempts, query chaincode definition result on peer0.${org} is INVALID!"
  successln "Query chaincode definition successful on peer0.${org} on channel '$CHANNEL_NAME'"
}

# committedSequence -> prints the committed sequence of CC_NAME (nothing if not committed). Uses the current org env.
committedSequence() {
  peer lifecycle chaincode querycommitted --channelID "$CHANNEL_NAME" --name "$CC_NAME" 2>/dev/null \
    | sed -n "/Version:/{s/.*Sequence: //; s/, Endorsement Plugin:.*$//; p;}"
}

# isCommitted <version>  -> exit 0 if CC_NAME is committed on the channel with exactly that version
isCommitted() {
  setGlobals platform
  peer lifecycle chaincode querycommitted --channelID "$CHANNEL_NAME" --name "$CC_NAME" 2>/dev/null | grep -q "^Version: $1,"
}

# resolveSequence: "auto" -> committed sequence + 1 (or 1 for a new chaincode)
resolveSequence() {
  if [ "${CC_SEQUENCE}" != "auto" ]; then
    return 0
  fi
  setGlobals platform
  local committed
  committed=$(committedSequence)
  if [ -z "$committed" ]; then
    CC_SEQUENCE=1
  else
    CC_SEQUENCE=$((committed + 1))
  fi
}

# warmUpChaincode: a read-only call on each peer; the first call starts the chaincode container on that peer,
# so build/start problems show up here instead of on the first API request.
warmUpChaincode() {
  local org rc counter
  for org in "${PN_ORGS[@]}"; do
    setGlobals "$org"
    rc=1; counter=1
    infoln "Starting the chaincode container on peer0.${org} (first call builds the image, this can take a minute)..."
    while [ $rc -ne 0 ] && [ $counter -le "$MAX_RETRY" ]; do
      peer chaincode query -C "$CHANNEL_NAME" -n "$CC_NAME" -c '{"Args":["ProjectExists","warm-up"]}' >/dev/null 2>&1 && rc=0 || { rc=$?; sleep "$DELAY"; }
      counter=$((counter + 1))
    done
    verifyResult $rc "Chaincode did not start on peer0.${org}"
    successln "Chaincode is running on peer0.${org}"
  done
}
