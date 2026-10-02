# Documentation

A blockchain system that records **projects between an owner (the client) and a contractor**: the work plan, the agreed price,
and every payment. Once written, nothing is silently changed: each change is a new version on the ledger, and payments can never be edited or deleted.

| Read this | When |
|---|---|
| [getting-started.md](getting-started.md) | Install, **start**, stop, first request. Windows, macOS and Linux. |
| [api-reference.md](api-reference.md) | Every endpoint: **create, read, update, add payment, history, health**, with `curl`, PowerShell, JavaScript and Python examples and all error codes. |
| [data-model.md](data-model.md) | What a project looks like, the validation rules, who is allowed to do what. |
| [operations.md](operations.md) | Day-to-day: status, logs, health, monitoring (Grafana), settings, upgrading, resetting, security. |
| [architecture.md](architecture.md) | How it is built: containers, ports, volumes, how a write flows through the network. |
| [troubleshooting.md](troubleshooting.md) | Something does not work. |
| [openapi.yaml](openapi.yaml) | The API as an OpenAPI 3 file: import it into Postman, Insomnia or Swagger UI. |
| [examples/](examples) | Ready-to-run scripts: `crud-demo.sh`, `crud-demo.ps1`, `client.js`, `client.py`. |

## The 60-second version

You only need **Docker** installed and running.

```bash
git clone https://github.com/73azn/fabric-projects-network.git
cd fabric-projects-network
./pn start --download-fabric       # Windows PowerShell: .\pn.ps1 start --download-fabric
```

When it prints `Everything is up`, the API is at **http://localhost:4000**:

```bash
curl -s http://localhost:4000/health
docs/examples/crud-demo.sh         # Windows PowerShell: .\docs\examples\crud-demo.ps1
./pn stop                          # stop (your data is kept)
```
