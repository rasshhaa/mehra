# One-shot Render deploy helper (requires Render account + API key once)
# Usage:
#   $env:RENDER_API_KEY = "rnd_..."   # from https://dashboard.render.com/u/settings#api-keys
#   .\scripts\deploy-render.ps1

$ErrorActionPreference = "Stop"
$MehraRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $MehraRoot

if (-not $env:RENDER_API_KEY) {
    Write-Host ""
    Write-Host "No RENDER_API_KEY found." -ForegroundColor Yellow
    Write-Host "1. Open https://dashboard.render.com/select-repo?type=blueprint"
    Write-Host "2. Connect GitHub repo: rasshhaa/mehra"
    Write-Host "3. Set Root Directory to: mehra"
    Write-Host "4. Add env vars when prompted: GROQ_API_KEY, ROBOFLOW_API_KEY, FIREBASE_SERVICE_ACCOUNT_JSON"
    Write-Host "5. Use Standard plan (2 GB RAM) so engine audio works"
    Write-Host ""
    Write-Host "Or create an API key and re-run:"
    Write-Host '  $env:RENDER_API_KEY = "rnd_..."'
    Write-Host "  .\scripts\deploy-render.ps1"
    exit 1
}

Write-Host "Render API deploy via Blueprint requires the repo on GitHub with render.yaml in mehra/."
Write-Host "Push latest mehra/ to GitHub, then open:"
Write-Host "https://dashboard.render.com/select-repo?type=blueprint" -ForegroundColor Cyan
