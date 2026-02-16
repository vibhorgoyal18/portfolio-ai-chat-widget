import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Lottie from 'lottie-react';
import Modal from './Modal';
import Waveform from './Waveform';
import voiceAnimation from '../assets/voice-animation.json';
import type { ChatMessage, ChatWidgetProps } from '../types';

const FTE_DATA = {
  welcome: {
    message: '👋 Talk to my AI assistant!',
    description: 'Ask about my experience, skills, or projects. You can even speak to it!'
  },
  features: {
    voice: {
      title: 'Voice Commands',
      description: 'Tap to speak to the assistant'
    },
    input: {
      title: 'Type Questions',
      description: 'Type your queries here'
    },
    dismiss: 'Got it'
  }
};

interface TypewriterProps {
  text: string;
  onUpdate?: () => void;
  onComplete?: () => void;
}

const Typewriter: React.FC<TypewriterProps> = ({ text, onUpdate, onComplete }) => {
  const [displayedContent, setDisplayedContent] = useState('');

  const onUpdateRef = useRef(onUpdate);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onUpdateRef.current = onUpdate;
    onCompleteRef.current = onComplete;
  }, [onUpdate, onComplete]);

  useEffect(() => {
    setDisplayedContent('');

    if (!text) {
      onCompleteRef.current?.();
      return;
    }

    let currentIndex = 0;
    let currentHtml = '';

    const tokens = text.split(/(<[^>]*>)/g).reduce((acc: string[], part) => {
      if (part.startsWith('<') && part.endsWith('>')) {
        acc.push(part);
      } else if (part) {
        acc.push(...part.split(''));
      }
      return acc;
    }, [] as string[]);

    const interval = window.setInterval(() => {
      if (currentIndex >= tokens.length) {
        clearInterval(interval);
        onCompleteRef.current?.();
        return;
      }

      const nextToken = tokens[currentIndex];
      currentHtml += nextToken;
      setDisplayedContent(currentHtml);
      currentIndex++;
      onUpdateRef.current?.();
    }, 20);

    return () => clearInterval(interval);
  }, [text]);

  return (
    <div
      dangerouslySetInnerHTML={{ __html: displayedContent }}
      className="text-sm [&>ul]:list-disc [&>ul]:pl-4 [&>ol]:list-decimal [&>ol]:pl-4 [&>p]:mb-2 [&>p:last-child]:mb-0 [&>a]:text-blue-500 [&>a]:underline dark:[&>a]:text-blue-400"
    />
  );
};

const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

const isIOSDevice = () => {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
};

const getSessionId = () => {
  let sessionId = localStorage.getItem('chat_session_id');
  if (!sessionId) {
    sessionId = generateUUID();
    localStorage.setItem('chat_session_id', sessionId);
  }
  return sessionId;
};

const DEFAULT_WS_URL = 'ws://localhost:5001/ws';

const normalizeWebsocketUrl = (rawUrl?: string) => {
  const baseUrl = rawUrl || DEFAULT_WS_URL;

  try {
    const url = new URL(baseUrl);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      if (!url.pathname || url.pathname === '/') {
        url.pathname = '/ws';
      }
    }
    return url.toString();
  } catch (err) {
    if (baseUrl.startsWith('ws://') || baseUrl.startsWith('wss://')) {
      return baseUrl;
    }
    return DEFAULT_WS_URL;
  }
};

