import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { get } from 'svelte/store';
import AssistantDock from '../components/AssistantDock.svelte';
import { redmineApi } from '../lib/api';
import { asking, conversation } from '../lib/assistant';
import { dockState, openDock, resetDock, unreadReplies } from '../lib/assistant-dock';
import { activeView, openViews, resetViews } from '../lib/views';

vi.mock('../lib/api', () => ({
  redmineApi: { getAssistantSettings: vi.fn() },
}));

vi.mock('../lib/assistant', async () => {
  const { writable } = await import('svelte/store');
  return {
    conversation: writable([]),
    asking: writable(false),
    assistantError: writable(null),
    askAssistant: vi.fn(),
    readAloud: vi.fn(),
    transcribeSpeech: vi.fn(),
  };
});

const api = vi.mocked(redmineApi);

describe('the floating assistant', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.getAssistantSettings.mockResolvedValue({
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-sonnet-5-5',
      voice: null,
    });
    conversation.set([]);
    asking.set(false);
    resetViews();
    resetDock();
  });

  it('starts as a button in the corner, out of the way of the view', () => {
    const view = render(AssistantDock);

    expect(view.getByRole('button', { name: 'Open the assistant' })).toBeInTheDocument();
    expect(view.queryByRole('dialog', { name: 'Assistant' })).not.toBeInTheDocument();
  });

  it('opens the chat over the view, with the message box ready for the question', async () => {
    const view = render(AssistantDock);

    await fireEvent.click(view.getByRole('button', { name: 'Open the assistant' }));

    const panel = view.getByRole('dialog', { name: 'Assistant' });
    expect(panel).toBeInTheDocument();
    expect(await view.findByLabelText('Message')).toBe(document.activeElement);
  });

  it('rolls up into its title bar, keeping the question that was typed', async () => {
    const view = render(AssistantDock);
    await fireEvent.click(view.getByRole('button', { name: 'Open the assistant' }));
    await fireEvent.input(await view.findByLabelText('Message'), { target: { value: 'What is due today?' } });

    await fireEvent.click(view.getByRole('button', { name: 'Minimize the assistant' }));

    expect(get(dockState)).toBe('minimized');
    expect(view.getByRole('dialog', { name: 'Assistant' })).toBeInTheDocument();

    await fireEvent.click(view.getByRole('button', { name: 'Expand the assistant' }));

    expect(view.getByLabelText('Message')).toHaveValue('What is due today?');
  });

  it('rolls up on Escape rather than closing, so nothing typed is lost by a stray key', async () => {
    const view = render(AssistantDock);
    await fireEvent.click(view.getByRole('button', { name: 'Open the assistant' }));

    await fireEvent.keyDown(view.getByRole('dialog', { name: 'Assistant' }), { key: 'Escape' });

    expect(get(dockState)).toBe('minimized');
  });

  it('closes back to the button, which takes the focus again', async () => {
    const view = render(AssistantDock);
    await fireEvent.click(view.getByRole('button', { name: 'Open the assistant' }));

    await fireEvent.click(view.getByRole('button', { name: 'Close the assistant' }));

    const launcher = view.getByRole('button', { name: 'Open the assistant' });
    expect(view.queryByRole('dialog', { name: 'Assistant' })).not.toBeInTheDocument();
    expect(launcher).toBe(document.activeElement);
  });

  it('hands the conversation to the Assistant tab, which shows the same one', async () => {
    const view = render(AssistantDock);
    await fireEvent.click(view.getByRole('button', { name: 'Open the assistant' }));

    await fireEvent.click(view.getByRole('button', { name: 'Open the assistant in a tab' }));

    expect(get(openViews)).toEqual(['dashboard', 'assistant']);
    expect(get(activeView)).toBe('assistant');
    expect(get(dockState)).toBe('closed');
  });

  it('says on the button that an answer arrived while it was closed, and clears that when it is opened', async () => {
    const view = render(AssistantDock);

    conversation.set([
      { role: 'user', content: 'What is due?' },
      { role: 'assistant', content: 'Two tasks.', toolCalls: [] },
    ]);
    expect(await view.findByRole('button', { name: 'Open the assistant, 1 new answer' })).toBeInTheDocument();

    await fireEvent.click(view.getByRole('button', { name: /^Open the assistant/ }));

    expect(get(unreadReplies)).toBe(0);
  });

  it('says that an answer is on its way while the user works on', async () => {
    const view = render(AssistantDock);

    asking.set(true);

    expect(await view.findByText('Thinking…')).toBeInTheDocument();
  });

  it('shows the answer in the panel when it is open, and counts nothing as unread', async () => {
    openDock();
    const view = render(AssistantDock);

    conversation.set([
      { role: 'user', content: 'What is due?' },
      { role: 'assistant', content: 'Two tasks.', toolCalls: [] },
    ]);

    expect(await view.findByText('Two tasks.')).toBeInTheDocument();
    expect(get(unreadReplies)).toBe(0);
  });
});
