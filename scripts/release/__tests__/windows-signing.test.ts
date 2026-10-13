import { describe, it, expect } from 'vitest';
import { resolveSigning } from '../windows-signing.mjs';

const selfSignedEnv = { WINDOWS_SELF_SIGNED_PFX_BASE64: 'cGZ4', WINDOWS_SELF_SIGNED_PASSWORD: 'pw' };
const trustedEnv = { WINDOWS_TRUSTED_PFX_BASE64: 'cGZ4', WINDOWS_TRUSTED_PASSWORD: 'pw', WINDOWS_TRUSTED_PUBLISHER: 'CN=Acme Ltd' };

describe('resolveSigning', () => {
  it('signs canary and unstable with the self-signed certificate and the default publisher', () => {
    expect(resolveSigning({ channel: 'unstable', profile: 'self-signed', requireSigning: true, env: selfSignedEnv })).toEqual({
      profile: 'self-signed',
      pfxBase64: 'cGZ4',
      password: 'pw',
      publisher: 'CN=Gemiredmine',
    });
    expect(resolveSigning({ channel: 'canary', profile: 'self-signed', env: { ...selfSignedEnv, WINDOWS_SELF_SIGNED_PUBLISHER: 'CN=Gemiredmine' } }).publisher).toBe('CN=Gemiredmine');
  });

  it('signs stable only with the trusted certificate and its publisher', () => {
    expect(resolveSigning({ channel: 'stable', profile: 'trusted', requireSigning: true, env: trustedEnv })).toMatchObject({
      profile: 'trusted',
      publisher: 'CN=Acme Ltd',
    });
  });

  it('never lets the self-signed certificate reach stable', () => {
    expect(() => resolveSigning({ channel: 'stable', profile: 'self-signed', requireSigning: true, env: selfSignedEnv })).toThrow(
      'Stable releases must use trusted signing'
    );
  });

  it('requires a trusted publisher and a certificate for the chosen profile', () => {
    expect(() => resolveSigning({ channel: 'stable', profile: 'trusted', env: { ...trustedEnv, WINDOWS_TRUSTED_PUBLISHER: undefined } })).toThrow(
      'WINDOWS_TRUSTED_PUBLISHER'
    );
    expect(() => resolveSigning({ channel: 'unstable', profile: 'self-signed', env: {} })).toThrow('WINDOWS_SELF_SIGNED_PFX_BASE64');
  });

  it('refuses unsigned release builds, but allows unsigned local builds', () => {
    expect(() => resolveSigning({ channel: 'unstable', profile: 'none', requireSigning: true, env: {} })).toThrow('must be signed');
    expect(resolveSigning({ channel: 'unstable', profile: 'none', requireSigning: false, env: {} }).pfxBase64).toBeNull();
    expect(resolveSigning({ channel: 'stable', profile: 'none', requireSigning: false, env: {} }).profile).toBe('none');
  });

  it('rejects unknown profiles', () => {
    expect(() => resolveSigning({ channel: 'unstable', profile: 'maybe', env: {} })).toThrow('Unknown Windows signing profile');
  });
});
