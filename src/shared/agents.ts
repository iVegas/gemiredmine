// The local endpoint that AI agents connect to (src-tauri/src/mcp.rs). The settings are the same for the backend that
// keeps them and the screen that changes them, so the rules are written once, here.

export interface AgentSettings {
  /** Whether the endpoint runs. It is off until the user turns it on. */
  enabled: boolean;
  /** The port on 127.0.0.1. Ports below 1024 need rights that a desktop app should not ask for. */
  port: number;
}

export const AGENT_DEFAULT_PORT = 47831;
export const AGENT_MIN_PORT = 1024;
export const AGENT_MAX_PORT = 65535;

/** The setting's key in the app's storage. */
export const AGENT_SETTINGS_KEY = 'agents';

/** Whether a port can be used for the endpoint. */
export const isAgentPort = (port: unknown): port is number =>
  typeof port === 'number' && Number.isInteger(port) && port >= AGENT_MIN_PORT && port <= AGENT_MAX_PORT;

/** The settings as they were stored. Anything missing or wrong falls back to the safe choice: off, on the default port. */
export function agentSettingsFrom(value: unknown): AgentSettings {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  // A port that is not usable means the settings are broken, so the endpoint stays off rather than start somewhere
  // the user did not choose.
  if (!isAgentPort(record.port)) return { enabled: false, port: AGENT_DEFAULT_PORT };
  return { enabled: record.enabled === true, port: record.port };
}
