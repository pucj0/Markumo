param([string]$InstallerPath)
$ErrorActionPreference = 'Stop'
$projectPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (!$InstallerPath) { $InstallerPath = Join-Path $projectPath 'src-tauri/target/release/bundle/nsis/LightEdit_0.1.0_x64-setup.exe' }
$InstallerPath = (Resolve-Path -LiteralPath $InstallerPath).Path
if (Get-Process lightedit -ErrorAction SilentlyContinue) { throw 'Save and close existing LightEdit before installer verification.' }
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\LightEdit'
$machineKey = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\LightEdit'
if ((Test-Path $uninstallKey) -or (Test-Path $machineKey)) { throw 'Existing installation must remain intact; use a clean Windows user for this test.' }
$outputPath = Join-Path $projectPath ('test-results/installer/' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
$installPath = [IO.Path]::GetFullPath((Join-Path $outputPath 'installed'))
$safeRoot = [IO.Path]::GetFullPath((Join-Path $projectPath 'test-results/installer')) + [IO.Path]::DirectorySeparatorChar
if (!$installPath.StartsWith($safeRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid isolated installation path.' }
New-Item -ItemType Directory -Path $outputPath | Out-Null
New-Item -ItemType Directory -Path $installPath | Out-Null
# This disposable fixture may inherit a Low MIC label from generated directories.
# Set only the already validated fixture to Medium, never user folders or app data.
& icacls.exe $installPath /setintegritylevel '(OI)(CI)M' | Out-Null
if ($LASTEXITCODE) { throw 'Cannot prepare isolated installation integrity level.' }
$dataPath = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'com.lightedit.app'
if ((Test-Path $dataPath) -and ((Get-Item -LiteralPath $dataPath).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Do not mutate redirected user app metadata.' }
$metadata = @()
foreach ($name in @('files.json','editor-settings.json','workspaces.json')) {
  $path = Join-Path $dataPath $name
  $exists = Test-Path -LiteralPath $path
  if ($exists -and ((Get-Item -LiteralPath $path).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Do not mutate redirected metadata files.' }
  $metadata += [pscustomobject]@{ Path=$path; Exists=$exists; Bytes=$(if($exists){[IO.File]::ReadAllBytes($path)}else{$null}) }
}
$productKey = 'HKCU:\Software\lightedit\LightEdit'
$productExisted = Test-Path $productKey
$parentExisted = Test-Path 'HKCU:\Software\lightedit'
$registryBackup = Join-Path $outputPath 'installer-registry-before.reg'
if ($productExisted) { & reg.exe export 'HKCU\Software\lightedit\LightEdit' $registryBackup /y | Out-Null; if($LASTEXITCODE){throw 'Cannot back up installer metadata.'} }
$report = [ordered]@{installer=$InstallerPath;installPath=$installPath;installExit=$null;uninstallExit=$null;installedBinaryMatches=$false;metadataRestored=$false;failure=$null}
$installed = $false
try {
  # /NS avoids desktop/start-menu shortcuts. /D is last, as required by NSIS.
  $installProcess = Start-Process -FilePath $InstallerPath -ArgumentList @('/S','/NS',"/D=$installPath") -WindowStyle Hidden -PassThru
  if (!$installProcess.WaitForExit(60000)) { $installProcess.Kill(); throw 'Installer timeout.' }
  $report.installExit=$installProcess.ExitCode
  if($report.installExit -ne 0){throw "Installer failed: $($report.installExit)"}
  $installed=$true
  $installedExe=Join-Path $installPath 'lightedit.exe'
  if(!(Test-Path -LiteralPath $installedExe)){throw 'Installed executable missing.'}
  $releaseExe=Join-Path $projectPath 'src-tauri/target/release/lightedit.exe'
  # Tauri patches its fixed-width bundle marker only in the bundled binary, then
  # restores the release source executable. All remaining bytes must match.
  $releaseBytes=[IO.File]::ReadAllBytes($releaseExe)
  $marker='__TAURI_BUNDLE_TYPE_VAR_UNK'
  $binaryText=[Text.Encoding]::ASCII.GetString($releaseBytes)
  $markerIndex=$binaryText.IndexOf($marker,[StringComparison]::Ordinal)
  if($markerIndex -lt 0 -or $binaryText.IndexOf($marker,$markerIndex+1,[StringComparison]::Ordinal) -ge 0){throw 'Unexpected Tauri bundle marker; do not accept binary mismatch.'}
  $patched=[Text.Encoding]::ASCII.GetBytes('__TAURI_BUNDLE_TYPE_VAR_NSS')
  [Buffer]::BlockCopy($patched,0,$releaseBytes,$markerIndex,$patched.Length)
  $sha=[Security.Cryptography.SHA256]::Create()
  $expectedHash=[BitConverter]::ToString($sha.ComputeHash($releaseBytes)).Replace('-','')
  $sha.Dispose()
  $report.installedBinaryMatches=(Get-FileHash -LiteralPath $installedExe).Hash -eq $expectedHash
  if(!$report.installedBinaryMatches){throw 'Installed binary differs from tested build.'}

  # Verify Windows File Associations & Context Menu registration in HKCU
  $appKey = 'HKCU:\Software\Classes\Applications\lightedit.exe'
  if (!(Test-Path $appKey)) { throw 'Registry Applications\lightedit.exe missing.' }
  $supportedTypes = 'HKCU:\Software\Classes\Applications\lightedit.exe\SupportedTypes'
  if (!(Test-Path $supportedTypes)) { throw 'SupportedTypes registry key missing.' }
  foreach ($ext in @('.txt', '.md', '.json', '.rs')) {
    if ((Get-Item $supportedTypes).GetValue($ext) -eq $null) { throw "SupportedTypes $ext missing in registry." }
  }
  $txtContextKey = 'HKCU:\Software\Classes\SystemFileAssociations\.txt\shell\LightEdit\command'
  if (!(Test-Path $txtContextKey)) { throw 'SystemFileAssociations .txt shell command missing.' }
  $regCommand = (Get-ItemProperty $txtContextKey).'(default)'
  if (!$regCommand.Contains($installedExe)) { throw "Context menu command does not point to installed exe: $regCommand" }
  $regApps = 'HKCU:\Software\RegisteredApplications'
  if ((Get-ItemProperty $regApps -ErrorAction SilentlyContinue).LightEdit -ne 'Software\LightEdit\Capabilities') { throw 'RegisteredApplications LightEdit capability mapping missing.' }
  $report.associationsVerified = $true

  $env:LIGHTEDIT_INSTALL_TEST_EXE=$installedExe
  $env:LIGHTEDIT_INSTALL_TEST_OUTPUT=$outputPath
  & node (Join-Path $PSScriptRoot 'installer-app-smoke.mjs')
  if($LASTEXITCODE){throw 'Installed application smoke failed; see app-results.json.'}
} catch { $report.failure=$_.Exception.Message; Write-Output $report.failure }
finally {
  if($installed){
    # /UPDATE preserves app data/autostart metadata. No user installation existed.
    $uninstaller=Join-Path $installPath 'uninstall.exe'
    if(Test-Path -LiteralPath $uninstaller){
      $uninstallProcess=Start-Process -FilePath $uninstaller -ArgumentList @('/S','/UPDATE') -WindowStyle Hidden -PassThru
      if(!$uninstallProcess.WaitForExit(30000)){$uninstallProcess.Kill();$report.failure='Test uninstaller timeout.'}else{$report.uninstallExit=$uninstallProcess.ExitCode}
      # The launcher exits before its temporary NSIS child completes uninstall.
      for($i=0;$i -lt 900 -and ((Test-Path $uninstallKey) -or (Test-Path (Join-Path $installPath 'lightedit.exe')));$i++){Start-Sleep -Milliseconds 100}
      if((Test-Path $uninstallKey) -or (Test-Path (Join-Path $installPath 'lightedit.exe'))){$report.failure='Isolated installation did not finish uninstalling.'}

      # Verify uninstaller cleaned up LightEdit registry associations
      if (Test-Path 'HKCU:\Software\Classes\Applications\lightedit.exe') { $report.failure = 'Uninstaller failed to remove Applications\lightedit.exe.' }
      if (Test-Path 'HKCU:\Software\LightEdit\Capabilities') { $report.failure = 'Uninstaller failed to remove LightEdit\Capabilities.' }
      if (Test-Path 'HKCU:\Software\Classes\SystemFileAssociations\.txt\shell\LightEdit') { $report.failure = 'Uninstaller failed to remove SystemFileAssociations\.txt\shell\LightEdit.' }
      if ((Get-ItemProperty 'HKCU:\Software\RegisteredApplications' -ErrorAction SilentlyContinue).LightEdit) { $report.failure = 'Uninstaller failed to remove RegisteredApplications entry.' }
    }
  }
  foreach($item in $metadata){
    if($item.Exists){[IO.File]::WriteAllBytes($item.Path,$item.Bytes)}elseif(Test-Path -LiteralPath $item.Path){Remove-Item -LiteralPath $item.Path}
  }
  $report.metadataRestored=$true
  foreach($item in $metadata){
    if($item.Exists){if([Convert]::ToBase64String([IO.File]::ReadAllBytes($item.Path)) -ne [Convert]::ToBase64String($item.Bytes)){$report.metadataRestored=$false}}
    elseif(Test-Path -LiteralPath $item.Path){$report.metadataRestored=$false}
  }
  if(!$report.metadataRestored){$report.failure='User metadata restoration verification failed.'}
  # Remove only the exact installer key whose previous contents were backed up.
  if(Test-Path $productKey){Remove-Item -LiteralPath $productKey -Recurse}
  if($productExisted){& reg.exe import $registryBackup | Out-Null;if($LASTEXITCODE){$report.failure='Cannot restore previous installer metadata.'}}
  if(!$parentExisted -and (Test-Path 'HKCU:\Software\lightedit')){$key=Get-Item 'HKCU:\Software\lightedit';if(!$key.SubKeyCount -and !$key.ValueCount){Remove-Item -LiteralPath 'HKCU:\Software\lightedit'}}
  $report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $outputPath 'installer-results.json') -Encoding UTF8
}
Write-Output "Installer evidence: $outputPath"
if($report.failure){exit 1}
Write-Output 'PASS isolated NSIS install/uninstall, installed binary hash, user metadata restored.'
