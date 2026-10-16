param([ValidateSet('x64','arm64')][string]$Architecture='x64',[string]$OutputDirectory,[string]$Publisher='CN=Markumo, OID.2.25.311729368913984317654407730594956997722=1')
$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot -Parent
if (-not $OutputDirectory) { $OutputDirectory=Join-Path $project 'src-tauri/target/windows-shell' }
$out=[IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $out -Force | Out-Null
$signingPfx=$env:MARKUMO_SHELL_CERTIFICATE_PFX
$signingPassword=$env:MARKUMO_SHELL_CERTIFICATE_PASSWORD
$temporaryPfx=$null
try {
$localKey=Join-Path $out 'LocalSigning.dpapi'
if (-not $signingPfx -and (Test-Path -LiteralPath $localKey)) {
 Add-Type -AssemblyName System.Security
 $pfxBytes=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($localKey),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
 $temporaryPfx=Join-Path $out ('signing-'+[Guid]::NewGuid().ToString('N')+'.pfx')
 [IO.File]::WriteAllBytes($temporaryPfx,$pfxBytes)
 [Array]::Clear($pfxBytes,0,$pfxBytes.Length)
 $signingPfx=$temporaryPfx;$signingPassword=''
}
if ($signingPfx) {
 $signingCert=[Security.Cryptography.X509Certificates.X509Certificate2]::new($signingPfx,$signingPassword,[Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet)
 $Publisher=$signingCert.Subject
 $signingCert.Dispose()
}
$vswhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$vs=& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { throw 'Visual Studio C++ tools are required for the Windows Shell extension.' }
$vc=Get-ChildItem (Join-Path $vs 'VC/Tools/MSVC') -Directory | Sort-Object Name -Descending | Select-Object -First 1
$sdk=Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10'
$sdkVersion=Get-ChildItem (Join-Path $sdk 'Include') -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'um/shobjidl.h') } | Sort-Object Name -Descending | Select-Object -First 1
$env:INCLUDE=(@((Join-Path $vc.FullName 'include'))+@('ucrt','shared','um','winrt' | ForEach-Object { Join-Path $sdk "Include/$($sdkVersion.Name)/$_" })) -join ';'
$env:LIB=@((Join-Path $vc.FullName "lib/$Architecture"),(Join-Path $sdk "Lib/$($sdkVersion.Name)/um/$Architecture"),(Join-Path $sdk "Lib/$($sdkVersion.Name)/ucrt/$Architecture")) -join ';'
$compilerDirectory=Join-Path $vc.FullName "bin/Hostx64/$Architecture"
$env:PATH=$compilerDirectory+';'+$env:PATH
$compiler=Join-Path $compilerDirectory 'cl.exe'
$source=Join-Path $project 'src-tauri/windows/shell/MarkumoShell.cpp'
$definition=Join-Path $project 'src-tauri/windows/shell/MarkumoShell.def'
& $compiler /nologo /std:c++17 /EHsc /utf-8 /O2 /MT /LD $source "/Fo$out/MarkumoShell.obj" /link "/DEF:$definition" "/OUT:$out/MarkumoShell.dll" "/IMPLIB:$out/MarkumoShell.lib" ole32.lib shell32.lib shlwapi.lib uuid.lib
if ($LASTEXITCODE -ne 0) { throw 'Shell DLL compilation failed' }
if ($Architecture -eq 'x64') {
 & $compiler /nologo /std:c++17 /EHsc /utf-8 /O2 /MT /DMARKUMO_SHELL_TEST $source "/Fo$out/ShellTest.obj" "/Fe$out/ShellTest.exe" /link ole32.lib shell32.lib shlwapi.lib uuid.lib
 if ($LASTEXITCODE -ne 0) { throw 'Shell native test compilation failed' }
 & (Join-Path $out 'ShellTest.exe')
 if ($LASTEXITCODE -ne 0) { throw 'Shell native COM/quoting tests failed' }
}
$day=[int]([DateTime]::UtcNow.Date-[DateTime]'2020-01-01').TotalDays
$revision=[DateTime]::UtcNow.Hour*1800+[DateTime]::UtcNow.Minute*30+[int][Math]::Floor([DateTime]::UtcNow.Second/2)
$version="1.0.$day.$revision"
$manifest=[IO.File]::ReadAllText((Join-Path $project 'src-tauri/windows/shell/AppxManifest.xml.in')).Replace('@ARCH@',$Architecture).Replace('@VERSION@',$version).Replace('@PUBLISHER@',[Security.SecurityElement]::Escape($Publisher))
$stage=Join-Path $out 'package-stage'
New-Item -ItemType Directory -Path (Join-Path $stage 'shell/Assets') -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $stage 'AppxManifest.xml'),$manifest,[Text.UTF8Encoding]::new($false))
Add-Type -AssemblyName System.Drawing
$original=[Drawing.Image]::FromFile((Join-Path $project 'src-tauri/icons/icon.png'))
try {
 foreach ($logo in @(@('Logo',50),@('Square150',150),@('Square44',44))) {
  $bitmap=[Drawing.Bitmap]::new([int]$logo[1],[int]$logo[1]);$graphics=[Drawing.Graphics]::FromImage($bitmap)
  try { $graphics.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic;$graphics.DrawImage($original,0,0,[int]$logo[1],[int]$logo[1]);$bitmap.Save((Join-Path $stage "shell/Assets/$($logo[0]).png"),[Drawing.Imaging.ImageFormat]::Png) } finally { $graphics.Dispose();$bitmap.Dispose() }
 }
} finally { $original.Dispose() }
$makeappx=Join-Path $sdk "bin/$($sdkVersion.Name)/x64/makeappx.exe"
# Sparse binaries live at ExternalLocation, not in the identity package.
& $makeappx pack /d $stage /p (Join-Path $out 'Markumo.Shell.msix') /o /nv
if ($LASTEXITCODE -ne 0) { throw 'Sparse package validation/build failed' }
if ($signingPfx) {
 $signTool=Join-Path $sdk "bin/$($sdkVersion.Name)/x64/signtool.exe"
 $signArgs=@('sign','/fd','SHA256','/f',$signingPfx)
 if ($signingPassword) { $signArgs+=@('/p',$signingPassword) }
 & $signTool @signArgs (Join-Path $out 'Markumo.Shell.msix')
 if ($LASTEXITCODE -ne 0) { throw 'Sparse package signing failed' }
} else { Write-Warning 'Unsigned identity package is for build inspection only; Windows rejects executable activation until signed.' }
Copy-Item -LiteralPath (Join-Path $stage 'shell/Assets') -Destination $out -Recurse -Force
Copy-Item -LiteralPath (Join-Path $project 'src-tauri/windows/shell/Register.ps1') -Destination $out -Force
Write-Output "Shell DLL, native tests and sparse package ready: $out (version $version)"
} finally { if ($temporaryPfx -and (Test-Path -LiteralPath $temporaryPfx)) { Remove-Item -LiteralPath $temporaryPfx -Force } }
