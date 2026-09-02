import { describe, expect, it, vi } from 'vitest';

import { ChatAbortError, NetworkError } from './errors';
import { createChatStore } from './store';

describe('createChatStore snapshots', () => {
  it('starts idle with no messages', () => {
    const store = createChatStore();
    const snapshot = store.getSnapshot();

    expect(snapshot.status).toBe('idle');
    expect(snapshot.messages).toEqual([]);
    expect(snapshot.error).toBeNull();
  });

  it('returns a referentially identical snapshot when nothing changed', () => {
    // This is not a nicety. useSyncExternalStore compares snapshots by
    // reference and re-renders forever if a fresh object comes back each call.
    const store = createChatStore();

    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });

  it('returns a new snapshot after a change', () => {
    const store = createChatStore();
    const before = store.getSnapshot();
    store.appendMessage({ role: 'user', content: 'hi' });

    expect(store.getSnapshot()).not.toBe(before);
  });

  it('accepts seed messages', () => {
    const store = createChatStore({
      initialMessages: [{ role: 'system', content: 'Be brief.' }],
    });

    expect(store.getSnapshot().messages).toHaveLength(1);
    expect(store.getSnapshot().messages[0]?.role).toBe('system');
  });
});

describe('createChatStore subscriptions', () => {
  it('notifies subscribers on change and stops after unsubscribe', () => {
    const store = createChatStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.appendMessage({ role: 'user', content: 'hi' });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.appendMessage({ role: 'user', content: 'again' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps other subscribers alive when one unsubscribes', () => {
    const store = createChatStore();
    const first = vi.fn();
    const second = vi.fn();
    const off = store.subscribe(first);
    store.subscribe(second);

    off();
    store.appendMessage({ role: 'user', content: 'hi' });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('per-message snapshots', () => {
  it('leaves an untouched message referentially identical after a delta elsewhere', () => {
    // The property the whole design exists for: streaming into one message must
    // not invalidate any other, so subscribed components do not re-render.
    const store = createChatStore();
    const first = store.appendMessage({ role: 'assistant', content: 'done' });
    const second = store.appendMessage({ role: 'assistant', content: '' });

    const firstBefore = store.getMessageSnapshot(first);
    store.startStreaming(second);
    store.appendDelta(second, 'hello');

    expect(store.getMessageSnapshot(first)).toBe(firstBefore);
  });

  it('replaces the snapshot of the message that received the delta', () => {
    const store = createChatStore();
    const id = store.appendMessage({ role: 'assistant', content: '' });
    const before = store.getMessageSnapshot(id);

    store.appendDelta(id, 'hi');

    expect(store.getMessageSnapshot(id)).not.toBe(before);
    expect(store.getMessageSnapshot(id)?.content).toBe('hi');
  });

  it('is stable across repeated reads', () => {
    const store = createChatStore();
    const id = store.appendMessage({ role: 'user', content: 'hi' });

    expect(store.getMessageSnapshot(id)).toBe(store.getMessageSnapshot(id));
  });

  it('returns undefined for a message that does not exist', () => {
    expect(createChatStore().getMessageSnapshot('nope')).toBeUndefined();
  });

  it('notifies a per-message subscriber only for its own message', () => {
    const store = createChatStore();
    const watched = store.appendMessage({ role: 'assistant', content: '' });
    const other = store.appendMessage({ role: 'assistant', content: '' });
    const listener = vi.fn();
    store.subscribeToMessage(watched, listener);

    store.appendDelta(other, 'not mine');
    expect(listener).not.toHaveBeenCalled();

    store.appendDelta(watched, 'mine');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('streaming lifecycle', () => {
  it('moves through submitted → streaming → idle', () => {
    const store = createChatStore();
    const id = store.appendMessage({ role: 'assistant', content: '' });

    store.setStatus('submitted');
    expect(store.getSnapshot().status).toBe('submitted');

    store.startStreaming(id);
    expect(store.getSnapshot().status).toBe('streaming');
    expect(store.getMessageSnapshot(id)?.streaming).toBe(true);

    store.finishStreaming(id);
    expect(store.getSnapshot().status).toBe('idle');
    expect(store.getMessageSnapshot(id)?.streaming).toBe(false);
  });

  it('accumulates deltas in order', () => {
    const store = createChatStore();
    const id = store.appendMessage({ role: 'assistant', content: '' });

    for (const token of ['Once', ' upon', ' a', ' time']) {
      store.appendDelta(id, token);
    }

    expect(store.getMessageSnapshot(id)?.content).toBe('Once upon a time');
  });

  it('records an error and clears the streaming flag', () => {
    const store = createChatStore();
    const id = store.appendMessage({ role: 'assistant', content: 'partial' });
    store.startStreaming(id);

    const error = new NetworkError('upstream died', { status: 502 });
    store.fail(error);

    expect(store.getSnapshot().status).toBe('error');
    expect(store.getSnapshot().error).toBe(error);
    expect(store.getMessageSnapshot(id)?.streaming).toBe(false);
    // Whatever arrived before the failure is kept: throwing away a
    // half-finished answer is worse than showing it with an error beside it.
    expect(store.getMessageSnapshot(id)?.content).toBe('partial');
  });

  it('treats an abort as a return to idle, not an error', () => {
    const store = createChatStore();
    const id = store.appendMessage({ role: 'assistant', content: 'partial' });
    store.startStreaming(id);

    store.fail(new ChatAbortError());

    expect(store.getSnapshot().status).toBe('idle');
    expect(store.getSnapshot().error).toBeNull();
  });

  it('clears a previous error when a new request starts', () => {
    const store = createChatStore();
    store.fail(new NetworkError('boom'));
    expect(store.getSnapshot().error).not.toBeNull();

    store.setStatus('submitted');

    expect(store.getSnapshot().error).toBeNull();
  });

  it('ignores deltas addressed to an unknown message', () => {
    const store = createChatStore();
    const before = store.getSnapshot();

    store.appendDelta('nope', 'text');

    expect(store.getSnapshot()).toBe(before);
  });

  it('reset returns the store to its initial messages', () => {
    const store = createChatStore({
      initialMessages: [{ role: 'system', content: 'Be brief.' }],
    });
    store.appendMessage({ role: 'user', content: 'hi' });
    store.fail(new NetworkError('boom'));

    store.reset();

    expect(store.getSnapshot().messages).toHaveLength(1);
    expect(store.getSnapshot().status).toBe('idle');
    expect(store.getSnapshot().error).toBeNull();
  });
});
