import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The Android credential vault is written in three places that must agree by name: the Kotlin commands, the Rust
// crate that registers them and generates their permissions, and the webview that calls them.

const ROOT = resolve(fileURLToPath(import.meta.url), '../../../..');
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');

const PLUGIN = 'src-tauri/plugins/credential-vault';
const kotlin = read(PLUGIN, 'android/src/main/java/app/gemiredmine/vault/CredentialVaultPlugin.kt');
const buildRs = read(PLUGIN, 'build.rs');
const libRs = read(PLUGIN, 'src/lib.rs');
const permissions = read(PLUGIN, 'permissions/default.toml');

const kotlinCommands = [...kotlin.matchAll(/@Command\s+fun (\w+)/g)].map((match) => match[1]).sort();
const rustCommands = /const COMMANDS: &\[&str\] = &\[([^\]]*)\]/
  .exec(buildRs)![1]
  .split(',')
  .map((part) => part.trim().replace(/"/g, ''))
  .filter(Boolean)
  .sort();

describe('the Android credential vault', () => {
  it('declares the same commands in Kotlin and in the Rust build', () => {
    expect(kotlinCommands).toEqual(rustCommands);
  });

  it('grants a permission for each command in its default set', () => {
    for (const command of kotlinCommands) {
      expect(permissions, command).toContain(`"allow-${command}"`);
    }
  });

  it('is registered under the Kotlin package and class it is written in', () => {
    expect(libRs).toContain('const ANDROID_PACKAGE: &str = "app.gemiredmine.vault";');
    expect(libRs).toContain('const ANDROID_CLASS: &str = "CredentialVaultPlugin";');
    expect(kotlin).toContain('package app.gemiredmine.vault');
    expect(kotlin).toMatch(/@TauriPlugin\s+class CredentialVaultPlugin\b/);
  });

  it('is granted to the backend window, which is the only one that calls it', () => {
    const capability = JSON.parse(read('src-tauri/capabilities/backend.json')) as { permissions: unknown[] };
    expect(capability.permissions).toContain('credential-vault:default');
  });

  it('is called from the webview only by commands it declares', () => {
    const tauriPlatform = read('src/mainview/lib/tauri-platform.ts');
    const called = [...tauriPlatform.matchAll(/vault(?:<[^>]*>)?\('(\w+)'/g)].map((match) => match[1]);

    expect(called.length).toBeGreaterThan(0);
    for (const command of new Set(called)) {
      expect(kotlinCommands, command).toContain(command);
    }
  });

  it('is the Android build\'s own plugin, linked by the crate name the app depends on', () => {
    const cargo = read('src-tauri/Cargo.toml');
    expect(cargo).toContain('tauri-plugin-credential-vault = { path = "plugins/credential-vault" }');
    expect(read(PLUGIN, 'Cargo.toml')).toContain('links = "tauri-plugin-credential-vault"');
  });
});
