// Windows signing profiles. A package must be signed to be installed, and each profile suits a channel:
//
//   self-signed  canary and unstable. One persistent certificate, so upgrades keep the same publisher.
//                Testers import the published .cer into Trusted People before installing.
//   trusted      stable. A publicly trusted code-signing certificate; no manual trust is needed.
//   none         local builds only. The package is produced but cannot be installed.
//
// The secrets are separate per profile, so the self-signed certificate can never end up in a stable release.
export const SIGNING_PROFILES = Object.freeze(['none', 'self-signed', 'trusted']);

export const SIGNING_SECRETS = Object.freeze({
  'self-signed': {
    pfx: 'WINDOWS_SELF_SIGNED_PFX_BASE64',
    password: 'WINDOWS_SELF_SIGNED_PASSWORD',
    publisher: 'WINDOWS_SELF_SIGNED_PUBLISHER',
  },
  trusted: {
    pfx: 'WINDOWS_TRUSTED_PFX_BASE64',
    password: 'WINDOWS_TRUSTED_PASSWORD',
    publisher: 'WINDOWS_TRUSTED_PUBLISHER',
  },
});

export const DEFAULT_SELF_SIGNED_PUBLISHER = 'CN=Gemiredmine';

/**
 * Decides how a package is signed and reads the secrets for that profile.
 * Throws when the profile is not allowed for the channel or when a secret it needs is missing.
 */
export function resolveSigning({ channel, profile = 'none', requireSigning = false, env = {} }) {
  if (!SIGNING_PROFILES.includes(profile)) {
    throw new Error(`Unknown Windows signing profile "${profile}". Expected one of: ${SIGNING_PROFILES.join(', ')}.`);
  }
  if (channel === 'stable' && profile === 'self-signed') {
    throw new Error('Stable releases must use trusted signing (WINDOWS_SIGNING=trusted); self-signed is for canary and unstable.');
  }
  if (requireSigning && profile === 'none') {
    throw new Error(`This ${channel} release must be signed. Set WINDOWS_SIGNING to ${channel === 'stable' ? 'trusted' : 'self-signed or trusted'}.`);
  }
  if (channel === 'stable' && requireSigning && profile !== 'trusted') {
    throw new Error('Stable releases must use trusted signing (WINDOWS_SIGNING=trusted).');
  }
  if (profile === 'none') {
    return { profile, pfxBase64: null, password: '', publisher: DEFAULT_SELF_SIGNED_PUBLISHER };
  }

  const names = SIGNING_SECRETS[profile];
  const pfxBase64 = env[names.pfx];
  if (!pfxBase64) {
    const howTo = profile === 'self-signed'
      ? 'Create it once with scripts/release/New-SelfSignedCodeSigningCertificate.ps1 (Windows) or new-self-signed-code-signing-certificate.sh (Linux).'
      : 'Add the publicly trusted certificate as a repository secret.';
    throw new Error(`Windows ${profile} signing needs the ${names.pfx} secret. ${howTo} See RELEASE_POLICY.md, "Signing secrets (Windows)".`);
  }

  let publisher = env[names.publisher];
  if (!publisher && profile === 'self-signed') publisher = DEFAULT_SELF_SIGNED_PUBLISHER;
  if (!publisher) throw new Error(`Trusted signing needs the ${names.publisher} secret (the certificate subject, for example CN=Your Company).`);

  return { profile, pfxBase64, password: env[names.password] ?? '', publisher };
}
