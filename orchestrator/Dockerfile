# The "orchestrator": a Linux container that runs the project's Bash scripts, so the host only needs Docker
# (macOS, Linux, Windows). It talks to the host's Docker daemon through the mounted socket and starts the
# Fabric containers next to itself. Built automatically by the pn launchers.
FROM docker:29-cli

RUN apk add --no-cache bash jq curl rsync coreutils sed grep findutils tar gzip

# (strip CR in case a Windows checkout converted the line endings)
COPY entrypoint.sh /usr/local/bin/pn-entrypoint
RUN sed -i 's/\r$//' /usr/local/bin/pn-entrypoint && chmod +x /usr/local/bin/pn-entrypoint

ENV PN_IN_CONTAINER=1
WORKDIR /work
ENTRYPOINT ["/usr/local/bin/pn-entrypoint"]
