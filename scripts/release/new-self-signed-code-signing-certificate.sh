#!/usr/bin/env bash
# Creates the self-signed code-signing certificate for canary and unstable Windows packages, on Linux.
# It does the same job as New-SelfSignedCodeSigningCertificate.ps1, using OpenSSL instead of PowerShell.
#
# Run once. The same certificate must sign every canary and unstable release: a new certificate would
# change the publisher, and installed packages could no longer be upgraded. Keep the .pfx file and its
# password safe, because the .pfx is the only copy of the private key. Stable releases do not use this
# certificate; they need a publicly trusted one.
#
# Needs: openssl and coreutils (installed on Ubuntu and Kubuntu). -s also needs gh, logged in with admin
# access to the repository (sudo apt install gh, then gh auth login).
#
# Writes to the output directory:
#   gemiredmine-self-signed.pfx   certificate and private key (keep safe)
#   gemiredmine-self-signed.cer   public certificate, the file testers import on Windows
#   secrets/<NAME>                one file per GitHub secret, holding the value to paste
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: new-self-signed-code-signing-certificate.sh [options]

  -n, --name NAME           common name of the certificate (default: Gemiredmine).
                            The publisher secret becomes CN=NAME.
  -y, --years N             years the certificate is valid (default: 5)
  -o, --output-dir DIR      where the files are written (default: ~/gemiredmine-signing)
  -r, --repo OWNER/REPO     repository for --set-github-secrets (default: iVegas/gemiredmine)
  -s, --set-github-secrets  store the three secrets in the repository with gh
  -h, --help                show this help
EOF
}

name='Gemiredmine'
years=5
output_dir="$HOME/gemiredmine-signing"
repo='iVegas/gemiredmine'
set_secrets=false

while [ $# -gt 0 ]; do
  case "$1" in
    -n|--name) name="${2:?--name needs a value}"; shift 2 ;;
    -y|--years) years="${2:?--years needs a value}"; shift 2 ;;
    -o|--output-dir) output_dir="${2:?--output-dir needs a value}"; shift 2 ;;
    -r|--repo) repo="${2:?--repo needs a value}"; shift 2 ;;
    -s|--set-github-secrets) set_secrets=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

fail() {
  echo "Error: $*" >&2
  exit 1
}

# The publisher in the package manifest must equal the certificate subject exactly. Plain names keep the
# OpenSSL and Windows spellings of the subject identical.
[[ "$name" =~ ^[A-Za-z0-9]([A-Za-z0-9\ ._-]*[A-Za-z0-9._-])?$ ]] \
  || fail "the name may contain only letters, digits, spaces, dots, hyphens and underscores: \"$name\""
[[ "$years" =~ ^[1-9][0-9]?$ ]] || fail "--years must be a whole number from 1 to 99"
command -v openssl >/dev/null || fail "openssl is not installed (sudo apt install openssl)"
if $set_secrets; then
  command -v gh >/dev/null || fail "gh is not installed (sudo apt install gh)"
  gh auth status >/dev/null 2>&1 || fail "gh is not logged in (gh auth login)"
fi

publisher="CN=$name"
pfx="$output_dir/gemiredmine-self-signed.pfx"
cer="$output_dir/gemiredmine-self-signed.cer"
secrets_dir="$output_dir/secrets"

# Never overwrite an existing private key: it may be the one every published package is signed with.
[ ! -e "$pfx" ] || fail "$pfx already exists. Move it away or choose another --output-dir."

umask 077
mkdir -p "$output_dir" "$secrets_dir"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# End-entity code-signing certificate, as Microsoft describes for signing MSIX packages:
# key usage Digital Signature, extended key usage Code Signing (1.3.6.1.5.5.7.3.3), not a CA.
cat >"$work/openssl.cnf" <<EOF
[req]
prompt = no
distinguished_name = subject
x509_extensions = code_signing

[subject]
CN = $name

[code_signing]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = codeSigning
subjectKeyIdentifier = hash
EOF

openssl req -x509 -config "$work/openssl.cnf" -newkey rsa:3072 -sha256 -noenc \
  -days "$((years * 365))" -keyout "$work/key.pem" -out "$work/certificate.pem" 2>"$work/req.log" \
  || { cat "$work/req.log" >&2; fail "openssl could not create the certificate"; }

# A random password made of hex digits, so no character needs quoting anywhere it is passed on.
GEMI_PFX_PASSWORD="$(openssl rand -hex 24)"
export GEMI_PFX_PASSWORD

# AES-256 with a SHA-256 MAC, which the Windows signing tools on the build runner read.
openssl pkcs12 -export -inkey "$work/key.pem" -in "$work/certificate.pem" -out "$pfx" \
  -name "$name code signing" -passout env:GEMI_PFX_PASSWORD \
  -keypbe AES-256-CBC -certpbe AES-256-CBC -macalg SHA256
openssl pkcs12 -in "$pfx" -passin env:GEMI_PFX_PASSWORD -noout \
  || fail "the new .pfx could not be read back with its password"
openssl x509 -in "$work/certificate.pem" -outform DER -out "$cer"
chmod 644 "$cer"

# Secret values without a trailing newline, so pasting them or piping them to gh gives the exact value.
base64 -w0 "$pfx" >"$secrets_dir/WINDOWS_SELF_SIGNED_PFX_BASE64"
printf '%s' "$GEMI_PFX_PASSWORD" >"$secrets_dir/WINDOWS_SELF_SIGNED_PASSWORD"
printf '%s' "$publisher" >"$secrets_dir/WINDOWS_SELF_SIGNED_PUBLISHER"

if $set_secrets; then
  for secret in WINDOWS_SELF_SIGNED_PFX_BASE64 WINDOWS_SELF_SIGNED_PASSWORD WINDOWS_SELF_SIGNED_PUBLISHER; do
    gh secret set "$secret" --repo "$repo" <"$secrets_dir/$secret" \
      || fail "gh could not set $secret. The values are in $secrets_dir; add them at https://github.com/$repo/settings/secrets/actions"
  done
  echo "GitHub secrets for $repo were updated."
fi

echo
echo "Certificate:"
openssl x509 -in "$work/certificate.pem" -noout -subject -enddate -fingerprint -sha1 | sed 's/^/  /'
echo
echo "Certificate and key (keep safe): $pfx"
echo "Public certificate:             $cer"
echo "Secret values:                  $secrets_dir"
for secret in WINDOWS_SELF_SIGNED_PFX_BASE64 WINDOWS_SELF_SIGNED_PASSWORD WINDOWS_SELF_SIGNED_PUBLISHER; do
  echo "  $secret"
done
echo
if ! $set_secrets; then
  echo "Add each file's contents as a repository secret of the same name:"
  echo "  https://github.com/$repo/settings/secrets/actions"
  echo
fi
echo "Store the .pfx and its password (secrets/WINDOWS_SELF_SIGNED_PASSWORD) in a password manager,"
echo "then delete $secrets_dir."
