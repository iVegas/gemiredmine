import { describe, it, expect, vi } from 'vitest';
import {
  LOCAL_MODEL_CANDIDATES,
  findLocalModelServers,
  modelNamesFrom,
  openAiAddress,
} from '../assistant/discovery';
import type { FetchLike } from '../redmine/client';

const answer = (body: unknown, status = 200): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

const refused: FetchLike = async () => {
  throw new Error('connection refused');
};

describe('the model names of a server', () => {
  it('reads an OpenAI model list, and Ollama’s own', () => {
    expect(modelNamesFrom({ object: 'list', data: [{ id: 'qwen3:8b' }, { id: 'phi4' }] })).toEqual(['qwen3:8b', 'phi4']);
    expect(modelNamesFrom({ models: [{ name: 'llama3.1:8b' }] })).toEqual(['llama3.1:8b']);
  });

  it('reads nothing out of an answer that is not a model list, and never the same name twice', () => {
    expect(modelNamesFrom(null)).toEqual([]);
    expect(modelNamesFrom('<html>')).toEqual([]);
    expect(modelNamesFrom({ data: [{ id: 'a' }, { id: 'a' }, {}, 7] })).toEqual(['a']);
  });
});

describe('an address for a local server', () => {
  it('adds the path an OpenAI-compatible server listens on, and keeps one that is there', () => {
    expect(openAiAddress('http://127.0.0.1:11434')).toBe('http://127.0.0.1:11434/v1');
    expect(openAiAddress('http://127.0.0.1:11434/')).toBe('http://127.0.0.1:11434/v1');
    expect(openAiAddress('http://127.0.0.1:1234/v1')).toBe('http://127.0.0.1:1234/v1');
    expect(openAiAddress('  ')).toBe('');
  });
});

describe('looking for a local model server', () => {
  it('asks every usual address at once, and reports the ones that answer with their models', async () => {
    const fetch = vi.fn<FetchLike>(async (url) =>
      url === 'http://127.0.0.1:11434/v1/models' ? answer({ data: [{ id: 'qwen3:8b' }] }) : answer({}, 500)
    );

    const found = await findLocalModelServers(fetch);

    expect(found).toEqual([{ label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', models: ['qwen3:8b'] }]);
    expect(fetch).toHaveBeenCalledTimes(LOCAL_MODEL_CANDIDATES.length);
  });

  it('reports nothing when no server is there, which is the usual case', async () => {
    expect(await findLocalModelServers(refused)).toEqual([]);
  });

  it('reports a server that has no model loaded, so the user can name the model themselves', async () => {
    const fetch: FetchLike = async () => answer({ data: [] });

    const found = await findLocalModelServers(fetch, { candidates: [{ label: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1' }] });

    expect(found).toEqual([{ label: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', models: [] }]);
  });

  it('reports a server whose answer is not a model list, with no models', async () => {
    const fetch: FetchLike = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('not json');
        },
      }) as unknown as Response;

    const found = await findLocalModelServers(fetch, { candidates: [{ label: 'Something', baseUrl: 'http://127.0.0.1:9/v1' }] });

    expect(found).toEqual([{ label: 'Something', baseUrl: 'http://127.0.0.1:9/v1', models: [] }]);
  });

  it('gives up on an address that does not answer in time, without failing the search', async () => {
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });

    const found = await findLocalModelServers(fetch, {
      candidates: [{ label: 'Hangs', baseUrl: 'http://127.0.0.1:9/v1' }],
      timeoutMs: 5,
    });

    expect(found).toEqual([]);
  });

  it('asks an address that was given more than once only once', async () => {
    const fetch = vi.fn<FetchLike>(async () => answer({}, 404));

    await findLocalModelServers(fetch, {
      candidates: [
        { label: 'Named here', baseUrl: 'http://127.0.0.1:11434/v1' },
        { label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1/' },
      ],
    });

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
