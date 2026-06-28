# Deploy AutoVault to Render (full stack, engine audio included)
# Option A: https://render.com/deploy?repo=https://github.com/rasshhaa/mehra
# Option B: set RENDER_API_KEY then run this script

$ErrorActionPreference = "Stop"
$MehraRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $MehraRoot

$DeployUrl = "https://render.com/deploy?repo=https://github.com/rasshhaa/mehra"

function Read-DotEnv([string]$Path) {
    $vars = @{}
    if (-not (Test-Path $Path)) { return $vars }
    Get-Content $Path | ForEach-Object {
        if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
            $vars[$Matches[1]] = $Matches[2].Trim()
        }
    }
    return $vars
}

$envFile = Join-Path $MehraRoot "backend\.env"
$saFile  = Join-Path $MehraRoot "backend\serviceAccountKey.json"
$dotenv  = Read-DotEnv $envFile

if (-not $env:RENDER_API_KEY) {
    Write-Host ""
    Write-Host "=== Render full deploy ===" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Open this link and click Deploy:" -ForegroundColor Green
    Write-Host $DeployUrl
    Write-Host ""
    Write-Host '  Branch: prototype5'
    Write-Host '  Plan: Standard - 2 GB RAM for engine audio'
    Write-Host ""
    Write-Host "Environment variables:"
    Write-Host "  GROQ_API_KEY"
    Write-Host "  ROBOFLOW_API_KEY"
    Write-Host "  USE_FIRESTORE=1"
    Write-Host "  FIREBASE_PRIMARY_PROJECT_ID=mehra-b3a7c"
    Write-Host "  FIREBASE_SERVICE_ACCOUNT_JSON = full serviceAccountKey.json"
    Write-Host ""
    Write-Host "After deploy, add your onrender.com URL to Firebase Authorized domains."
    Write-Host ""
    Write-Host "Or set RENDER_API_KEY and re-run for automated deploy."
    Start-Process $DeployUrl
    exit 0
}

if (-not (Test-Path $saFile)) {
    Write-Error "Missing backend/serviceAccountKey.json"
}

$firebaseJson = Get-Content $saFile -Raw
$groq = $dotenv["GROQ_API_KEY"]
$roboflow = $dotenv["ROBOFLOW_API_KEY"]

if (-not $groq -or -not $roboflow) {
    Write-Error "GROQ_API_KEY and ROBOFLOW_API_KEY must be in backend/.env"
}

Write-Host "Fetching Render workspace..." -ForegroundColor Cyan
$headers = @{
    Authorization = "Bearer $env:RENDER_API_KEY"
    Accept        = "application/json"
    "Content-Type" = "application/json"
}

$owners = Invoke-RestMethod -Uri "https://api.render.com/v1/owners?limit=20" -Headers $headers -Method Get
if (-not $owners -or $owners.Count -eq 0) {
    Write-Error "No Render workspace found for this API key."
}
$ownerId = $owners[0].owner.id
Write-Host "Workspace: $($owners[0].owner.name) ($ownerId)"

$body = @{
    type       = "web_service"
    name       = "autovault"
    ownerId    = $ownerId
    repo       = "https://github.com/rasshhaa/mehra"
    branch     = "prototype5"
    autoDeploy = "yes"
    serviceDetails = @{
        env               = "docker"
        plan              = "standard"
        region            = "frankfurt"
        healthCheckPath   = "/health"
        envSpecificDetails = @{
            dockerfilePath = "./Dockerfile"
            dockerContext  = "."
        }
    }
    envVars = @(
        @{ key = "PYTHONUNBUFFERED"; value = "1" }
        @{ key = "USE_FIRESTORE"; value = "1" }
        @{ key = "FIREBASE_PRIMARY_PROJECT_ID"; value = "mehra-b3a7c" }
        @{ key = "HF_HOME"; value = "/app/backend/.cache/huggingface" }
        @{ key = "GROQ_API_KEY"; value = $groq }
        @{ key = "ROBOFLOW_API_KEY"; value = $roboflow }
        @{ key = "FIREBASE_SERVICE_ACCOUNT_JSON"; value = $firebaseJson }
    )
} | ConvertTo-Json -Depth 10

Write-Host "Creating Render web service..." -ForegroundColor Cyan
try {
    $service = Invoke-RestMethod -Uri "https://api.render.com/v1/services" -Headers $headers -Method Post -Body $body
} catch {
    $detail = $_.ErrorDetails.Message
    if ($detail -match "already exists|duplicate|409") {
        Write-Host "Service may already exist. Check https://dashboard.render.com" -ForegroundColor Yellow
    }
    throw
}

$url = $service.service.serviceDetails.url
if (-not $url) { $url = "https://dashboard.render.com" }

Write-Host ""
Write-Host "Deploy started!" -ForegroundColor Green
Write-Host "Service: $($service.service.name)"
Write-Host "URL: $url"
Write-Host ""
Write-Host "Build takes 15-25 minutes. Watch logs in Render dashboard."
Write-Host "Then add the onrender.com URL to Firebase Authorized domains."
