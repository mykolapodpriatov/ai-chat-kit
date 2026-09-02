'use client';

import { useCallback, useRef, useState, type KeyboardEvent } from 'react';

// The input.
//
// Enter sends, Shift+Enter inserts a newline — the convention every chat UI
// uses, and getting it backwards is immediately infuriating. While a reply is
// streaming the submit button becomes Stop rather than being disabled: the user
// most wants to interrupt exactly when the model is talking.

export interface ComposerProps {
  onSend: (content: string) => void;
  onStop?: () => void;
  isStreaming?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  buttonClassName?: string;
}

export function Composer({
  onSend,
  onStop,
  isStreaming = false,
  disabled = false,
  placeholder = 'Send a message…',
  className,
  inputClassName,
  buttonClassName,
}: ComposerProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const submit = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    onSend(trimmed);
    setValue('');
    // Keep focus in the composer: a chat where you must click back into the box
    // after every message is a chat nobody uses twice.
    inputRef.current?.focus();
  }, [onSend, value]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      // isComposing guards IME input: pressing Enter to choose a candidate in
      // Japanese, Chinese or Korean must not send a half-composed message.
      if (
        event.key !== 'Enter' ||
        event.shiftKey ||
        event.nativeEvent.isComposing
      ) {
        return;
      }
      event.preventDefault();
      submit();
    },
    [submit],
  );

  return (
    <form
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label htmlFor="ai-chat-kit-composer" data-part="label">
        Message
      </label>
      <textarea
        id="ai-chat-kit-composer"
        ref={inputRef}
        className={inputClassName}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={2}
      />
      {isStreaming && onStop ? (
        <button type="button" onClick={onStop} className={buttonClassName}>
          Stop
        </button>
      ) : (
        <button
          type="submit"
          disabled={disabled || value.trim().length === 0}
          className={buttonClassName}
        >
          Send
        </button>
      )}
    </form>
  );
}
