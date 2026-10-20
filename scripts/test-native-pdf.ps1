$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskArtifacts = Join-Path $taskRoot 'test-results\conversion'
New-Item -ItemType Directory -Force -Path $taskArtifacts | Out-Null
$taskOldTemp = $env:TEMP
$taskOldTmp = $env:TMP
try {
    $env:TEMP = Join-Path $taskRoot 'src-tauri\target\conversion-test-temp'
    $env:TMP = $env:TEMP
    New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
    $taskBuild = & cargo test --locked --manifest-path (Join-Path $taskRoot 'src-tauri\Cargo.toml') --features conversion-webview-tests --lib --no-run --message-format=json
    if ($LASTEXITCODE -ne 0) { throw 'Native PDF test build failed.' }
    $taskArtifact = $taskBuild | ForEach-Object { $_ | ConvertFrom-Json } | Where-Object { $_.reason -eq 'compiler-artifact' -and $_.target.name -eq 'markumo_lib' -and $_.profile.test } | Select-Object -Last 1
    if (-not $taskArtifact.executable) { throw 'Native PDF test executable was not returned by Cargo.' }
    $taskMt = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Directory | Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName 'x64\mt.exe' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $taskMt) { throw 'Windows SDK mt.exe is required to give the Rust test executable Common Controls v6.' }
    $taskManifest = Join-Path $taskArtifacts 'native-test.manifest'
    @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0"><assemblyIdentity version="1.0.0.0" processorArchitecture="amd64" name="Markumo.ConversionTest" type="win32"/><dependency><dependentAssembly><assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="amd64" publicKeyToken="6595b64144ccf1df" language="*"/></dependentAssembly></dependency></assembly>
'@ | Set-Content -LiteralPath $taskManifest -Encoding utf8
    & $taskMt -nologo -manifest $taskManifest "-outputresource:$($taskArtifact.executable);#1"
    if ($LASTEXITCODE -ne 0) { throw 'Unable to embed the native test manifest.' }
    & $taskArtifact.executable real_webview2_prints_and_releases_hidden_window --ignored --nocapture
    if ($LASTEXITCODE -ne 0) { throw 'Native WebView2 conversion regression failed.' }
} finally {
    $env:TEMP = $taskOldTemp
    $env:TMP = $taskOldTmp
}
