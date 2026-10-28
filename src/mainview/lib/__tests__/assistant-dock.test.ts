import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { conversation } from '../assistant';
import { closeDock, dockFits, dockState, minimizeDock, openDock, resetDock, toggleDock, unreadReplies } from '../assistant-dock';
import { activeView, resetViews } from '../views';

const answered = (replies: number) => [
  { role: 'user' as const, content: 'What is due?' },
  ...Array.from({ length: replies }, (_, index) => ({ role: 'assistant' as const, content: `Answer ${index + 1}`, toolCalls: [] })),
];

describe('where the floating assistant belongs', () => {
  it('floats over the views of the user’s data, and not over its own settings or its own tab', () => {
    expect(dockFits('dashboard')).toBe(true);
    expect(dockFits('calendar')).toBe(true);
    expect(dockFits('todo')).toBe(true);
    expect(dockFits('task:dev:42')).toBe(true);
    expect(dockFits('about')).toBe(true);
    expect(dockFits('settings')).toBe(false);
    expect(dockFits('assistant')).toBe(false);
  });
});

describe('the state of the floating assistant', () => {
  beforeEach(() => {
    resetViews();
    conversation.set([]);
    resetDock();
  });

  it('opens, rolls up and closes', () => {
    openDock();
    expect(get(dockState)).toBe('open');

    minimizeDock();
    expect(get(dockState)).toBe('minimized');

    closeDock();
    expect(get(dockState)).toBe('closed');
  });

  it('is toggled open from the button, and rolled up again from its title bar', () => {
    toggleDock();
    expect(get(dockState)).toBe('open');

    toggleDock();
    expect(get(dockState)).toBe('minimized');

    toggleDock();
    expect(get(dockState)).toBe('open');
  });

  it('counts the answers that arrived while the user was not looking at them', () => {
    conversation.set(answered(1));
    expect(get(unreadReplies)).toBe(1);

    conversation.set(answered(3));
    expect(get(unreadReplies)).toBe(3);
  });

  it('counts nothing while the panel is open, or while the Assistant tab is the view', () => {
    openDock();
    conversation.set(answered(1));
    expect(get(unreadReplies)).toBe(0);

    minimizeDock();
    conversation.set(answered(2));
    expect(get(unreadReplies)).toBe(1);

    activeView.set('assistant');
    expect(get(unreadReplies)).toBe(0);
    conversation.set(answered(3));
    expect(get(unreadReplies)).toBe(0);
  });

  it('starts counting again from nothing when the conversation is cleared', () => {
    conversation.set(answered(2));
    expect(get(unreadReplies)).toBe(2);

    conversation.set([]);
    expect(get(unreadReplies)).toBe(0);

    conversation.set(answered(1));
    expect(get(unreadReplies)).toBe(1);
  });
});
