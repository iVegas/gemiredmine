import { BrowserView, Utils } from 'electrobun';
import type { GemiRPCSchema } from '../shared/rpc';
import { buildInfo } from '../shared/build-info.generated';
import { createBackend } from './backend';
import { nodeDataFs } from './node-data-fs';
import { dataDirFor } from './paths';

// The desktop shell runs the backend in Bun: Bun's fetch, node:fs, and the system browser.
const backend = createBackend({
  fetch: (url, init) => fetch(url, init),
  fs: nodeDataFs,
  dataDir: async () => dataDirFor(buildInfo.dataDirName),
  openUrl: async (url) => {
    Utils.openExternal(url);
  },
  environment: async () => ({
    platform: process.platform,
    arch: process.arch,
    runtime: `bun ${process.versions.bun ?? 'unknown'}`,
  }),
});

export type AppRPC = ReturnType<typeof BrowserView.defineRPC<GemiRPCSchema>>;

// Each RPC request carries one parameter object; the backend takes positional arguments.
export const rpc: AppRPC = BrowserView.defineRPC<GemiRPCSchema>({
  handlers: {
    requests: {
      signIn: (params) => backend.signIn(params),
      getCurrentUser: (access) => backend.getCurrentUser(access),
      listTimeEntries: ({ baseUrl, apiKey, from, to }) => backend.listTimeEntries({ baseUrl, apiKey }, { from, to }),
      listOpenTasks: ({ baseUrl, apiKey, dueFrom, dueTo }) =>
        backend.listOpenTasks({ baseUrl, apiKey }, { dueFrom, dueTo }),
      listAssignedTasks: (access) => backend.listAssignedTasks(access),
      getDevPreviewStatus: () => backend.getDevPreviewStatus(),
      setDevPreviewEnabled: ({ enabled }) => backend.setDevPreviewEnabled(enabled),
      recordDiagnostic: ({ level, scope, message }) => backend.recordDiagnostic(level, scope, message),
      createFeedback: (input) => backend.createFeedback(input),
      openIssueLink: ({ url }) => backend.openIssueLink(url),
    },
  },
});
