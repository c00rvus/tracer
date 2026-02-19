param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,
  [string]$ProductName = "Tracer",
  [string]$ProcessName = "Tracer",
  [string]$ServiceName = "",
  [switch]$NoSilent
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host "[TracerUpdater] $Message"
}

function Split-CommandLine {
  param([string]$CommandLine)

  $trimmed = ($CommandLine ?? "").Trim()
  if ([string]::IsNullOrWhiteSpace($trimmed)) {
    return @{
      FilePath = ""
      Arguments = ""
    }
  }

  if ($trimmed.StartsWith('"')) {
    $quotedMatch = [regex]::Match($trimmed, '^"([^"]+)"\s*(.*)$')
    if ($quotedMatch.Success) {
      return @{
        FilePath = $quotedMatch.Groups[1].Value
        Arguments = $quotedMatch.Groups[2].Value
      }
    }
  }

  $parts = $trimmed.Split(" ", 2, [System.StringSplitOptions]::None)
  return @{
    FilePath = $parts[0]
    Arguments = if ($parts.Count -gt 1) { $parts[1] } else { "" }
  }
}

function Get-UninstallEntry {
  param([string]$DisplayName)

  $paths = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
  )

  $entries = @()
  foreach ($path in $paths) {
    $entries += Get-ItemProperty -Path $path -ErrorAction SilentlyContinue | Where-Object {
      $_.DisplayName -and $_.UninstallString -and $_.DisplayName -like "$DisplayName*"
    }
  }

  if ($entries.Count -eq 0) {
    return $null
  }

  $sorted = $entries | Sort-Object -Property @{
    Expression = {
      try {
        [version]($_.DisplayVersion ?? "0.0.0.0")
      } catch {
        [version]"0.0.0.0"
      }
    }
  }, @{
    Expression = { $_.InstallDate ?? "" }
  } -Descending

  return $sorted | Select-Object -First 1
}

function Resolve-InstallDirectory {
  param([psobject]$Entry)

  if (-not $Entry) {
    return $null
  }

  if ($Entry.InstallLocation -and (Test-Path -LiteralPath $Entry.InstallLocation)) {
    return $Entry.InstallLocation
  }

  if ($Entry.DisplayIcon) {
    $iconPath = ($Entry.DisplayIcon -replace ",\d+$", "").Trim('"')
    if (Test-Path -LiteralPath $iconPath) {
      return Split-Path -Path $iconPath -Parent
    }
  }

  if ($Entry.UninstallString) {
    $parsed = Split-CommandLine -CommandLine $Entry.UninstallString
    if ($parsed.FilePath -and (Test-Path -LiteralPath $parsed.FilePath)) {
      return Split-Path -Path $parsed.FilePath -Parent
    }
  }

  return $null
}

function Stop-TargetProcess {
  param([string]$Name)

  if ([string]::IsNullOrWhiteSpace($Name)) {
    return
  }

  $running = Get-Process -Name $Name -ErrorAction SilentlyContinue
  if ($running) {
    Write-Step "Stopping running process '$Name'."
    $running | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
  }
}

function Stop-TargetService {
  param([string]$Name)

  if ([string]::IsNullOrWhiteSpace($Name)) {
    return
  }

  $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
  if ($service -and $service.Status -ne "Stopped") {
    Write-Step "Stopping service '$Name'."
    Stop-Service -Name $Name -Force -ErrorAction Stop
    $service.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(15))
  }
}

function Ensure-SilentArgs {
  param([string]$Arguments)

  if ($NoSilent) {
    return $Arguments
  }

  if ($Arguments -match '(^|\s)(/S|/s|/quiet|/qn)(\s|$)') {
    return $Arguments
  }

  return "$Arguments /S".Trim()
}

function Invoke-Uninstall {
  param([psobject]$Entry)

  if (-not $Entry) {
    return
  }

  Write-Step "Existing installation detected: $($Entry.DisplayName) $($Entry.DisplayVersion)."

  $uninstallString = $Entry.UninstallString
  if ([string]::IsNullOrWhiteSpace($uninstallString)) {
    Write-Step "No uninstall command found in registry. Skipping uninstall."
    return
  }

  $parsed = Split-CommandLine -CommandLine $uninstallString
  $filePath = $parsed.FilePath
  $arguments = $parsed.Arguments
  if ([string]::IsNullOrWhiteSpace($filePath)) {
    throw "Uninstall command could not be parsed: $uninstallString"
  }

  if ($filePath -match '(?i)msiexec(\.exe)?$') {
    $productCodeMatch = [regex]::Match($uninstallString, '\{[0-9A-Fa-f\-]{36}\}')
    if ($NoSilent) {
      $msiArgs = if ($productCodeMatch.Success) { "/x $($productCodeMatch.Value)" } else { $arguments }
    } else {
      $msiArgs = if ($productCodeMatch.Success) {
        "/x $($productCodeMatch.Value) /qn /norestart"
      } else {
        "$arguments /qn /norestart"
      }
    }

    $process = Start-Process -FilePath "msiexec.exe" -ArgumentList $msiArgs -Wait -PassThru
    if ($process.ExitCode -notin @(0, 1605, 1614)) {
      throw "Uninstall failed with exit code $($process.ExitCode)."
    }
    return
  }

  $runArgs = Ensure-SilentArgs -Arguments $arguments
  $process = Start-Process -FilePath $filePath -ArgumentList $runArgs -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "Uninstall failed with exit code $($process.ExitCode)."
  }
}

$resolvedInstallerPath = (Resolve-Path -LiteralPath $InstallerPath).Path
Write-Step "Installer file: $resolvedInstallerPath"

$entry = Get-UninstallEntry -DisplayName $ProductName
$installDirectory = Resolve-InstallDirectory -Entry $entry
if ($installDirectory) {
  Write-Step "Existing install directory: $installDirectory"
}

Stop-TargetService -Name $ServiceName
Stop-TargetProcess -Name $ProcessName

Invoke-Uninstall -Entry $entry

$installArgs = @()
if (-not $NoSilent) {
  $installArgs += "/S"
}
if ($installDirectory) {
  # NSIS requires /D to be the last argument.
  $installArgs += "/D=$installDirectory"
}
$installArgLine = ($installArgs -join " ").Trim()

Write-Step "Installing updated package."
if ([string]::IsNullOrWhiteSpace($installArgLine)) {
  $installProcess = Start-Process -FilePath $resolvedInstallerPath -Wait -PassThru
} else {
  $installProcess = Start-Process -FilePath $resolvedInstallerPath -ArgumentList $installArgLine -Wait -PassThru
}

if ($installProcess.ExitCode -ne 0) {
  throw "Install failed with exit code $($installProcess.ExitCode)."
}

Write-Step "Update finished successfully."
