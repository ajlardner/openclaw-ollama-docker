# =============================================================================
# OpenClaw + Ollama Docker — Setup Script (Windows PowerShell)
# =============================================================================

$ErrorActionPreference = "Stop"

$ROOT_DIR = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not $ROOT_DIR) { $ROOT_DIR = Split-Path -Parent $PSScriptRoot }
Set-Location $ROOT_DIR

function Log($msg) { Write-Host "[✓] $msg" -ForegroundColor Green }
function Info($msg) { Write-Host "[i] $msg" -ForegroundColor Cyan }
function Warn($msg) { Write-Host "[!] $msg" -ForegroundColor Yellow }

Write-Host ""
Write-Host "╔═══════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   OpenClaw + Ollama Docker Setup          ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------------------
# Check Docker
# ---------------------------------------------------------------------------
try { docker compose version | Out-Null }
catch { Write-Host "[✗] Docker Compose v2 is required." -ForegroundColor Red; exit 1 }
Log "Docker Compose found"

# ---------------------------------------------------------------------------
# Create .env
# ---------------------------------------------------------------------------
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Log "Created .env from template"
} else {
    Info ".env already exists"
}

# ---------------------------------------------------------------------------
# GPU detection
# ---------------------------------------------------------------------------
$hasGPU = $false
$profileFlags = ""

try {
    nvidia-smi | Out-Null
    $hasGPU = $true
    Log "NVIDIA GPU detected"
} catch {
    Info "No NVIDIA GPU detected — running CPU-only"
}

if ($hasGPU) {
    $useGPU = Read-Host "Use GPU acceleration? [Y/n]"
    if ($useGPU -eq "" -or $useGPU -match "^[Yy]") {
        $profileFlags = "--profile gpu"
        Log "GPU profile enabled"
    }
}

# ---------------------------------------------------------------------------
# Model selection
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "Select a model size:"
Write-Host "  1) Minimal  — phi:3.8b     (~2 GB, fast, 8GB+ RAM)"
Write-Host "  2) Standard — qwen3-coder  (~5 GB, balanced, 16GB+ RAM)"
Write-Host "  3) Large    — glm-4.7      (~8 GB, high quality, 32GB+ RAM)"
Write-Host "  4) Custom   — enter your own model name"
Write-Host ""
$choice = Read-Host "Choice [2]"
if ($choice -eq "") { $choice = "2" }

switch ($choice) {
    "1" { $model = "phi:3.8b" }
    "2" { $model = "qwen3-coder" }
    "3" { $model = "glm-4.7" }
    "4" { $model = Read-Host "Model name" }
    default { $model = "qwen3-coder" }
}

(Get-Content .env) -replace "^OLLAMA_MODELS=.*", "OLLAMA_MODELS=$model" | Set-Content .env
Log "Selected model: $model"

# ---------------------------------------------------------------------------
# Create data directories
# ---------------------------------------------------------------------------
New-Item -ItemType Directory -Force -Path "data/openclaw-config" | Out-Null
New-Item -ItemType Directory -Force -Path "data/openclaw-workspace" | Out-Null
New-Item -ItemType Directory -Force -Path "data/ollama-models" | Out-Null
New-Item -ItemType Directory -Force -Path "data/agents" | Out-Null
New-Item -ItemType Directory -Force -Path "data/logs" | Out-Null
Log "Data directories created"

# ---------------------------------------------------------------------------
# Build and start
# ---------------------------------------------------------------------------
Write-Host ""
Info "Building OpenClaw image..."
docker build -t openclaw:local -f Dockerfile.openclaw .
Log "OpenClaw image built"

Write-Host ""
Info "Starting services..."
$cmd = "docker compose $profileFlags up -d"
Invoke-Expression $cmd
Log "Services started"

# Wait for Ollama
Info "Waiting for Ollama..."
for ($i = 0; $i -lt 30; $i++) {
    try {
        Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -TimeoutSec 2 | Out-Null
        break
    } catch { Start-Sleep -Seconds 2 }
}
Log "Ollama ready"

# Pull model
Write-Host ""
Info "Pulling model: $model..."
docker compose --profile admin run --rm ollama-admin pull $model
Log "Model pulled"

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "╔═══════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║   Setup Complete!                         ║" -ForegroundColor Green
Write-Host "╚═══════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  Dashboard:  http://localhost:9090/dashboard"
Write-Host "  Ollama API: http://localhost:11434"
Write-Host ""
Write-Host "  Next steps:"
Write-Host "    1. Edit agents.yml with your agent definitions"
Write-Host "    2. Add Discord bot tokens to .env"
Write-Host "    3. Run: make agents-gen"
Write-Host "    4. Run: make launch"
Write-Host ""
