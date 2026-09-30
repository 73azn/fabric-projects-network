#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Packages, installs, approves (both organizations) and commits the chaincode.
#   deployCC.sh <channel> <name> <path> <language> <version> <sequence|auto> <endorsement policy> <delay> <max_retry> <verbose>
. "$(dirname "${BASH_SOURCE[0]}")/envVar.sh"

CHANNEL_NAME=${1:-"projects-channel"}
CC_NAME=${2}
CC_SRC_PATH=${3}
CC_SRC_LANGUAGE=${4}
CC_VERSION=${5:-"1.0"}
CC_SEQUENCE=${6:-"auto"}
CC_END_POLICY=${7:-"AND('PlatformMSP.peer','AdminOrgMSP.peer')"}
DELAY=${8:-"3"}
MAX_RETRY=${9:-"5"}
VERBOSE=${10:-"false"}

println "executing with the following"
println "- CHANNEL_NAME:  ${C_GREEN}${CHANNEL_NAME}${C_RESET}"
println "- CC_NAME:       ${C_GREEN}${CC_NAME}${C_RESET}"
println "- CC_SRC_PATH:   ${C_GREEN}${CC_SRC_PATH}${C_RESET}"
println "- CC_VERSION:    ${C_GREEN}${CC_VERSION}${C_RESET}"
println "- CC_SEQUENCE:   ${C_GREEN}${CC_SEQUENCE}${C_RESET}"
println "- CC_END_POLICY: ${C_GREEN}${CC_END_POLICY}${C_RESET}"

. "${NET_HOME}/scripts/ccutils.sh"
cd "$NET_HOME"

jq --version > /dev/null 2>&1 || fatalln "jq command not found (macOS: it ships in /usr/bin; Linux: apt install jq)"

## package the chaincode
"${NET_HOME}/scripts/packageCC.sh" "$CC_NAME" "$CC_SRC_PATH" "$CC_SRC_LANGUAGE" "$CC_VERSION" || exit 1

export FABRIC_CFG_PATH="${SAMPLES_HOME}/config"
PACKAGE_ID=$(peer lifecycle chaincode calculatepackageid "${NET_HOME}/${CC_NAME}.tar.gz")

## install on both peers
for org in "${PN_ORGS[@]}"; do
  infoln "Installing chaincode on peer0.${org}..."
  installChaincode "$org"
done

resolveSequence
infoln "Using chaincode definition sequence ${CC_SEQUENCE}"

queryInstalled platform

## approve for Platform -> only Platform has approved so far
approveForMyOrg platform
checkCommitReadiness platform "\"PlatformMSP\": true" "\"AdminOrgMSP\": false"
checkCommitReadiness adminorg "\"PlatformMSP\": true" "\"AdminOrgMSP\": false"

## approve for AdminOrg -> both have approved
approveForMyOrg adminorg
checkCommitReadiness platform "\"PlatformMSP\": true" "\"AdminOrgMSP\": true"
checkCommitReadiness adminorg "\"PlatformMSP\": true" "\"AdminOrgMSP\": true"

## commit; the commit itself is endorsed by both organizations
commitChaincodeDefinition platform adminorg

queryCommitted platform
queryCommitted adminorg

warmUpChaincode
exit 0
