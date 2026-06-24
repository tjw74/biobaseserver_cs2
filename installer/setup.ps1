# BioBase CS2 Server — Post-install orchestration
# Called by the NSIS installer after file extraction and .env generation.
param(
    [string]$InstallDir
)

$ErrorActionPreference = "Stop"
$composeFile = Join-Path $InstallDir "bb_cs2_server\docker-compose.yml"

function Write-Status($msg) {
    Write-Host "`n>> $msg" -ForegroundColor Cyan
}

function Test-Docker {
    try {
        $null = & docker version 2>&1
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

function Test-DockerRunning {
    try {
        $info = & docker info 2>&1
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

function Install-DockerDesktop {
    Write-Status "Docker Desktop not found — downloading installer..."
    $installerUrl = "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe"
    $installerPath = Join-Path $env:TEMP "DockerDesktopInstaller.exe"

    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing

    Write-Status "Installing Docker Desktop (this takes a few minutes)..."
    Start-Process -FilePath $installerPath -ArgumentList "install", "--quiet", "--accept-license" -Wait

    Remove-Item $installerPath -Force -ErrorAction SilentlyContinue

    Write-Status "Docker Desktop installed. Starting it..."
    $dockerExe = "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
    if (Test-Path $dockerExe) {
        Start-Process $dockerExe
    }
}

function Wait-ForDocker {
    Write-Status "Waiting for Docker engine to be ready..."
    $timeout = 120
    $elapsed = 0
    while ($elapsed -lt $timeout) {
        if (Test-DockerRunning) {
            Write-Host "  Docker is ready." -ForegroundColor Green
            return $true
        }
        Start-Sleep -Seconds 5
        $elapsed += 5
        Write-Host "  Waiting... ($elapsed/$timeout sec)"
    }
    Write-Host "  Docker did not start within $timeout seconds." -ForegroundColor Red
    Write-Host "  Open Docker Desktop manually, then run this script again." -ForegroundColor Yellow
    return $false
}

# ── Main ──

if (-not (Test-Path $composeFile)) {
    Write-Host "ERROR: docker-compose.yml not found at $composeFile" -ForegroundColor Red
    exit 1
}

# Docker check
if (-not (Test-Docker)) {
    Install-DockerDesktop
}

if (-not (Test-DockerRunning)) {
    $ready = Wait-ForDocker
    if (-not $ready) {
        Write-Host "`nDocker is not running. Please start Docker Desktop and run:" -ForegroundColor Yellow
        Write-Host "  docker compose -f `"$composeFile`" up -d --build" -ForegroundColor White
        Read-Host "Press Enter to exit"
        exit 1
    }
}

# Create clips directory
$clipsDir = Join-Path $InstallDir "data\clips"
if (-not (Test-Path $clipsDir)) {
    New-Item -ItemType Directory -Path $clipsDir -Force | Out-Null
}

# Build and start
Write-Status "Building containers (first run downloads ~30 GB of CS2 server files)..."
Write-Status "This will take a while. Do not close this window."

Set-Location (Join-Path $InstallDir "bb_cs2_server")
& docker compose -f $composeFile up -d --build 2>&1 | ForEach-Object { Write-Host $_ }

if ($LASTEXITCODE -ne 0) {
    Write-Host "`nContainer build failed. Check Docker Desktop is running and try:" -ForegroundColor Red
    Write-Host "  cd `"$(Join-Path $InstallDir "bb_cs2_server")`"" -ForegroundColor White
    Write-Host "  docker compose up -d --build" -ForegroundColor White
    Read-Host "Press Enter to exit"
    exit 1
}

# Health check
Write-Status "Waiting for CS2 server to start..."
$timeout = 600
$elapsed = 0
$ready = $false
while ($elapsed -lt $timeout) {
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect("127.0.0.1", 27015)
        $tcp.Close()
        $ready = $true
        break
    } catch {
        Start-Sleep -Seconds 5
        $elapsed += 5
        if ($elapsed % 30 -eq 0) {
            Write-Host "  Still starting... ($elapsed sec)"
        }
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  BioBase CS2 Server is running!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Game server:  localhost:27015" -ForegroundColor White
Write-Host "  Dashboard:    http://localhost:8780/admin" -ForegroundColor White
Write-Host ""
if (-not $ready) {
    Write-Host "  (Server may still be downloading CS2 files.)" -ForegroundColor Yellow
    Write-Host "  (Check: docker compose -f `"$composeFile`" logs -f bb_cs2_server)" -ForegroundColor Yellow
}
Write-Host ""
Read-Host "Press Enter to close"
