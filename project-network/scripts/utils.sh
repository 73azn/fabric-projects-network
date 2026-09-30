#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Small helpers shared by all scripts (colored output).

C_RESET='\033[0m'
C_RED='\033[0;31m'
C_GREEN='\033[0;32m'
C_BLUE='\033[0;34m'
C_YELLOW='\033[1;33m'

println()   { echo -e "$1"; }
errorln()   { println "${C_RED}${1}${C_RESET}"; }
successln() { println "${C_GREEN}${1}${C_RESET}"; }
infoln()    { println "${C_BLUE}${1}${C_RESET}"; }
warnln()    { println "${C_YELLOW}${1}${C_RESET}"; }
fatalln()   { errorln "$1"; exit 1; }
