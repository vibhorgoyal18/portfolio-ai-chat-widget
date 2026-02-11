import type { CSSProperties } from 'react';

export type ChatMessageType = 'user' | 'agent';

export interface ChatMessage {
  type: ChatMessageType;
  text: string;
  hasTyped?: boolean;
}

export interface ChatWidgetProps {
  websocketUrl: string;
  initData: Record<string, unknown> | string;
  elevenlabsVoiceId?: string;
  openaiVoiceId?: string;
  sessionId?: string;
  voiceAnimationData?: unknown;
  className?: string;
  style?: CSSProperties;
}