const ChatWidget: React.FC<ChatWidgetProps> = ({
  websocketUrl,
  initData,
  elevenlabsVoiceId,
  openaiVoiceId,
  sessionId: sessionIdProp,
  voiceAnimationData,
  className,
  style
}) => {
  const resolvedWebsocketUrl = normalizeWebsocketUrl(websocketUrl);
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [showFTE, setShowFTE] = useState(false);
  const [fteStep, setFteStep] = useState(0);
  const [isIOSModalOpen, setIsIOSModalOpen] = useState(false);
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [isAgentReady, setIsAgentReady] = useState(false);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [sessionId, setSessionId] = useState(() => sessionIdProp || getSessionId());

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<number | null>(null);
  const audioQueueRef = useRef<string[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef(0);
  const lastPlayedIndexRef = useRef(-1);
  const isPlayingRef = useRef(false);
  const streamEndedRef = useRef(false);
  const playbackScheduledRef = useRef(false);
  const isProcessingBatchRef = useRef(false);
  const scheduleTimeoutRef = useRef<number | null>(null);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const manualStopRef = useRef(false);
  const shouldAutoRestartMicRef = useRef(false);
  const stoppedForAudioRef = useRef(false);
  const responseMessageShownRef = useRef(false);
  const firstAudioChunkTimeRef = useRef<number | null>(null);
  const displayMessageTimeoutRef = useRef<number | null>(null);
  const MIN_BUFFER = 5;
  const IDEAL_BATCH = 8;
  const PLAYBACK_TIMEOUT = 500;
  const TEXT_DISPLAY_DELAY = 500;

  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const fullTranscriptRef = useRef('');
  const audioRef = useRef(new Audio());
  const isAudioUnlockedRef = useRef(false);
  const hasAudioPermissionRef = useRef(false);
  const analyserRef = useRef<AnalyserNode | null>(null);

  // iOS-specific audio recording refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const silenceDetectionTimerRef = useRef<number | null>(null);
  const voiceAnalyserRef = useRef<AnalyserNode | null>(null);
  const silenceCheckIntervalRef = useRef<number | null>(null);

  const initDataString = typeof initData === 'string' ? initData : JSON.stringify(initData);
  const resolvedVoiceAnimation = voiceAnimationData || voiceAnimation;

  useEffect(() => {
    if (sessionIdProp) {
      setSessionId(sessionIdProp);
    }
  }, [sessionIdProp]);

  useEffect(() => {
    const hasSeenFTE = localStorage.getItem('hasSeenFTE');
    if (!hasSeenFTE) {
      const timer = window.setTimeout(() => setShowFTE(true), 1500);
      return () => clearTimeout(timer);
    }

    if (!localStorage.getItem('chat_session_id')) {
      localStorage.setItem('chat_session_id', generateUUID());
    }
  }, []);

  const dismissFTE = () => {
    setShowFTE(false);
    localStorage.setItem('hasSeenFTE', 'true');
    setFteStep(0);
  };

  const handleNextStep = () => {
    setFteStep((prev) => prev + 1);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const initAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();

      const analyser = audioContextRef.current.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      nextPlayTimeRef.current = audioContextRef.current.currentTime;
    }
  }, []);

  const stopAudioPlayback = useCallback(() => {
    if (scheduleTimeoutRef.current) {
      clearTimeout(scheduleTimeoutRef.current);
      scheduleTimeoutRef.current = null;
    }

    if (displayMessageTimeoutRef.current) {
      clearTimeout(displayMessageTimeoutRef.current);
      displayMessageTimeoutRef.current = null;
    }

    activeSourcesRef.current.forEach((source) => {
      try {
        source.stop();
      } catch (e) {
        // Ignore already-stopped sources.
      }
    });
    activeSourcesRef.current = [];

    audioQueueRef.current = [];
    isPlayingRef.current = false;
    setIsAudioPlaying(false);
    streamEndedRef.current = false;
    lastPlayedIndexRef.current = -1;
    playbackScheduledRef.current = false;
    isProcessingBatchRef.current = false;
    shouldAutoRestartMicRef.current = false;
    stoppedForAudioRef.current = false;
    responseMessageShownRef.current = false;
    firstAudioChunkTimeRef.current = null;
    if (audioContextRef.current) {
      nextPlayTimeRef.current = audioContextRef.current.currentTime;
    }
  }, []);

  const playNextBatch = useCallback(async () => {
    if (isProcessingBatchRef.current) {
      return;
    }

    isProcessingBatchRef.current = true;
    playbackScheduledRef.current = false;

    try {
      const newChunksAvailable = audioQueueRef.current.length - lastPlayedIndexRef.current - 1;

      if (newChunksAvailable <= 0) {
        if (streamEndedRef.current && !isPlayingRef.current) {
          // Finished playback.
        }
        return;
      }

      let batchSize;
      if (streamEndedRef.current) {
        batchSize = newChunksAvailable;
      } else {
        batchSize = Math.min(IDEAL_BATCH, newChunksAvailable);
        if (newChunksAvailable < MIN_BUFFER && !isPlayingRef.current) {
          return;
        }
      }

      initAudioContext();

      const startIdx = lastPlayedIndexRef.current + 1;
      const endIdx = startIdx + batchSize;
      const batchChunks = audioQueueRef.current.slice(startIdx, endIdx);

      const allBytes = batchChunks.flatMap((chunk) => {
        const binary = atob(chunk);
        return Array.from(binary).map((c) => c.charCodeAt(0));
      });

      const blob = new Blob([new Uint8Array(allBytes)], { type: 'audio/mpeg' });
      const arrayBuffer = await blob.arrayBuffer();
      const audioBuffer = await audioContextRef.current!.decodeAudioData(arrayBuffer);

      const source = audioContextRef.current!.createBufferSource();
      source.buffer = audioBuffer;
      if (analyserRef.current) {
        source.connect(analyserRef.current);
        analyserRef.current.connect(audioContextRef.current!.destination);
      } else {
        source.connect(audioContextRef.current!.destination);
      }

      activeSourcesRef.current.push(source);

      const playTime = Math.max(nextPlayTimeRef.current, audioContextRef.current!.currentTime);
      source.start(playTime);
      nextPlayTimeRef.current = playTime + audioBuffer.duration;

      lastPlayedIndexRef.current = endIdx - 1;
      isPlayingRef.current = true;
      setIsAudioPlaying(true);

      source.onended = () => {
        if (scheduleTimeoutRef.current) {
          clearTimeout(scheduleTimeoutRef.current);
          scheduleTimeoutRef.current = null;
        }
        playbackScheduledRef.current = false;

        const idx = activeSourcesRef.current.indexOf(source);
        if (idx > -1) activeSourcesRef.current.splice(idx, 1);

        const remainingChunks = audioQueueRef.current.length - lastPlayedIndexRef.current - 1;
        const hasActiveSources = activeSourcesRef.current.length > 0;

        if (remainingChunks > 0 || !streamEndedRef.current || hasActiveSources) {
          playNextBatch();
        } else {
          isPlayingRef.current = false;
          setIsAudioPlaying(false);

          if (shouldAutoRestartMicRef.current) {
            shouldAutoRestartMicRef.current = false;
            stoppedForAudioRef.current = false;
            setTimeout(() => {
              if (!isListening && !manualStopRef.current) {
                startRecognition();
              }
            }, 300);
          }
        }
      };
    } catch (err) {
      console.error('[Audio] playNextBatch error:', err);
      isPlayingRef.current = false;
      setIsAudioPlaying(false);
    } finally {
      isProcessingBatchRef.current = false;
    }
  }, [initAudioContext]);

  const scheduleNextBatch = useCallback(() => {
    if (scheduleTimeoutRef.current) {
      clearTimeout(scheduleTimeoutRef.current);
      scheduleTimeoutRef.current = null;
    }

    if (playbackScheduledRef.current || isProcessingBatchRef.current) {
      return;
    }

    const remainingChunks = audioQueueRef.current.length - lastPlayedIndexRef.current - 1;

    if (remainingChunks >= IDEAL_BATCH || streamEndedRef.current) {
      playbackScheduledRef.current = true;
      scheduleTimeoutRef.current = window.setTimeout(() => {
        scheduleTimeoutRef.current = null;
        playNextBatch();
      }, 10);
    } else if (remainingChunks > 0) {
      playbackScheduledRef.current = true;
      scheduleTimeoutRef.current = window.setTimeout(() => {
        scheduleTimeoutRef.current = null;
        playNextBatch();
      }, PLAYBACK_TIMEOUT);
    }
  }, [playNextBatch]);

  const enqueueAudioChunk = useCallback(
    (chunk: string) => {
      if (!chunk) return;

      const isFirstChunk = audioQueueRef.current.length === 0 || !isPlayingRef.current;
      const isMicActive = recognitionRef.current !== null && recognitionRef.current !== undefined;

      if (isFirstChunk) {
        firstAudioChunkTimeRef.current = Date.now();

        if (isMicActive && !shouldAutoRestartMicRef.current) {
          shouldAutoRestartMicRef.current = true;
          stoppedForAudioRef.current = true;
          recognitionRef.current.stop();
          setIsListening(false);
        }
      }

      audioQueueRef.current.push(chunk);

      const unplayedChunks = audioQueueRef.current.length - lastPlayedIndexRef.current - 1;

      if (!isPlayingRef.current && unplayedChunks >= MIN_BUFFER) {
        playNextBatch();
      } else if (isPlayingRef.current && !playbackScheduledRef.current) {
        scheduleNextBatch();
      }
    },
    [playNextBatch, scheduleNextBatch]
  );

  const handleAudioEnd = useCallback(() => {
    streamEndedRef.current = true;
    if (!playbackScheduledRef.current) {
      playNextBatch();
    }
  }, [playNextBatch]);

  const sendInterrupt = useCallback(() => {
    stopAudioPlayback();
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'interrupt' }));
    }
    setIsLoading(false);
  }, [stopAudioPlayback]);

  const markMessageAsTyped = (index: number) => {
    setMessages((prev) =>
      prev.map((msg, i) => {
        if (i === index) return { ...msg, hasTyped: true };
        return msg;
      })
    );
  };

  const unlockAudio = () => {
    if (audioRef.current && !isAudioUnlockedRef.current) {
      audioRef.current.play().catch(() => {});
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      isAudioUnlockedRef.current = true;
    }
  };

  const handleServerMessage = useCallback(
    (payload: any) => {
      if (!payload) return;

      console.log('[Debug] Received server message:', payload);

      const audioChunk = payload.audio_chunk || payload.chunk || payload.audio;
      if (payload.type === 'audio_chunk' && audioChunk) {
        enqueueAudioChunk(audioChunk);
        return;
      }

      if (payload.type === 'interrupt_ack') {
        stopAudioPlayback();
        setIsLoading(false);
        return;
      }

      if (payload.type === 'error') {
        setMessages((prev) => [
          ...prev,
          { type: 'agent', text: payload.message || 'Sorry, something went wrong.', hasTyped: false }
        ]);
        setIsLoading(false);
        return;
      }

      if (payload.type === 'done' || payload.done) {
        setIsLoading(false);
        return;
      }

      if (payload.type === 'transcription') {
        // Handle transcription from backend for iOS
        const transcribedText = payload.text || '';
        setCurrentTranscript('');
        fullTranscriptRef.current = '';

        // Reset for the new response cycle (iOS audio flow bypasses sendChatMessage)
        responseMessageShownRef.current = false;
        firstAudioChunkTimeRef.current = null;

        if (transcribedText.trim()) {
          setMessages((prev) => [...prev, { type: 'user', text: transcribedText }]);
          setIsLoading(true); // Show loading while backend processes the transcribed text
        }
        return;
      }

      if (payload.type === 'audio_end') {
        handleAudioEnd();
        setIsLoading(false);
        return;
      }

      if (payload.type === 'display' && payload.html) {
        console.log('[Debug] Display message received, responseMessageShownRef:', responseMessageShownRef.current);
        if (!responseMessageShownRef.current) {
          responseMessageShownRef.current = true;

          if (firstAudioChunkTimeRef.current) {
            const elapsedSinceFirstAudio = Date.now() - firstAudioChunkTimeRef.current;
            const remainingDelay = Math.max(0, TEXT_DISPLAY_DELAY - elapsedSinceFirstAudio);

            displayMessageTimeoutRef.current = window.setTimeout(() => {
              console.log('[Debug] Adding agent message to UI (delayed):', payload.html.substring(0, 50));
              setMessages((prev) => [...prev, { type: 'agent', text: payload.html, hasTyped: false }]);
              setIsLoading(false);
              displayMessageTimeoutRef.current = null;
            }, remainingDelay);
          } else {
            console.log('[Debug] Adding agent message to UI:', payload.html.substring(0, 50));
            setMessages((prev) => [...prev, { type: 'agent', text: payload.html, hasTyped: false }]);
            setIsLoading(false);
          }
        } else {
          console.log('[Debug] Message blocked - responseMessageShownRef is true');
        }
        return;
      }

      if (audioChunk) {
        enqueueAudioChunk(audioChunk);
      }

      if (payload.display_text || payload.type === 'display_text' || payload.response || payload.message || payload.text) {
        const html = payload.display_text || payload.response || payload.message || payload.text || 'I got your message.';
        setMessages((prev) => [...prev, { type: 'agent', text: html, hasTyped: false }]);
        setIsLoading(false);
        return;
      }

      if (typeof payload === 'string') {
        setMessages((prev) => [...prev, { type: 'agent', text: payload, hasTyped: false }]);
        setIsLoading(false);
      }
    },
    [enqueueAudioChunk, stopAudioPlayback, handleAudioEnd]
  );

  const buildWebSocketUrl = useCallback(
    (targetSessionId?: string) => {
      const activeSessionId = targetSessionId || getSessionId();

      try {
        const url = new URL(resolvedWebsocketUrl);
        url.searchParams.set('session_id', activeSessionId);
        if (elevenlabsVoiceId) url.searchParams.set('elevenlabs_voice_id', elevenlabsVoiceId);
        if (openaiVoiceId) url.searchParams.set('openai_voice_id', openaiVoiceId);
        return url.toString();
      } catch (err) {
        const separator = resolvedWebsocketUrl.includes('?') ? '&' : '?';
        const params = new URLSearchParams({ session_id: activeSessionId });
        if (elevenlabsVoiceId) params.set('elevenlabs_voice_id', elevenlabsVoiceId);
        if (openaiVoiceId) params.set('openai_voice_id', openaiVoiceId);
        return `${resolvedWebsocketUrl}${separator}${params.toString()}`;
      }
    },
    [resolvedWebsocketUrl, elevenlabsVoiceId, openaiVoiceId]
  );

  const connectWebSocket = useCallback(
    (overrideSessionId?: string) => {
      const activeSessionId = overrideSessionId || sessionId || getSessionId();

      if (!sessionId && activeSessionId) {
        setSessionId(activeSessionId);
      }

      if (wsRef.current) {
        if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
          return;
        }
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.onmessage = null;
        wsRef.current.onopen = null;
        try {
          wsRef.current.close();
        } catch (e) {
          // Ignore close errors.
        }
        wsRef.current = null;
      }

      try {
        const wsUrl = buildWebSocketUrl(activeSessionId);
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          setWsConnected(true);

          try {
            ws.send(
              JSON.stringify({
                type: 'init_data',
                content: initDataString
              })
            );
          } catch (e) {
            console.error('[WebSocket] Failed to send init_data:', e);
            setMessages((prev) => [
              ...prev,
              {
                type: 'agent',
                text: 'Failed to initialize chat data. Please try again.',
                hasTyped: false
              }
            ]);
          }
        };

        ws.onmessage = (event) => {
          try {
            const parsed = JSON.parse(event.data);

            if (parsed.type === 'init_success') {
              setIsAgentReady(true);
              return;
            }

            if (parsed.type === 'error' && (parsed.message?.includes('data_url') || parsed.message?.includes('Failed to load data'))) {
              setMessages((prev) => [
                ...prev,
                {
                  type: 'agent',
                  text: `Connection error: ${parsed.message}. Please check your configuration.`,
                  hasTyped: false
                }
              ]);
              setWsConnected(false);
              setIsLoading(false);
              if (reconnectRef.current) {
                clearTimeout(reconnectRef.current);
                reconnectRef.current = null;
              }
              ws.close();
              return;
            }

            handleServerMessage(parsed);
          } catch (err) {
            handleServerMessage({ type: 'display_text', text: event.data });
          }
        };

        ws.onerror = (error) => {
          console.error('[WebSocket] Connection error:', error);
          setWsConnected(false);
          setIsLoading(false);
        };

        ws.onclose = (event) => {
          setWsConnected(false);
          setIsLoading(false);
          wsRef.current = null;

          if (event.code === 1008 || event.code === 1003) {
            if (reconnectRef.current) {
              clearTimeout(reconnectRef.current);
              reconnectRef.current = null;
            }
            return;
          }

          if (reconnectRef.current) clearTimeout(reconnectRef.current);
          reconnectRef.current = window.setTimeout(() => {
            connectWebSocket();
          }, 2000);
        };
      } catch (err) {
        console.error('Failed to create WebSocket connection:', err);
        setWsConnected(false);
        wsRef.current = null;
        if (reconnectRef.current) clearTimeout(reconnectRef.current);
        reconnectRef.current = window.setTimeout(connectWebSocket, 2000);
      }
    },
    [buildWebSocketUrl, handleServerMessage, sessionId, initDataString]
  );

  const sendChatMessage = useCallback(
    (text: string, isAudioConversation = false) => {
      const ws = wsRef.current;

      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setMessages((prev) => [
          ...prev,
          { type: 'agent', text: 'Connection unavailable. Reconnecting...', hasTyped: false }
        ]);
        setIsLoading(false);
        connectWebSocket();
        return;
      }

      // Reset response message flag for new request
      responseMessageShownRef.current = false;
      firstAudioChunkTimeRef.current = null;
      console.log('[Debug] sendChatMessage - Reset flags for new request');

      try {
        ws.send(
          JSON.stringify({
            type: 'user_message',
            text,
            isAudioConversation
          })
        );
      } catch (err) {
        console.error('[Audio] sendChatMessage: Failed to send over WebSocket', err);
        setMessages((prev) => [
          ...prev,
          { type: 'agent', text: 'Failed to send message. Please try again.', hasTyped: false }
        ]);
        setIsLoading(false);
      }
    },
    [connectWebSocket]
  );

  useEffect(() => {
    if (isOpen) {
      connectWebSocket();
    }
  }, [isOpen, connectWebSocket]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, currentTranscript, isListening]);

  useEffect(() => {
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
      stopAudioPlayback();
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, [stopAudioPlayback]);

  useEffect(() => {
    firstAudioChunkTimeRef.current = null;
    responseMessageShownRef.current = false;
  }, []);

  const handleVoiceMessageInternal = async (text: string) => {
    if (!text) return;

    if (isPlayingRef.current) {
      sendInterrupt();
    }

    setMessages((prev) => [...prev, { type: 'user', text }]);
    setCurrentTranscript('');
    fullTranscriptRef.current = '';
    setIsLoading(true);
    stopAudioPlayback();

    const waitForConnection = () => {
      return new Promise<void>((resolve) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          resolve();
        } else {
          const checkInterval = window.setInterval(() => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 50);
          window.setTimeout(() => {
            clearInterval(checkInterval);
            resolve();
          }, 2000);
        }
      });
    };

    await waitForConnection();
    sendChatMessage(text, true);
  };

  useEffect(() => {
    return () => {
      if (recognitionRef.current) recognitionRef.current.abort();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (silenceCheckIntervalRef.current) {
        clearInterval(silenceCheckIntervalRef.current);
      }
      if (silenceDetectionTimerRef.current) {
        clearTimeout(silenceDetectionTimerRef.current);
      }
    };
  }, []);

  const startIOSRecording = useCallback(async () => {
    try {
      setIsListening(true);
      audioChunksRef.current = [];

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      // Create audio context and analyser for silence detection
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      voiceAnalyserRef.current = analyser;

      // Create MediaRecorder - iOS Safari supports audio/mp4
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') 
        ? 'audio/webm' 
        : 'audio/mp4';
      
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      const format = mimeType === 'audio/webm' ? 'webm' : 'mp4';
      
      // Send stream start signal
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'audio_stream_start',
          format: format
        }));
      }

      // Stream audio chunks as they become available
      mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
          
          // Convert chunk to base64 and send immediately
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64Chunk = (reader.result as string).split(',')[1];
            
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({
                type: 'audio_chunk',
                chunk: base64Chunk
              }));
            }
          };
          reader.readAsDataURL(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        setIsListening(false);
        setIsLoading(true); // Show loading while audio is being transcribed

        // Reset response flag so the upcoming display message is not blocked
        responseMessageShownRef.current = false;
        firstAudioChunkTimeRef.current = null;
        
        // Send stream end signal
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'audio_stream_end',
            format: format,
            isAudioConversation: true
          }));
        }

        // Clean up
        audioChunksRef.current = [];
        voiceAnalyserRef.current = null;
        
        if (silenceCheckIntervalRef.current) {
          clearInterval(silenceCheckIntervalRef.current);
          silenceCheckIntervalRef.current = null;
        }
        
        if (silenceDetectionTimerRef.current) {
          clearTimeout(silenceDetectionTimerRef.current);
          silenceDetectionTimerRef.current = null;
        }
        
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach(track => track.stop());
          mediaStreamRef.current = null;
        }
        
        audioContext.close();
      };

      mediaRecorder.onerror = (event: any) => {
        console.error('[iOS Audio] MediaRecorder error:', event.error);
        setIsListening(false);
      };

      // Silence detection
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      const SILENCE_THRESHOLD = 10; // Adjust based on testing
      let lastVoiceTime = Date.now();

      const checkSilence = () => {
        analyser.getByteFrequencyData(dataArray);
        
        // Calculate average volume
        const average = dataArray.reduce((sum, value) => sum + value, 0) / bufferLength;
        
        if (average > SILENCE_THRESHOLD) {
          // Voice detected, reset timer
          lastVoiceTime = Date.now();
          
          if (silenceDetectionTimerRef.current) {
            clearTimeout(silenceDetectionTimerRef.current);
            silenceDetectionTimerRef.current = null;
          }
        } else {
          // Check if silent for 2 seconds
          const silenceDuration = Date.now() - lastVoiceTime;
          
          if (silenceDuration >= 2000 && !silenceDetectionTimerRef.current) {
            // Auto-stop recording after 2 seconds of silence
            silenceDetectionTimerRef.current = window.setTimeout(() => {
              if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                console.log('[iOS Audio] Auto-stopping due to silence');
                mediaRecorderRef.current.stop();
              }
            }, 100);
          }
        }
      };

      // Check silence every 100ms
      silenceCheckIntervalRef.current = window.setInterval(checkSilence, 100);

      // Start recording with 200ms timeslice for streaming
      mediaRecorder.start(200);

      // Maximum recording time of 30 seconds
      setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          console.log('[iOS Audio] Auto-stopping due to max duration');
          mediaRecorderRef.current.stop();
        }
      }, 30000);

    } catch (err: any) {
      console.error('[iOS Audio] Failed to start recording:', err);
      if (err.name === 'NotAllowedError') {
        alert('Please allow microphone access in your browser settings.');
      }
      setIsListening(false);
    }
  }, []);

  const stopIOSRecording = useCallback(() => {
    if (silenceCheckIntervalRef.current) {
      clearInterval(silenceCheckIntervalRef.current);
      silenceCheckIntervalRef.current = null;
    }
    
    if (silenceDetectionTimerRef.current) {
      clearTimeout(silenceDetectionTimerRef.current);
      silenceDetectionTimerRef.current = null;
    }
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const startRecognition = useCallback(async () => {
    if (isListening) return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (recognitionRef.current) recognitionRef.current.abort();

    // Set up audio analyser for waveform visualization
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      voiceAnalyserRef.current = analyser;
    } catch (err) {
      console.warn('[Audio] Could not set up analyser for waveform:', err);
    }

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;

    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    setIsListening(true);

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: any) => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      let content = '';
      for (let i = 0; i < event.results.length; ++i) {
        content += event.results[i][0].transcript;
      }
      setCurrentTranscript(content);
      fullTranscriptRef.current = content;
      silenceTimerRef.current = window.setTimeout(() => {
        recognition.stop();
      }, 2000);
    };

    recognition.onerror = (event: any) => {
      console.error('[Audio] Speech Recognition Error:', event.error);
      if (event.error === 'not-allowed') {
        alert('Please allow microphone access in your browser settings.');
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      voiceAnalyserRef.current = null;
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
      }
      if (fullTranscriptRef.current.trim() && !stoppedForAudioRef.current) {
        handleVoiceMessageInternal(fullTranscriptRef.current);
      }
    };

    try {
      recognition.start();
    } catch (err) {
      console.error('Speech engine start failed:', err);
      setIsListening(false);
    }
  }, [isListening, handleVoiceMessageInternal]);

  const startVoiceSession = useCallback(async () => {
    manualStopRef.current = false;

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      connectWebSocket();
    }

    unlockAudio();
    initAudioContext();

    hasAudioPermissionRef.current = true;
    setTimeout(() => {
      if (isIOSDevice()) {
        startIOSRecording();
      } else {
        startRecognition();
      }
    }, 300);
  }, [connectWebSocket, startRecognition, initAudioContext, startIOSRecording]);

  const handleMicClick = () => {
    if (isListening) {
      manualStopRef.current = true;
      if (isIOSDevice()) {
        stopIOSRecording();
      } else {
        recognitionRef.current?.stop();
        // Clean up media stream immediately
        voiceAnalyserRef.current = null;
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach(track => track.stop());
          mediaStreamRef.current = null;
        }
      }
      setIsListening(false);
      return;
    }
    if (!hasAudioPermissionRef.current) {
      setShowPermissionModal(true);
    } else {
      startVoiceSession();
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    unlockAudio();
    if (!inputValue.trim()) return;

    const ensureConnection = () => {
      if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED || wsRef.current.readyState === WebSocket.CLOSING) {
        connectWebSocket();
      }
    };

    ensureConnection();

    const userMessage = inputValue.trim();
    setMessages((prev) => [...prev, { type: 'user', text: userMessage }]);
    setInputValue('');
    setIsLoading(true);
    stopAudioPlayback();

    setTimeout(() => {
      sendChatMessage(userMessage, false);
    }, wsRef.current?.readyState === WebSocket.OPEN ? 0 : 100);
  };

  useEffect(() => {
    const handleOpenChatVoice = () => {
      setIsOpen(true);

      if (!isListening) {
        setTimeout(() => {
          if (!hasAudioPermissionRef.current) {
            setShowPermissionModal(true);
          } else {
            startVoiceSession();
          }
        }, 100);
      }
    };

    window.addEventListener('open-chat-voice', handleOpenChatVoice);
    return () => window.removeEventListener('open-chat-voice', handleOpenChatVoice);
  }, [isListening, startVoiceSession]);

  return (
    <div className={className} style={style}>
      <Modal isOpen={isIOSModalOpen} onClose={() => setIsIOSModalOpen(false)} title="iOS Audio Support">
        Voice conversation works on iOS! Tap the microphone to start speaking. Your voice will be processed through our backend for the best experience.
      </Modal>

      <Modal
        isOpen={showPermissionModal}
        onClose={() => setShowPermissionModal(false)}
        title="Voice Conversation"
        icon="mic"
        actions={
          <>
            <button
              onClick={() => {
                setShowPermissionModal(false);
                startVoiceSession();
              }}
              className="flex-1 px-4 py-2 bg-primary text-white font-bold rounded-lg hover:bg-primary/90 transition-colors"
            >
              Let's Talk
            </button>
            <button
              onClick={() => setShowPermissionModal(false)}
              className="flex-1 px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
            >
              I'd rather type
            </button>
          </>
        }
      >
        Vibhor's Digital Twin works best via voice. Ready to start the conversation?
      </Modal>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40"
            onClick={() => setIsOpen(false)}
          />
        )}
      </AnimatePresence>

      <div className="fixed bottom-[4.5rem] right-6 z-50 flex flex-col items-end print:hidden">
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="absolute bottom-0 right-0 w-[90vw] md:w-96 h-[80vh] md:h-[500px] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200 dark:border-slate-700"
            >
              <div className="bg-primary p-4 text-white flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined">smart_toy</span>
                  <h3 className="font-bold">AI Assistant</h3>
                  <span
                    className={`w-2 h-2 rounded-full ml-1 ${wsConnected ? 'bg-emerald-300' : 'bg-amber-300'}`}
                    title={wsConnected ? 'Connected' : 'Reconnecting...'}
                  />
                </div>
                <button
                  onClick={() => {
                    setIsOpen(false);
                    if (showFTE) dismissFTE();
                  }}
                  className="hover:bg-white/20 rounded-full p-1 transition-colors"
                >
                  <span className="material-symbols-outlined text-sm">close</span>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[rgb(28_36_46/var(--tw-bg-opacity,1))] relative">
                {messages.length === 0 && !isListening && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center z-10 p-6">
                    <div className="bg-slate-800 text-white p-6 rounded-2xl max-w-[280px] text-center transform transition-all duration-500 animate-[fadeIn_0.5s_ease-out] border border-slate-700">
                      <button
                        onClick={handleMicClick}
                        className="bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 p-3 rounded-full w-14 h-14 flex items-center justify-center mx-auto mb-3 hover:opacity-90 transition-opacity cursor-pointer group"
                      >
                        <span className="material-symbols-outlined text-3xl animate-[pulse_2s_infinite] group-hover:scale-110 transition-transform text-white">
                          mic
                        </span>
                      </button>
                      <h3 className="font-bold text-lg mb-1 tracking-tight">Let's Talk!</h3>
                      <p className="text-white/90 text-sm font-medium leading-relaxed">
                        Tap the microphone to speak
                        <br />
                        or type below to start.
                      </p>
                    </div>
                  </div>
                )}

                {messages.map((msg, index) => (
                  <div key={index} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[80%] p-3 rounded-2xl ${
                        msg.type === 'user'
                          ? 'bg-primary text-white rounded-br-none'
                          : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 shadow-sm rounded-bl-none border border-slate-100 dark:border-slate-700'
                      }`}
                    >
                      {msg.type === 'agent' ? (
                        !msg.hasTyped && index === messages.length - 1 ? (
                          <Typewriter text={msg.text} onUpdate={scrollToBottom} onComplete={() => markMessageAsTyped(index)} />
                        ) : (
                          <div
                            className="text-sm [&>ul]:list-disc [&>ul]:pl-4 [&>ol]:list-decimal [&>ol]:pl-4 [&>p]:mb-2 [&>p:last-child]:mb-0 [&>a]:text-blue-500 [&>a]:underline dark:[&>a]:text-blue-400"
                            dangerouslySetInnerHTML={{ __html: msg.text }}
                          />
                        )
                      ) : (
                        <p className="text-sm">{msg.text}</p>
                      )}
                    </div>
                  </div>
                ))}
                {isListening && currentTranscript && (
                  <div className="flex justify-end">
                    <div className="max-w-[80%] p-3 rounded-2xl bg-primary/70 text-white rounded-br-none backdrop-blur-sm animate-pulse">
                      <p className="text-sm italic">{currentTranscript}...</p>
                    </div>
                  </div>
                )}
                {isLoading && (
                  <div className="flex justify-start">
                    <div className="bg-white dark:bg-slate-800 p-3 rounded-2xl rounded-bl-none shadow-sm border border-slate-100 dark:border-slate-700">
                      <div className="flex gap-1">
                        <motion.div
                          animate={{ y: [0, -5, 0] }}
                          transition={{ duration: 0.6, repeat: Infinity, delay: 0 }}
                          className="w-2 h-2 bg-slate-400 rounded-full"
                        />
                        <motion.div
                          animate={{ y: [0, -5, 0] }}
                          transition={{ duration: 0.6, repeat: Infinity, delay: 0.2 }}
                          className="w-2 h-2 bg-slate-400 rounded-full"
                        />
                        <motion.div
                          animate={{ y: [0, -5, 0] }}
                          transition={{ duration: 0.6, repeat: Infinity, delay: 0.4 }}
                          className="w-2 h-2 bg-slate-400 rounded-full"
                        />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {showFTE && fteStep > 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="absolute top-0 left-0 right-0 bottom-16 bg-slate-900/80 backdrop-blur-sm z-10 pointer-events-none"
                />
              )}

              <form onSubmit={handleSendMessage} className="p-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 relative z-20">
                {showFTE && fteStep > 0 && (
                  <>
                    {fteStep === 1 && (
                      <motion.div
                        initial={{ y: 10, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.2 }}
                        className="absolute bottom-full left-0 mb-4 ml-1 pointer-events-auto flex flex-col items-start"
                      >
                        <div className="text-white text-left max-w-[200px] mb-2 px-2">
                          <h3 className="text-lg font-bold mb-1">{FTE_DATA.features.voice.title}</h3>
                          <p className="text-gray-200 text-xs">{FTE_DATA.features.voice.description}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex justify-center w-10 ml-1">
                            <span className="material-symbols-outlined text-4xl animate-bounce text-primary">
                              arrow_downward
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={handleNextStep}
                            className="bg-primary text-white text-xs font-bold px-3 py-1.5 rounded-full hover:bg-primary-dark border border-white/20 transition-all z-50 whitespace-nowrap"
                          >
                            Next
                          </button>
                        </div>
                      </motion.div>
                    )}

                    {fteStep === 2 && (
                      <motion.div
                        key="input-fte"
                        initial={{ y: 10, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.2 }}
                        className="absolute bottom-full left-1/2 -translate-x-1/2 mb-4 pointer-events-auto flex flex-col items-center"
                      >
                        <div className="text-white text-center max-w-[250px] mb-2">
                          <h3 className="text-lg font-bold mb-1">{FTE_DATA.features.input.title}</h3>
                          <p className="text-gray-200 text-xs">{FTE_DATA.features.input.description}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex justify-center w-full">
                            <span className="material-symbols-outlined text-4xl animate-bounce text-primary">
                              arrow_downward
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={dismissFTE}
                            className="bg-primary text-white text-xs font-bold px-3 py-1.5 rounded-full hover:bg-primary-dark border border-white/20 transition-all z-50 whitespace-nowrap"
                          >
                            Got it
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </>
                )}
                <div className="flex gap-2 relative">
                  <button
                    type="button"
                    onClick={handleMicClick}
                    className={`p-2 rounded-full flex items-center justify-center transition-all ${
                      isListening
                        ? 'bg-red-500 text-white animate-pulse'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                    title="Speak to type"
                  >
                    <span className="material-symbols-outlined">mic</span>
                  </button>

                  {isListening || isAudioPlaying ? (
                    <div className="flex-1 h-10 flex items-center justify-center overflow-hidden">
                      {isListening ? (
                        voiceAnalyserRef.current ? (
                          <Waveform analyser={voiceAnalyserRef.current} isActive={isListening} />
                        ) : (
                          <div className="w-full h-8 flex items-center justify-center">
                            <div className="flex gap-1 items-end h-6">
                              {[...Array(16)].map((_, i) => (
                                <div
                                  key={i}
                                  className="w-1 bg-gradient-to-t from-purple-400 to-indigo-400 rounded-full animate-pulse"
                                  style={{
                                    height: `${20 + Math.random() * 60}%`,
                                    animationDelay: `${i * 0.05}s`,
                                    animationDuration: '0.8s'
                                  }}
                                />
                              ))}
                            </div>
                          </div>
                        )
                      ) : (
                        <div className="w-full h-8 flex items-center justify-center">
                          <Lottie animationData={resolvedVoiceAnimation} loop={true} style={{ width: 90, height: 32 }} />
                        </div>
                      )}
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={inputValue}
                      onChange={(e) => {
                        setInputValue(e.target.value);
                      }}
                      placeholder="Ask me anything..."
                      className="flex-1 bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white rounded-full px-4 py-2 focus:outline-none focus:ring-2 focus:ring-primary text-base md:text-sm"
                    />
                  )}
                  <button
                    type="submit"
                    disabled={
                      isLoading ||
                      !inputValue.trim() ||
                      !isAgentReady ||
                      (!wsConnected && (!wsRef.current || wsRef.current.readyState !== WebSocket.CONNECTING))
                    }
                    title={!isAgentReady ? 'Connecting to agent...' : 'Send message'}
                    className="bg-primary hover:opacity-90 disabled:opacity-50 text-white p-2 rounded-full flex items-center justify-center transition-all"
                  >
                    <span className="material-symbols-outlined">send</span>
                  </button>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default ChatWidget;
