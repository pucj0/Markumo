param([string]$OutputDirectory)
$ErrorActionPreference='Stop'
if (-not $OutputDirectory) { $OutputDirectory=Join-Path (Split-Path $PSScriptRoot -Parent) 'src-tauri/target/windows-shell' }
$out=[IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $out -Force | Out-Null
$keyPath=Join-Path $out 'LocalSigning.dpapi'
if (Test-Path -LiteralPath $keyPath) { Write-Output 'Existing local signing identity retained. No certificate trust was changed.';exit 0 }
Add-Type -AssemblyName System.Security
$rsa=[Security.Cryptography.RSA]::Create();$rsa.KeySize=2048
try {
 $request=[Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=Markumo Local Development',$rsa,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1)
 $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false,$false,0,$true))
 $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature,$true))
 $eku=[Security.Cryptography.OidCollection]::new();$eku.Add([Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.3')) | Out-Null
 $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($eku,$true))
 $certificate=$request.CreateSelfSigned([DateTimeOffset]::Now.AddMinutes(-5),[DateTimeOffset]::Now.AddYears(1))
 try {
  $bytes=$certificate.Export([Security.Cryptography.X509Certificates.X509ContentType]::Pfx,'')
  try { [IO.File]::WriteAllBytes($keyPath,[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)) } finally { [Array]::Clear($bytes,0,$bytes.Length) }
  [IO.File]::WriteAllBytes((Join-Path $out 'Markumo.Local.cer'),$certificate.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert))
  $certificate | Select-Object Subject,Thumbprint,NotAfter
 } finally { $certificate.Dispose() }
} finally { $rsa.Dispose() }
Write-Output 'Certificate prepared only. Trust must be explicitly approved separately; no Windows certificate store was changed.'
