// The Tauri configuration overlay for the Android project. `tauri android init` and `tauri android build` take it
// with --config, so the package name comes from channels.mjs and nowhere else. The same for every channel.
import { ANDROID_IDENTIFIER } from './channels.mjs';

process.stdout.write(JSON.stringify({ identifier: ANDROID_IDENTIFIER }));
