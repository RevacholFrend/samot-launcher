# Signs a file with the SAMOT Launcher self-signed code-signing certificate.
# Usage: powershell -NoProfile -File tools/sign.ps1 -FilePath "dist\SAMOT Launcher Setup 1.0.0.exe"
# Exits 0 on success, 1 on failure.
param(
  [Parameter(Mandatory = $true)]
  [string]$FilePath
)

$ErrorActionPreference = 'Stop'

$thumbprint = '9D8958419ABE01252BC5E5204DCABF0F104F760E'
$cert = Get-Item "Cert:\CurrentUser\My\$thumbprint" -ErrorAction Stop
if (-not $cert) {
  Write-Error "Self-signed SAMOT certificate not found in Cert:\CurrentUser\My (thumbprint $thumbprint)."
  exit 1
}

if (-not (Test-Path $FilePath)) {
  Write-Error "File not found: $FilePath"
  exit 1
}

# Try signing with a timestamp; if the server is unreachable, sign without one
try {
  $sig = Set-AuthenticodeSignature -FilePath $FilePath -Certificate $cert -HashAlgorithm SHA256 -TimestampServer 'http://timestamp.digicert.com'
} catch {
  Write-Output 'Timestamp server unreachable, signing without timestamp...'
  $sig = Set-AuthenticodeSignature -FilePath $FilePath -Certificate $cert -HashAlgorithm SHA256
}

Write-Output ("File: {0}" -f $FilePath)
Write-Output ("Status: {0} ({1})" -f $sig.Status, $sig.StatusMessage)
if ($sig.Status -ne 'Valid') { exit 1 }
exit 0
