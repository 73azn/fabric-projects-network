# SPDX-License-Identifier: Apache-2.0
#
# Launcher for Windows PowerShell / PowerShell 7. The only requirement is Docker Desktop (Linux containers).
#   .\pn.ps1 start            build and start everything (network, channel, chaincode, REST API)
#   .\pn.ps1 stop             stop (data is kept)       .\pn.ps1 stop --clean   also delete ledgers and certificates
#   .\pn.ps1 status | logs | monitoring | shell | net  (see: .\pn.ps1 help)
# From cmd.exe use pn.cmd.
$ErrorActionPreference = 'Stop'

$Root      = Split-Path -Parent $MyInvocation.MyCommand.Path
$Image     = 'projects-network-cli:local'
$Project   = if ($env:PN_PROJECT) { $env:PN_PROJECT } else { 'fabricprojects' }
$Workspace = if ($env:PN_WORKSPACE_VOLUME) { $env:PN_WORKSPACE_VOLUME } else { "${Project}_workspace" }

function Fail([string]$Message) {
    [Console]::Error.WriteLine("pn: $Message")
    exit 1
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail 'Docker is not installed (https://docs.docker.com/get-docker/)' }
docker version --format '{{.Server.Version}}' *> $null
if ($LASTEXITCODE -ne 0) { Fail 'The Docker daemon is not running. Start Docker Desktop (Linux containers) and try again.' }

# (Re)build the orchestrator image when it is missing or its files changed
$ms = New-Object System.IO.MemoryStream
foreach ($f in (Get-ChildItem -File (Join-Path $Root 'orchestrator') | Sort-Object { $_.Name })) {
    $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
    $ms.Write($bytes, 0, $bytes.Length)
}
$sha  = [System.Security.Cryptography.SHA256]::Create()
$hash = ([System.BitConverter]::ToString($sha.ComputeHash($ms.ToArray())) -replace '-', '').ToLower().Substring(0, 16)

$labels = (docker image inspect $Image --format '{{.Config.Labels}}' 2>$null) -join ''
if ($LASTEXITCODE -ne 0 -or -not $labels.Contains("pn.hash:$hash")) {
    [Console]::Error.WriteLine('pn: building the orchestrator image (first run, needs internet) ...')
    docker build -q --label "pn.hash=$hash" -t $Image (Join-Path $Root 'orchestrator') | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail 'could not build the orchestrator image' }
}

docker volume create $Workspace | Out-Null

$tty = '-i'
if (-not [Console]::IsInputRedirected -and -not [Console]::IsOutputRedirected) { $tty = '-it' }

$dockerArgs = @(
    'run', '--rm', $tty,
    '-v', '/var/run/docker.sock:/var/run/docker.sock',
    '-v', "${Root}:/src:ro",
    '-v', "${Workspace}:/work",
    '-e', "PN_PROJECT=$Project",
    '-e', "PN_WORKSPACE_VOLUME=$Workspace",
    $Image
) + $args

& docker @dockerArgs
exit $LASTEXITCODE
