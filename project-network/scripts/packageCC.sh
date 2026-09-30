#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Packages the JavaScript chaincode into <name>.tar.gz
#   packageCC.sh <name> <path> <language> <version>
. "$(dirname "${BASH_SOURCE[0]}")/envVar.sh"

CC_NAME=${1}
CC_SRC_PATH=${2}
CC_SRC_LANGUAGE=$(echo "${3}" | tr '[:upper:]' '[:lower:]')
CC_VERSION=${4}

[ -n "$CC_NAME" ] && [ "$CC_NAME" != "NA" ] || fatalln "No chaincode name was provided."
[ -d "$CC_SRC_PATH" ] || fatalln "Path to chaincode does not exist: $CC_SRC_PATH"
[ "$CC_SRC_LANGUAGE" = "javascript" ] || fatalln "This network packages JavaScript chaincode only (got '${CC_SRC_LANGUAGE}')."

println "- CC_NAME:     ${C_GREEN}${CC_NAME}${C_RESET}"
println "- CC_SRC_PATH: ${C_GREEN}${CC_SRC_PATH}${C_RESET}"
println "- CC_VERSION:  ${C_GREEN}${CC_VERSION}${C_RESET}"

export FABRIC_CFG_PATH="${SAMPLES_HOME}/config"
cd "$NET_HOME"
peer lifecycle chaincode package "${NET_HOME}/${CC_NAME}.tar.gz" --path "$CC_SRC_PATH" --lang node --label "${CC_NAME}_${CC_VERSION}"
verifyResult $? "Chaincode packaging has failed"
successln "Chaincode is packaged: ${CC_NAME}.tar.gz"
