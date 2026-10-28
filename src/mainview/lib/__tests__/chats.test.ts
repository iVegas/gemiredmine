import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  chatById,
  chatOf,
  chats,
  clearChat,
  markRead,
  newestChat,
  removeChat,
  resetChats,
  startChat,
  titleFrom,
  updateChat,
  NEW_CHAT_TITLE,
} from '../chats';

describe('the name a chat takes', () => {
  it('is the first question, and nothing of it is lost when it is short', () => {
    expect(titleFrom('What is due today?')).toBe('What is due today?');
  });

  it('is shortened where a title bar could not hold it', () => {
    expect(titleFrom('What did I log on the login page last week, in hours?')).toBe('What did I log on the login…');
  });

  it('falls back to the name of a chat that has not been asked anything', () => {
    expect(titleFrom('   ')).toBe(NEW_CHAT_TITLE);
  });
});

describe('the chats of the user', () => {
  beforeEach(() => resetChats());

  it('start empty, with a name and nothing said', () => {
    const id = startChat();

    expect(get(chats)).toEqual([
      { id, title: NEW_CHAT_TITLE, messages: [], asking: false, error: null, draft: '', unread: 0 },
    ]);
  });

  it('can be started about something, with the question begun', () => {
    const id = startChat({ title: 'Task #42', draft: 'About task #42: ' });

    expect(chatById(id)).toMatchObject({ title: 'Task #42', draft: 'About task #42: ' });
  });

  it('are kept apart: each has its own name, question and answers', () => {
    const first = startChat();
    const second = startChat();

    updateChat(first, { draft: 'What is due?' });
    updateChat(second, { messages: [{ role: 'assistant', content: 'Two tasks.', toolCalls: [] }] });

    expect(chatById(first)?.draft).toBe('What is due?');
    expect(chatById(second)?.draft).toBe('');
    expect(chatById(first)?.messages).toEqual([]);
    expect(chatById(second)?.messages).toHaveLength(1);
  });

  it('are changed by a function of what they hold, so two changes do not undo each other', () => {
    const id = startChat();
    updateChat(id, (chat) => ({ messages: [...chat.messages, { role: 'user', content: 'One' }] }));
    updateChat(id, (chat) => ({ messages: [...chat.messages, { role: 'user', content: 'Two' }] }));

    expect(chatById(id)?.messages).toHaveLength(2);
  });

  it('leave a chat that is gone alone, so a late answer cannot bring it back', () => {
    const id = startChat();
    removeChat(id);

    updateChat(id, { messages: [{ role: 'user', content: 'Hello' }] });

    expect(get(chats)).toEqual([]);
    expect(chatById(id)).toBeUndefined();
  });

  it('are emptied without losing their place or their name', () => {
    const id = startChat({ title: 'Task #42' });
    updateChat(id, { messages: [{ role: 'user', content: 'Hello' }], unread: 2, draft: 'kept' });

    clearChat(id);

    expect(chatById(id)).toMatchObject({ title: 'Task #42', messages: [], unread: 0, draft: 'kept' });
  });

  it('count their unread answers until the user looks at them', () => {
    const id = startChat();
    updateChat(id, { unread: 3 });

    markRead(id);

    expect(chatById(id)?.unread).toBe(0);
  });

  it('say which one is the newest, and which one an id names', () => {
    const first = startChat();
    const second = startChat();

    expect(newestChat(get(chats))?.id).toBe(second);
    expect(chatOf(get(chats), first)?.id).toBe(first);
    expect(newestChat([])).toBeUndefined();
  });
});
