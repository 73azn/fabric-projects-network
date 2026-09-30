#!/usr/bin/env bash
# Builds the local image "fabric-tools-local:<version>" from the Fabric Linux tarball and
# installs the matching config/ (core.yaml, orderer.yaml, configtx.yaml) next to bin/.
#
#   tools/build-tools-image.sh [--download] [path/to/hyperledger-fabric-linux-amd64-3.1.5.tar.gz]
#
# The tarball is looked for, in this order: the path argument, $FABRIC_TARBALL, the repository root
# (the folder that contains bin/ tools/ project-network/), and the folder above it.
# Nothing is downloaded unless you pass --download: then the official release
#   https://github.com/hyperledger/fabric/releases/download/v<version>/hyperledger-fabric-linux-amd64-<version>.tar.gz
# is fetched into the repository root and checked against a pinned SHA-256.
set -euo pipefail

FABRIC_VERSION="${FABRIC_VERSION:-3.1.5}"
TARBALL_SHA256_3_1_5="b9c31fd490991e76f8acb1835dee09fc19fee5428cb13e190ee6e0bdd2c37858"

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SAMPLES_DIR="$(dirname "$TOOLS_DIR")"
IMAGE="fabric-tools-local:${FABRIC_VERSION}"
TARBALL_NAME="hyperledger-fabric-linux-amd64-${FABRIC_VERSION}.tar.gz"

DOWNLOAD=false
TARBALL_ARG=""
for arg in "$@"; do
  case "$arg" in
    --download) DOWNLOAD=true ;;
    *) TARBALL_ARG="$arg" ;;
  esac
done

sha256_of() {
  if command -v sha256sum > /dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

find_tarball() {
  local candidate
  for candidate in "$TARBALL_ARG" "${FABRIC_TARBALL:-}" "${SAMPLES_DIR}/${TARBALL_NAME}" "${SAMPLES_DIR}/../${TARBALL_NAME}"; do
    if [ -n "$candidate" ] && [ -f "$candidate" ]; then echo "$candidate"; return 0; fi
  done
  return 1
}

need_extract() { [ ! -d "${TOOLS_DIR}/linux-amd64/bin" ]; }

if ! docker image inspect "$IMAGE" > /dev/null 2>&1 || [ ! -d "${SAMPLES_DIR}/config" ]; then
  if need_extract; then
    TARBALL="$(find_tarball || true)"
    if [ -z "$TARBALL" ] && [ "$DOWNLOAD" = "true" ]; then
      TARBALL="${SAMPLES_DIR}/${TARBALL_NAME}"
      echo "Downloading ${TARBALL_NAME} (about 125 MB) ..."
      curl -fL --retry 3 -o "$TARBALL" "https://github.com/hyperledger/fabric/releases/download/v${FABRIC_VERSION}/${TARBALL_NAME}"
      expected_var="TARBALL_SHA256_${FABRIC_VERSION//./_}"
      if [ -n "${!expected_var:-}" ] && [ "$(sha256_of "$TARBALL")" != "${!expected_var}" ]; then
        rm -f "$TARBALL"
        echo "SHA-256 of the downloaded file does not match the pinned value; file removed." >&2
        exit 1
      fi
    fi
    if [ -z "$TARBALL" ]; then
      echo "Fabric tarball ${TARBALL_NAME} not found." >&2
      echo "Put it in ${SAMPLES_DIR}/ or run: tools/build-tools-image.sh --download" >&2
      exit 1
    fi
    echo "Extracting $(basename "$TARBALL") ..."
    mkdir -p "${TOOLS_DIR}/linux-amd64"
    tar -xzf "$TARBALL" -C "${TOOLS_DIR}/linux-amd64"
  fi
  mkdir -p "${SAMPLES_DIR}/config"
  for f in core.yaml orderer.yaml configtx.yaml; do
    [ -f "${SAMPLES_DIR}/config/$f" ] || cp "${TOOLS_DIR}/linux-amd64/config/$f" "${SAMPLES_DIR}/config/$f"
  done
fi

if docker image inspect "$IMAGE" > /dev/null 2>&1; then
  echo "Image $IMAGE already exists."
else
  echo "Building $IMAGE ..."
  docker build --platform linux/amd64 -t "$IMAGE" "$TOOLS_DIR"
fi
docker run --rm --platform linux/amd64 "$IMAGE" peer version | sed -n '1,3p'
