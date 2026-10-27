import { describe, it, expect } from 'vitest';
import { buildModelRequest, describeFailure, geminiSchema, parseModelReply, type ChatMessage, type ToolSpec } from '../assistant/providers';
import type { AssistantSettings } from '../../shared/assistant';

const settings = (provider: AssistantSettings['provider'], baseUrl: string, model = 'the-model'): AssistantSettings => ({
  provider,
  baseUrl,
  model,
  voice: null,
});

const schema = {
  type: 'object',
  properties: { taskId: { type: 'integer', minimum: 1 } },
  required: ['taskId'],
  additionalProperties: false,
  $schema: 'https://json-schema.org/draft/2020-12/schema',
};

const tools: ToolSpec[] = [{ name: 'get_task', description: 'One task.', inputSchema: schema }];

const conversation: ChatMessage[] = [
  { role: 'user', content: 'What is #42?' },
  { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'get_task', args: { taskId: 42 } }] },
  { role: 'tool', toolCallId: 'c1', name: 'get_task', content: '{"subject":"Login"}' },
  { role: 'tool', toolCallId: 'c2', name: 'get_task', content: '{"subject":"Logout"}' },
];

describe('the OpenAI-compatible format', () => {
  const openai = settings('openai-compatible', 'https://api.example.com/v1/');

  it('posts the conversation to chat completions, with the key as a bearer token', () => {
    const request = buildModelRequest(openai, 'secret', conversation, tools, 'Be brief.');

    expect(request.url).toBe('https://api.example.com/v1/chat/completions');
    expect(request.headers.authorization).toBe('Bearer secret');
    expect(request.body.model).toBe('the-model');
    expect(request.body.messages).toEqual([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'What is #42?' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_task', arguments: '{"taskId":42}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', content: '{"subject":"Login"}' },
      { role: 'tool', tool_call_id: 'c2', content: '{"subject":"Logout"}' },
    ]);
    expect(request.body.tools).toEqual([{ type: 'function', function: { name: 'get_task', description: 'One task.', parameters: schema } }]);
  });

  it('sends no key and no tools to a local server that needs neither', () => {
    const request = buildModelRequest(settings('openai-compatible', 'http://127.0.0.1:8000/v1'), null, [{ role: 'user', content: 'Hi' }], [], 'Be brief.');

    expect(request.headers.authorization).toBeUndefined();
    expect(request.body).not.toHaveProperty('tools');
  });

  it('reads the text and the tool calls of a reply, and reads broken arguments as none', () => {
    const reply = parseModelReply('openai-compatible', {
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: 'x1', function: { name: 'get_task', arguments: '{"taskId":7}' } },
              { function: { name: 'get_task', arguments: 'not json' } },
            ],
          },
        },
      ],
    });

    expect(reply).toEqual({
      text: '',
      toolCalls: [
        { id: 'x1', name: 'get_task', args: { taskId: 7 } },
        { id: 'call-1', name: 'get_task', args: {} },
      ],
    });
  });
});

describe('the Anthropic format', () => {
  const anthropic = settings('anthropic', 'https://api.anthropic.com/v1');

  it('sends the key in its own header, and groups consecutive tool results into one turn', () => {
    const request = buildModelRequest(anthropic, 'secret', conversation, tools, 'Be brief.');

    expect(request.url).toBe('https://api.anthropic.com/v1/messages');
    expect(request.headers['x-api-key']).toBe('secret');
    expect(request.headers['anthropic-version']).toBe('2023-06-01');
    expect(request.body.system).toBe('Be brief.');
    expect(request.body.messages).toEqual([
      { role: 'user', content: 'What is #42?' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'get_task', input: { taskId: 42 } }] },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'c1', content: '{"subject":"Login"}' },
          { type: 'tool_result', tool_use_id: 'c2', content: '{"subject":"Logout"}' },
        ],
      },
    ]);
    expect(request.body.tools).toEqual([{ name: 'get_task', description: 'One task.', input_schema: schema }]);
  });

  it('reads the text blocks and the tool_use blocks of a reply', () => {
    const reply = parseModelReply('anthropic', {
      content: [
        { type: 'text', text: 'Looking.' },
        { type: 'tool_use', id: 'u1', name: 'get_task', input: { taskId: 3 } },
        { type: 'text', text: 'Done.' },
      ],
    });

    expect(reply).toEqual({ text: 'Looking.\nDone.', toolCalls: [{ id: 'u1', name: 'get_task', args: { taskId: 3 } }] });
  });
});

