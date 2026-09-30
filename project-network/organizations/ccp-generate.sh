#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Generates the connection profiles (JSON + YAML) for both organizations:
#   organizations/peerOrganizations/<org>.example.com/connection-<org>.{json,yaml}
# Run from the project-network folder (network.sh does this after cryptogen).

function one_line_pem {
    echo "`awk 'NF {sub(/\\n/, ""); printf "%s\\\\\\\n",$0;}' "$1"`"
}

# $1=org (domain label)  $2=org name  $3=MSP id  $4=peer0 port  $5=peer tls ca pem file
function json_ccp {
    local PP=$(one_line_pem "$5")
    sed -e "s/\${ORG}/$1/g" \
        -e "s/\${ORGNAME}/$2/g" \
        -e "s/\${MSPID}/$3/g" \
        -e "s/\${P0PORT}/$4/g" \
        -e "s#\${PEERPEM}#$PP#g" \
        organizations/ccp-template.json
}

function yaml_ccp {
    local PP=$(one_line_pem "$5")
    sed -e "s/\${ORG}/$1/g" \
        -e "s/\${ORGNAME}/$2/g" \
        -e "s/\${MSPID}/$3/g" \
        -e "s/\${P0PORT}/$4/g" \
        -e "s#\${PEERPEM}#$PP#g" \
        organizations/ccp-template.yaml | sed -e $'s/\\\\n/\\\n          /g'
}

generate() {
    local org=$1 name=$2 msp=$3 port=$4
    local dir=organizations/peerOrganizations/${org}.example.com
    local pem=${dir}/tlsca/tlsca.${org}.example.com-cert.pem
    echo "$(json_ccp "$org" "$name" "$msp" "$port" "$pem")" > "${dir}/connection-${org}.json"
    echo "$(yaml_ccp "$org" "$name" "$msp" "$port" "$pem")" > "${dir}/connection-${org}.yaml"
}

generate platform Platform PlatformMSP 7051
generate adminorg AdminOrg AdminOrgMSP 9051
