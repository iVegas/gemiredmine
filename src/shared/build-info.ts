// Shape of the build metadata. The values are generated at build time from
// package.json and the release channel (see scripts/release/write-build-info.mjs).
export interface BuildInfo {
  /** Full version shown to users, for example 1.0.0 or 1.0.0-unstable.42 */
  version: string;
  channel: 'stable' | 'canary' | 'unstable' | 'dev';
  label: string;
  appName: string;
  productName: string;
  identifier: string;
  /** Per-channel directory name for settings and logs, so channels never share config */
  dataDirName: string;
  /** Whether this build can offer the developer preview. Stable builds never can. */
  devPreviewAvailable: boolean;
  repositoryUrl: string;
  /** Short git commit the build was made from, or "unknown" outside a git checkout */
  commit: string;
  buildDate: string;
}
