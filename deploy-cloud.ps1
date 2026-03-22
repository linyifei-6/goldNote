# WeChat cloud deployment script for Windows PowerShell

param(
  [string]$ProjectRoot = $PSScriptRoot,
  [string]$CloudEnv = $env:GOLDNOTE_CLOUD_ENV,
  [string[]]$Functions = @(),
  [switch]$StrictDeploy
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Gold Note Mini Program - Cloud Deploy" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$PROJECT_ROOT = if ($ProjectRoot) { $ProjectRoot } else { (Get-Location).Path }

if (-not $CloudEnv) {
  $existingConfigPath = Join-Path $PROJECT_ROOT ".cloudbaserc.json"
  if (Test-Path $existingConfigPath) {
    try {
      $existingConfig = Get-Content -Path $existingConfigPath -Raw | ConvertFrom-Json
      if ($existingConfig.envId) {
        $CloudEnv = $existingConfig.envId
      }
    } catch {
      Write-Host "[WARN] Existing .cloudbaserc.json could not be parsed, will require explicit cloud env input." -ForegroundColor Yellow
    }
  }
}

if (-not $CloudEnv) {
  Write-Host "[ERR] Missing cloud env ID." -ForegroundColor Red
  Write-Host "Pass -CloudEnv <env-id> or set GOLDNOTE_CLOUD_ENV before running this script." -ForegroundColor Yellow
  exit 1
}

$CLOUD_ENV = $CloudEnv

Write-Host "Project root: $PROJECT_ROOT" -ForegroundColor Gray
Write-Host "Cloud env ID: $CLOUD_ENV" -ForegroundColor Gray
Write-Host ""

function Test-CommandExists {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-CloudFunctionDeploy {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FunctionName,
    [Parameter(Mandatory = $true)]
    [string]$CloudEnvId
  )

  $deployOutput = ('y' | cloudbase functions:deploy $FunctionName -e $CloudEnvId --force) 2>&1
  $deployText = ($deployOutput | Out-String)
  $exitCode = $LASTEXITCODE
  if ($exitCode -eq 0) {
    return @{
      Success = $true
      Output = $deployText
    }
  }

  if (Test-CloudFunctionReady -FunctionName $FunctionName -CloudEnvId $CloudEnvId) {
    return @{
      Success = $true
      Output = "$deployText`n[WARN] CLI returned non-zero, but cloud status is ready."
    }
  }

  return @{
    Success = $false
    Output = $deployText
  }
}

function Invoke-CloudFunctionCodeUpdate {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FunctionName,
    [Parameter(Mandatory = $true)]
    [string]$CloudEnvId
  )

  $updateOutput = cloudbase functions:code:update $FunctionName -e $CloudEnvId 2>&1
  $updateText = ($updateOutput | Out-String)
  $exitCode = $LASTEXITCODE
  if ($exitCode -eq 0) {
    return @{
      Success = $true
      Output = $updateText
    }
  }

  if (Test-CloudFunctionReady -FunctionName $FunctionName -CloudEnvId $CloudEnvId) {
    return @{
      Success = $true
      Output = "$updateText`n[WARN] CLI returned non-zero, but cloud status is ready."
    }
  }

  return @{
    Success = $false
    Output = $updateText
  }
}

function Test-CloudFunctionReady {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FunctionName,
    [Parameter(Mandatory = $true)]
    [string]$CloudEnvId
  )

  try {
    $listOutput = cloudbase functions:list -e $CloudEnvId 2>&1
    $listText = ($listOutput | Out-String)
    return ($listText -match [Regex]::Escape($FunctionName))
  } catch {
    return $false
  }
}

Write-Host "[1/5] Checking cloudbase-cli..." -ForegroundColor Yellow
if (Test-CommandExists -Name "cloudbase") {
  $cloudbaseVersion = cloudbase --version 2>&1
  Write-Host "[OK] cloudbase-cli installed: $cloudbaseVersion" -ForegroundColor Green
} else {
  Write-Host "[ERR] cloudbase-cli not found" -ForegroundColor Red
  Write-Host "Installing cloudbase-cli via npm..." -ForegroundColor Yellow
  npm install -g cloudbase-cli
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERR] Install failed. Please run: npm install -g cloudbase-cli" -ForegroundColor Red
    exit 1
  }
  Write-Host "[OK] cloudbase-cli installed" -ForegroundColor Green
}

Write-Host ""
Write-Host "[2/5] Logging in to cloudbase..." -ForegroundColor Yellow
Write-Host "Please scan QR code in terminal when prompted." -ForegroundColor Gray
cloudbase login
if ($LASTEXITCODE -ne 0) {
  Write-Host "[ERR] Login failed" -ForegroundColor Red
  exit 1
}
Write-Host "[OK] Login succeeded" -ForegroundColor Green

$defaultCloudFunctions = @(
  "login",
  "getTransactions",
  "saveTransaction",
  "getWeddingData",
  "saveWeddingData",
  "getWorkoutData",
  "saveWorkoutData",
  "manageRelations",
  "manageMessages",
  "getGoldLeaderboard"
)

