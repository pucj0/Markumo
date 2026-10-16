param([Parameter(Mandatory)][ValidateSet('Install','Uninstall')][string]$Mode,[Parameter(Mandatory)][string]$AppDirectory,[switch]$TrustLocalCertificate)
$ErrorActionPreference='Stop'
$packageName='pucj0.Markumo.ContextMenu'
$recordPath=Join-Path $AppDirectory 'shell/Registration.json'
try {
 if ($Mode -eq 'Uninstall') {
  # Remove only this package at this install location, never another instance.
  if (Test-Path -LiteralPath $recordPath) {
   $record=Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
   foreach ($package in @(Get-AppxPackage -Name $packageName)) {
    if ($package.PackageFullName -eq $record.packageFullName -and [IO.Path]::GetFullPath($record.root).TrimEnd('\') -ieq [IO.Path]::GetFullPath($AppDirectory).TrimEnd('\')) { Remove-AppxPackage -Package $package.PackageFullName -ErrorAction Stop }
   }
  }
 } elseif ([Environment]::OSVersion.Version.Build -ge 22000) {
  $root=[IO.Path]::GetFullPath($AppDirectory)
  if (-not (Test-Path -LiteralPath (Join-Path $root 'markumo.exe') -PathType Leaf)) { throw 'markumo.exe is missing' }
  $package=Join-Path $root 'shell/Markumo.Shell.msix'
  if (-not (Test-Path -LiteralPath $package -PathType Leaf)) { throw 'The Shell sparse package is missing' }
  if ($TrustLocalCertificate) {
   # Explicit local-test option only, never used by the installer. Trust just
   # this publisher certificate in the machine TrustedPeople store required by
   # MSIX deployment. Requires explicit consent and elevation; never add a root CA.
   $certificate=Join-Path $root 'shell/Markumo.Local.cer'
   $public=[Security.Cryptography.X509Certificates.X509Certificate2]::new($certificate)
   if ($public.Subject -ne 'CN=Markumo Local Development') { throw 'Unexpected local certificate subject' }
   $signature=Get-AuthenticodeSignature -LiteralPath $package
   if ($signature.SignerCertificate.Thumbprint -ne $public.Thumbprint) { throw 'Local certificate does not match the signed package' }
   Import-Certificate -FilePath $certificate -CertStoreLocation Cert:\LocalMachine\TrustedPeople | Out-Null
  }
  Add-AppxPackage -Path $package -ExternalLocation $root -ErrorAction Stop
  $signer=(Get-AuthenticodeSignature -LiteralPath $package).SignerCertificate
  $installed=Get-AppxPackage -Name $packageName | Where-Object Publisher -EQ $signer.Subject | Sort-Object Version -Descending | Select-Object -First 1
  if (-not $installed) { throw 'Windows did not register the Shell package' }
  @{packageFullName=$installed.PackageFullName;root=$root} | ConvertTo-Json | Set-Content -LiteralPath $recordPath -Encoding UTF8
 }
} catch { Write-Error $_;exit 1 }
