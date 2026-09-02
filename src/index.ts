// Public entry point: the headless surface plus the React layer.
//
// Consumers who want no components import `ai-chat-kit/headless` instead — same
// core, none of the UI.

export * from './headless';

export { Chat, type ChatProps } from './components/Chat';
export { MessageList, type MessageListProps } from './components/MessageList';
export {
  MessageBubble,
  type MessageBubbleProps,
} from './components/MessageBubble';
export { Composer, type ComposerProps } from './components/Composer';