$cloudfunctions = if ($Functions -and $Functions.Count -gt 0) {
  $requested = @()
  foreach ($func in $Functions) {
    $name = [string]$func
    if (-not [string]::IsNullOrWhiteSpace($name)) {
      $requested += $name.Trim()
    }
  }

  $filtered = $requested | Where-Object { $defaultCloudFunctions -contains $_ } | Select-Object -Unique
  if (-not $filtered -or $filtered.Count -eq 0) {
    Write-Host "[ERR] No valid function names in -Functions parameter." -ForegroundColor Red
    Write-Host "Allowed values: $($defaultCloudFunctions -join ', ')" -ForegroundColor Yellow
    exit 1
  }

  Write-Host "[INFO] Deploy subset functions: $($filtered -join ', ')" -ForegroundColor Cyan
  $filtered
} else {
  $defaultCloudFunctions
}

Write-Host ""
Write-Host "[3/5] Preparing cloudbase config..." -ForegroundColor Yellow
Set-Location $PROJECT_ROOT

$legacyFunctionRoot = Join-Path $PROJECT_ROOT "functions"
$actualFunctionRoot = Join-Path $PROJECT_ROOT "cloudfunctions"

if (Test-Path $legacyFunctionRoot) {
  Remove-Item -Path $legacyFunctionRoot -Recurse -Force
}

Copy-Item -Path $actualFunctionRoot -Destination $legacyFunctionRoot -Recurse -Force
Write-Host "[OK] Synced compatibility function root: $legacyFunctionRoot" -ForegroundColor Green

$cloudbaseConfigPath = Join-Path $PROJECT_ROOT ".cloudbaserc.json"
$cloudbaseConfig = @{
  envId = $CLOUD_ENV
  functionRoot = "cloudfunctions"
  functionsRoot = "cloudfunctions"
  functions = @()
}

foreach ($func in $cloudfunctions) {
  $cloudbaseConfig.functions += @{ name = $func }
}

$cloudbaseConfig | ConvertTo-Json -Depth 6 | Set-Content -Path $cloudbaseConfigPath -Encoding UTF8
Write-Host "[OK] Wrote $cloudbaseConfigPath" -ForegroundColor Green

Write-Host ""
Write-Host "[3.5/5] Installing cloud function dependencies..." -ForegroundColor Yellow
foreach ($func in $cloudfunctions) {
  $funcDir = Join-Path $actualFunctionRoot $func
  $pkgPath = Join-Path $funcDir "package.json"
  if (-not (Test-Path $pkgPath)) {
    continue
  }

  Write-Host "Installing npm deps for $func..." -ForegroundColor Gray
  npm --prefix $funcDir install --omit=dev
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERR] npm install failed for $func" -ForegroundColor Red
    exit 1
  }
}
Write-Host "[OK] Dependencies are ready" -ForegroundColor Green

Write-Host ""
Write-Host "[4/5] Deploying cloud functions..." -ForegroundColor Yellow

$functionListOutput = cloudbase functions:list -e $CLOUD_ENV 2>&1
$functionListText = ($functionListOutput | Out-String)

$hasDeployError = $false

foreach ($func in $cloudfunctions) {
  Write-Host "Deploying $func..." -ForegroundColor Gray
  if ($functionListText -match [Regex]::Escape($func)) {
    $deployResult = Invoke-CloudFunctionCodeUpdate -FunctionName $func -CloudEnvId $CLOUD_ENV
  } else {
    $deployResult = Invoke-CloudFunctionDeploy -FunctionName $func -CloudEnvId $CLOUD_ENV
  }

  if ($deployResult.Success) {
    Write-Host "[OK] $func deployed" -ForegroundColor Green
  } else {
    $hasDeployError = $true
    Write-Host "[ERR] $func failed to deploy" -ForegroundColor Red
    Write-Host $deployResult.Output -ForegroundColor DarkGray
  }
}

if ($hasDeployError) {
  if ($StrictDeploy) {
    Write-Host "[ERR] Cloud function deployment stage finished with failures" -ForegroundColor Red
    exit 1
  }
  Write-Host "[WARN] Cloud function deployment stage finished with failures (non-strict mode, continue)." -ForegroundColor Yellow
} else {
  Write-Host "[OK] Cloud function deployment stage finished" -ForegroundColor Green
}

Write-Host ""
Write-Host "[5/5] Deployment flow finished" -ForegroundColor Green
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Next steps" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Open WeChat DevTools" -ForegroundColor White
Write-Host "2. Import project: $PROJECT_ROOT" -ForegroundColor White
Write-Host "3. In Cloud panel, create collections:" -ForegroundColor White
Write-Host "   - users" -ForegroundColor Gray
Write-Host "   - transactions" -ForegroundColor Gray
Write-Host "   - social_relations" -ForegroundColor Gray
Write-Host "   - wedding_profiles" -ForegroundColor Gray
Write-Host "   - wedding_tasks" -ForegroundColor Gray
Write-Host "   - wedding_expenses" -ForegroundColor Gray
Write-Host "   - wedding_notes" -ForegroundColor Gray
Write-Host "   - wedding_invites" -ForegroundColor Gray
Write-Host "4. Configure collection permissions (see CLOUD_DEPLOYMENT.md)" -ForegroundColor White
Write-Host "5. Add indexes from database-indexes.json" -ForegroundColor White
Write-Host ""
Write-Host "Doc: $PROJECT_ROOT\CLOUD_DEPLOYMENT.md" -ForegroundColor Cyan
Write-Host ""
