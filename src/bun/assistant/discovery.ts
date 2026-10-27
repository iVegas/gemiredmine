// Finding a model this computer can already answer with, so that nobody has to type an address like
// http://192.168.1.50:11434/v1 by hand. The usual addresses of the local servers are asked whether they have models;
// the ones that answer are offered in the settings screen. Portable: it runs in the webview and gets its HTTP client
// from the caller.

import type { FetchLike } from '../redmine/client';

export interface LocalModelCandidate {
  /** The program that usually answers there, for the user. */
  label: string;
  /** The OpenAI-compatible address, without the path, such as http://127.0.0.1:11434/v1. */
  baseUrl: string;
}

/**
 * Where a local model server usually listens. Ollama, LM Studio, Lemonade, llama.cpp, Jan, GPT4All and the text
 * generation web UI all answer the OpenAI model list, so one request per address is enough to tell whether one is there.
 */
export const LOCAL_MODEL_CANDIDATES: readonly LocalModelCandidate[] = [
  { label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1' },
  { label: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1' },
  { label: 'Lemonade or vLLM', baseUrl: 'http://127.0.0.1:8000/v1' },
  { label: 'llama.cpp or LocalAI', baseUrl: 'http://127.0.0.1:8080/v1' },
  { label: 'Jan', baseUrl: 'http://127.0.0.1:1337/v1' },
  { label: 'GPT4All', baseUrl: 'http://127.0.0.1:4891/v1' },
  { label: 'Text generation web UI', baseUrl: 'http://127.0.0.1:5000/v1' },
];

/** A local server that answered, with the models it offers. */
export interface LocalModelServer {
  label: string;
  baseUrl: string;
  /** The names the server gives its models, in the order it listed them. Empty when it named none. */
  models: string[];
}

/** How long one address may take to answer. A server that is not there refuses at once; this is for one that hangs. */
export const LOCAL_PROBE_TIMEOUT_MS = 1_500;

/** The model names in an OpenAI model list, or in Ollama's own. Anything else is read as no names. */
export function modelNamesFrom(payload: unknown): string[] {
  if (typeof payload !== 'object' || payload === null) return [];
  const record = payload as Record<string, unknown>;
  const list = Array.isArray(record.data) ? record.data : Array.isArray(record.models) ? record.models : [];
  const names = list.map((entry) => {
    if (typeof entry === 'string') return entry;
    if (typeof entry !== 'object' || entry === null) return '';
    const item = entry as Record<string, unknown>;
    return typeof item.id === 'string' ? item.id : typeof item.name === 'string' ? item.name : '';
  });
  return [...new Set(names.filter((name) => name !== ''))];
}

/** The address as the settings screen keeps it: no trailing slash, and with the OpenAI `/v1` path a server expects. */
export function openAiAddress(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

/** Asks one address for its models. Null when nothing answers there, or when the answer is not a model list. */
async function probe(fetch: FetchLike, candidate: LocalModelCandidate, timeoutMs: number): Promise<LocalModelServer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${candidate.baseUrl.replace(/\/+$/, '')}/models`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    // A server with no model loaded is still a server: it is offered, and the user names the model.
    const models = await response
      .json()
      .then(modelNamesFrom)
      .catch(() => []);
    return { label: candidate.label, baseUrl: candidate.baseUrl, models };
  } catch {
    // Nothing there, or it did not answer in time. Finding none is the usual case, so it is not an error.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface FindLocalModelsOptions {
  /** The addresses to ask. Defaults to the usual ones. */
  candidates?: readonly LocalModelCandidate[];
  timeoutMs?: number;
}

/**
 * The local model servers that answer on this computer. Every address is asked at the same time, so the whole search
 * takes as long as the slowest one. Addresses that answer the same way more than once are reported once.
 */
export async function findLocalModelServers(fetch: FetchLike, options: FindLocalModelsOptions = {}): Promise<LocalModelServer[]> {
  const candidates = options.candidates ?? LOCAL_MODEL_CANDIDATES;
  const seen = new Set<string>();
  const unique = candidates.filter((candidate) => {
    const address = candidate.baseUrl.replace(/\/+$/, '');
    if (seen.has(address)) return false;
    seen.add(address);
    return true;
  });
  const found = await Promise.all(unique.map((candidate) => probe(fetch, candidate, options.timeoutMs ?? LOCAL_PROBE_TIMEOUT_MS)));
  return found.filter((server): server is LocalModelServer => server !== null);
}
