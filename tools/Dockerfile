# Fabric CLI tools image, built from the official hyperledger-fabric-linux-amd64-3.1.5.tar.gz
# (extracted into tools/linux-amd64 by tools/build-tools-image.sh).
#
# The Fabric binaries are Linux/amd64 only in that tarball, so they cannot run natively on macOS.
# Running them in this container makes the same scripts work on macOS and Linux.
# (On Apple Silicon Docker Desktop runs the amd64 image with Rosetta/QEMU.)
FROM --platform=linux/amd64 debian:bookworm-slim

COPY linux-amd64/bin/    /usr/local/bin/
COPY linux-amd64/config/ /etc/hyperledger/fabric/

ENV FABRIC_CFG_PATH=/etc/hyperledger/fabric
LABEL org.opencontainers.image.title="fabric-tools-local" \
      org.opencontainers.image.description="Fabric 3.1.5 CLI tools (peer, configtxgen, cryptogen, osnadmin, ...)"
