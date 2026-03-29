import type { CSSProperties } from 'react';

export type ChatMessageType = 'user' | 'agent';

export interface ChatMessage {
  type: ChatMessageType;
  text: string;
  hasTyped?: boolean;
}

export interface ChatWidgetProps {
  websocketUrl?: string;
  email: string;
  sessionId?: string;
  voiceAnimationData?: unknown;
  className?: string;
  style?: CSSProperties;
}
