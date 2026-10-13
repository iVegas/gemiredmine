<#
.SYNOPSIS
  Creates the self-signed code-signing certificate for canary and unstable Windows packages.

.DESCRIPTION
  Run once, on Windows. The same certificate must sign every canary and unstable release: a new
  certificate would change the publisher, and installed packages could no longer be upgraded.
  Keep the .pfx file safe, because it is the only copy of the private key. Stable releases do not use
  this certificate; they need a publicly trusted one.

  Testers, and this machine, must trust the public .cer before the packages can be installed:
    Import-Certificate -FilePath <the .cer> -CertStoreLocation Cert:\LocalMachine\TrustedPeople
  (run PowerShell as administrator).

.PARAMETER Subject
  Certificate subject. The publisher secret is set to the same value, so the two always match.

.PARAMETER Repo
  Repository that receives the secrets when -SetGitHubSecrets is used.

.PARAMETER SetGitHubSecrets
  Store the certificate, its password and the publisher as GitHub secrets with the gh CLI.
  gh must be logged in with admin access to the repository.

.EXAMPLE
  .\New-SelfSignedCodeSigningCertificate.ps1 -SetGitHubSecrets
#>
[CmdletBinding()]
param(
    [string]$Subject = 'CN=Gemiredmine',
    [string]$Repo = 'iVegas/gemiredmine',
    [int]$Years = 5,
    [string]$OutputDirectory = (Join-Path $HOME 'gemiredmine-signing'),
    [switch]$SetGitHubSecrets
)

$ErrorActionPreference = 'Stop'

$certificate = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject $Subject `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -HashAlgorithm SHA256 `
    -KeyExportPolicy Exportable `
    -NotAfter (Get-Date).AddYears($Years) `
    -CertStoreLocation 'Cert:\CurrentUser\My'

$pfxPassword = Read-Host -AsSecureString 'Choose a password for the .pfx file'

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$pfxPath = Join-Path $OutputDirectory 'gemiredmine-self-signed.pfx'
$cerPath = Join-Path $OutputDirectory 'gemiredmine-self-signed.cer'
Export-PfxCertificate -Cert $certificate -FilePath $pfxPath -Password $pfxPassword | Out-Null
Export-Certificate -Cert $certificate -FilePath $cerPath | Out-Null

if ($SetGitHubSecrets) {
    [Convert]::ToBase64String([IO.File]::ReadAllBytes($pfxPath)) |
        gh secret set WINDOWS_SELF_SIGNED_PFX_BASE64 --repo $Repo

    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pfxPassword))
    $plainPassword | gh secret set WINDOWS_SELF_SIGNED_PASSWORD --repo $Repo
    $plainPassword = $null

    $Subject | gh secret set WINDOWS_SELF_SIGNED_PUBLISHER --repo $Repo
    Write-Host "GitHub secrets for $Repo were updated."
}

Write-Host ''
Write-Host "Certificate (keep safe): $pfxPath"
Write-Host "Public certificate:      $cerPath"
Write-Host ''
Write-Host 'To install canary or unstable packages on this machine, run as administrator:'
Write-Host "  Import-Certificate -FilePath '$cerPath' -CertStoreLocation Cert:\LocalMachine\TrustedPeople"
