# Troubleshooting

Start with these two commands; they answer most questions:

```bash
./pn status
curl -s http://localhost:4000/health
```

(Windows: `.\pn.ps1 status` and `Invoke-RestMethod http://localhost:4000/health`.)

## Starting

| Symptom | Cause and fix |
|---|---|
| `pn: Docker is not installed` / `The Docker daemon is not running` | Install Docker, or start Docker Desktop and wait until it says it is running. On Linux, make sure your user may run `docker` (`sudo usermod -aG docker $USER`, then log in again). |
| Windows: `.\pn` or `pn` does nothing useful in PowerShell | Use `.\pn.ps1 start` (PowerShell) or `pn.cmd start` (cmd.exe). The file named `pn` is for Bash. If scripts are blocked, `pn.cmd` works around it (it bypasses the execution policy). |
| `Fabric tarball … not found` | Run `./pn start --download-fabric`, or put `hyperledger-fabric-linux-amd64-3.1.5.tar.gz` in the repository folder. |
| The first start is slow | Normal: it downloads about 3 GB of images and builds the chaincode inside the peers (needs internet). Later starts take about a minute. |
| It hangs while pulling images on macOS (no output at all) | The Docker credential helper can block when the keychain is locked. Run with a config without it: `mkdir -p ~/.docker-nocreds && echo '{"auths":{}}' > ~/.docker-nocreds/config.json && ln -sfn ~/.docker/cli-plugins ~/.docker-nocreds/cli-plugins && DOCKER_CONFIG=~/.docker-nocreds ./pn start` |
| `port is already allocated` / `address already in use` | Something else uses 4000, 7050, 7051, 7053, 9051, 9443–9445 (or 3000/9090 for monitoring). Stop it (for example the original Fabric `test-network`). The API port can be changed: see [operations.md](operations.md#settings). On Windows: `netsh interface ipv4 show excludedportrange protocol=tcp` shows ports Windows keeps reserved. |
| An error mentioning `subpath` or an unknown volume option | Docker is too old. Update Docker Desktop (4.29+) / Docker Engine (26+). |
| `Could not build the Fabric tools image` | The tarball is missing or corrupt (see above), or Docker cannot build images. |
| The chaincode step fails or times out | The peers build the chaincode image on the first deploy and need internet for `npm install`. Check your connection and run `./pn start` again. |
| On an ARM Linux server, `exec format error` | The Fabric tools image is amd64 and needs emulation. The usual way is to install QEMU/binfmt (`docker run --privileged --rm tonistiigi/binfmt --install amd64`), then retry. (Not tested here.) |

## Using the API

| Symptom | Cause and fix |
|---|---|
| `curl: (7) Failed to connect to localhost port 4000` | The API is not running. `./pn start`, then check `docker ps` for `projects-api` and `./pn logs`. |
| `/health` returns `503` | Read `reasons`: it names the node that is down. `docker ps -a` shows it; `./pn start` brings missing nodes back. After a restart give it up to half a minute. |
| Write returns `503 NETWORK_UNAVAILABLE` | One of the two peers (or the orderer) is down or still reconnecting. Both organizations must approve every write. Check `/health`, wait a few seconds, retry. |
| `401 UNAUTHORIZED` | The server requires an API key. Send `Authorization: Bearer <key>` (the exact header name; `X-API-Key` is not accepted). The key is the `API_KEY` in `project-network/api/.env` on the server. |
| `403 FORBIDDEN` | You used `X-Org: admin`. The AdminOrg user can only read; use the default `platform` for writes. |
| `404 NOT_FOUND` | The project id does not exist (ids are case-sensitive). |
| `409 ALREADY_EXISTS` | That id is taken: choose another or update the existing one. |
| `409 CONFLICT` | Two writes to the same project at the same moment. Retry. |
| `400 INVALID_INPUT` | The message tells you what is wrong. The rules are in [data-model.md](data-model.md). Common ones: price or amount not above 0 or with more than 2 decimals, an unknown task `status`, a `done` task without `finishDate`, a date that does not exist, a payment that would go above the agreed price, a duplicate payment id. |
| JSON problems on Windows | In PowerShell `curl` is an alias for `Invoke-WebRequest`. Use `Invoke-RestMethod` (examples in [api-reference.md](api-reference.md)) or `curl.exe` and put the JSON in a here-string or a file: `curl.exe -X POST … --data "@project.json"`. |
| `500 INTERNAL_ERROR` | Look at `./pn logs` (or `docker logs projects-api`). |

## HTTPS and the domain

| Symptom | Cause and fix |
|---|---|
| `The proxy exposes the API to the internet, so it needs an API key` | `./pn start --domain …` refuses to run without a key. Run `./pn key`, put it in `project-network/api/.env` as `API_KEY=…` (add the line if the file is older and has none), then start again. |
| The browser or `curl` says the certificate is invalid, or the connection is refused | The certificate is requested the first time the domain is used. Check, in this order: the `A` record points to the server's IP (`dig +short chain.example.com`), ports **80 and 443** are open in the provider's firewall, and nothing else on the server uses 80/443. Then read `./pn logs projects-proxy`. Let's Encrypt allows only a few attempts per hour, so fix the cause before retrying. |
| `HTTP 308` redirects when calling `http://…` | Normal: port 80 redirects to HTTPS. Use `https://`. |
| `./pn start --domain` fails with "port is already allocated" for 80/443 | Another web server runs on the host. Stop it, or put this API behind it instead. |
| The API answers `401` on `/health` but `/livez` works | Correct: only `/livez` is public. Send the key. |

## Data

| Question | Answer |
|---|---|
| Where is my data? | In Docker volumes named `fabricprojects_*`. See [operations.md](operations.md#data-where-it-lives-how-to-reset). |
| I stopped it, is the data gone? | No: `./pn stop` keeps it. Only `./pn stop --clean` deletes it. |
| I want a completely fresh start | `./pn stop --clean`, then `./pn start`. |
| I deleted the Docker volumes and the data is gone | Deleted volumes cannot be recovered. Start again with `./pn start`: it creates a new, empty network. |
| Disk is filling up | `docker system df` shows usage. The images are about 3 GB; `docker container prune` removes the harmless stopped `Created` containers left over from chaincode builds. |

## Still stuck?

Collect this and look for errors:

```bash
./pn status
./pn logs                          # the API
./pn logs peer0.platform.example.com
./pn logs orderer.example.com
```