describe('the Gemini format', () => {
  const gemini = settings('gemini', 'https://generativelanguage.googleapis.com/v1beta', 'models/gemini-2.5-flash');

  it('names the model in the address, and sends the key in its own header', () => {
    const request = buildModelRequest(gemini, 'secret', [{ role: 'user', content: 'Hi' }], [], 'Be brief.');

    expect(request.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    expect(request.headers['x-goog-api-key']).toBe('secret');
    expect(request.body.systemInstruction).toEqual({ parts: [{ text: 'Be brief.' }] });
    expect(request.body.contents).toEqual([{ role: 'user', parts: [{ text: 'Hi' }] }]);
  });

  it('removes the keywords that Gemini refuses, from every level of a schema, and keeps the rest', () => {
    const request = buildModelRequest(gemini, 'secret', conversation, tools, 'Be brief.');
    const declared = (request.body.tools as Array<{ functionDeclarations: Array<{ parameters: unknown }> }>)[0].functionDeclarations[0];

    expect(declared.parameters).toEqual({
      type: 'object',
      properties: { taskId: { type: 'integer', minimum: 1 } },
      required: ['taskId'],
    });
    expect(geminiSchema({ items: [{ additionalProperties: false, type: 'string' }] })).toEqual({ items: [{ type: 'string' }] });
  });

  it('sends each function response as a part of one user turn, and each call as a model part', () => {
    const request = buildModelRequest(gemini, 'secret', conversation, tools, 'Be brief.');
    const contents = request.body.contents as Array<{ role: string; parts: unknown[] }>;

    expect(contents[1]).toEqual({ role: 'model', parts: [{ functionCall: { name: 'get_task', args: { taskId: 42 } } }] });
    expect(contents[2].role).toBe('user');
    expect(contents[2].parts).toEqual([
      { functionResponse: { name: 'get_task', response: { result: '{"subject":"Login"}' } } },
      { functionResponse: { name: 'get_task', response: { result: '{"subject":"Logout"}' } } },
    ]);
  });

  it('reads the text parts and the function calls of a reply', () => {
    const reply = parseModelReply('gemini', {
      candidates: [{ content: { role: 'model', parts: [{ text: 'Checking.' }, { functionCall: { name: 'get_task', args: { taskId: 5 } } }] } }],
    });

    expect(reply).toEqual({ text: 'Checking.', toolCalls: [{ id: 'get_task-1', name: 'get_task', args: { taskId: 5 } }] });
  });
});

describe('a reply that the app cannot read', () => {
  it('is refused with one sentence the user can read', () => {
    expect(() => parseModelReply('openai-compatible', { error: 'quota' })).toThrow('The model answered in a format the app does not read.');
    expect(() => parseModelReply('gemini', { candidates: [] })).toThrow('The model answered in a format the app does not read.');
  });
});

describe('the message of a failed request', () => {
  it('names a refused key, so the user knows what to fix', async () => {
    expect(await describeFailure(new Response('nope', { status: 401 }))).toBe('The model service refused the API key. Check the key in Settings.');
  });

  it('shortens the body of any other failure', async () => {
    const long = `${'<html>'.repeat(200)}`;

    const message = await describeFailure(new Response(long, { status: 502 }));

    expect(message.startsWith('The model service answered 502: <html>')).toBe(true);
    expect(message.length).toBeLessThanOrEqual('The model service answered 502: '.length + 300);
  });
});
