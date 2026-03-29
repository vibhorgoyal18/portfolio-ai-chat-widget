# Migration Plan: portfolio-ai-chat-widget → aivedalabs-backend

## Goal

Migrate the widget from talking to the standalone `vibhor-goyal-portfolio-agent` (port 5001) to
talking to `aivedalabs-backend` (`api.aivedalabs.com/agent/ws`).

---

## 1. What Changes in the Backend Contract

| Concern | Old (standalone agent) | New (aivedalabs-backend) |
|---|---|---|
| WS URL | `ws://localhost:5001/ws` | `wss://api.aivedalabs.com/agent/ws` |
| `init_data` payload | `{ type, content }` | `{ type, email, content }` |
| WS query params | `session_id`, `elevenlabs_voice_id`, `openai_voice_id` | `session_id` only — voice is configured on the backend |
| Audio (OpenAI path) | JSON: `{ type: "audio_chunk", chunk: "<base64 mp3>" }` | Same — unchanged |
| Audio (Gemini path) | N/A | **Binary WS frames** (raw 16-bit PCM @ 24 kHz) |
| Agent ready signal | `init_success` | `init_success` (OpenAI) OR `session_ready` (Gemini) |
| User transcript | N/A | `{ type: "transcription", text }` (Gemini) |
| Credits | N/A | `{ type: "credits_update", credits_remaining }` |
| Credits exhausted | N/A | `{ type: "credits_exhausted", credits_remaining: 0 }` |
| Error codes | generic `error` | `error` + typed `code`: `invalid_api_key`, `billing_expired`, `gemini_service_error`, `user_not_found`, `email_required`, `credits_exhausted` |
| Close codes | 1008, 1003 | 4003 (credits), 4005 (bad key), 4006 (billing), 1011 (server error) |

The `email` field in `init_data` is the portfolio owner's aivedalabs account email. It's a fixed
value (not the visitor's email) that the backend uses to look up the user's plan and API key.

---

## 2. Changes to `portfolio-ai-chat-widget`

### Step 1 — `src/types.ts`: Update `ChatWidgetProps`

```diff
 export interface ChatWidgetProps {
   websocketUrl?: string;
   initData: Record<string, unknown> | string;
-  elevenlabsVoiceId?: string;
-  openaiVoiceId?: string;
+  email: string;          // aivedalabs account email (portfolio owner)
   sessionId?: string;
   voiceAnimationData?: unknown;
   className?: string;
   style?: CSSProperties;
 }
```

> `voiceId` is **not** a widget prop — voice is fixed in the backend config (`PLATFORM_PROVIDER`, user plan, etc.).

---

### Step 2 — `src/components/ChatWidget.tsx`: Four focused changes

#### 2a — Update `buildWebSocketUrl()`

Remove `elevenlabs_voice_id` and `openai_voice_id` params entirely. Voice is configured on the backend — the widget only sends `session_id`:

```diff
- if (elevenlabsVoiceId) url.searchParams.set('elevenlabs_voice_id', elevenlabsVoiceId);
- if (openaiVoiceId) url.searchParams.set('openai_voice_id', openaiVoiceId);
  // no voice param — backend controls voice
```

#### 2b — Update `init_data` message (inside `ws.onopen`)

Add `email` to the payload:

```diff
 ws.send(JSON.stringify({
   type: 'init_data',
+  email: email,
   content: initDataString
 }));
```

#### 2c — Handle binary WS frames (Gemini PCM audio)

The backend sends raw 16-bit signed PCM at 24 kHz as binary WebSocket frames for the Gemini path.
The widget must detect binary messages and play them via the Web Audio API instead of trying to
JSON-parse them.

Add to `ws.onmessage` **before** the JSON parse:

```typescript
ws.onmessage = (event) => {
  // Binary frame = Gemini PCM audio chunk
  if (event.data instanceof Blob || event.data instanceof ArrayBuffer) {
    handleBinaryPCMAudio(event.data);
    return;
  }
  // ... existing JSON handling
};
```

Add `handleBinaryPCMAudio(data: Blob | ArrayBuffer)`:
- Convert to `ArrayBuffer` if Blob
- Interpret as `Int16Array` (16-bit signed PCM)
- Convert to `Float32Array` (divide by 32768)
- Create `AudioBuffer` via `AudioContext` (sampleRate: 24000, 1 channel)
- Copy float data into buffer, create `AudioBufferSourceNode`, connect to destination, play
- Chain buffers sequentially using a `nextPlayTime` ref to avoid gaps

This replaces the existing base64 MP3 pipeline for the Gemini path. The OpenAI path still uses
the existing `audio_chunk` JSON + base64 MP3 pipeline unchanged.

#### 2d — Handle new server message types

Extend `handleServerMessage()`:

```typescript
// Gemini: agent ready (open mic)
if (payload.type === 'session_ready') {
  setIsAgentReady(true);
  return;
}

// Gemini: user speech transcript (show in chat)
if (payload.type === 'transcription') {
  setMessages((prev) => [...prev, { type: 'user', text: payload.text, hasTyped: true }]);
  return;
}

// Credits update (show remaining balance, optional)
if (payload.type === 'credits_update') {
  // optional: setCreditBalance(payload.credits_remaining);
  return;
}

// Credits exhausted
if (payload.type === 'credits_exhausted') {
  setMessages((prev) => [...prev, {
    type: 'agent',
    text: 'You have run out of credits. Please top up to continue.',
    hasTyped: false,
  }]);
  setIsAgentReady(false);
  setIsLoading(false);
  return;
}

// Typed error codes
if (payload.type === 'error') {
  const errorMessages: Record<string, string> = {
    email_required:       'Configuration error: email is required.',
    user_not_found:       'Account not found. Please check your configuration.',
    invalid_api_key:      'Your API key is invalid. Please check your settings.',
    billing_expired:      'Your API quota is exhausted. Please check your billing.',
    gemini_service_error: 'The AI service encountered a temporary error. Please try again.',
  };
  const msg = (payload.code && errorMessages[payload.code]) || payload.message || 'An error occurred.';
  setMessages((prev) => [...prev, { type: 'agent', text: msg, hasTyped: false }]);
  setIsLoading(false);
  return;
}
```

Extend `ws.onclose` to handle new close codes:

```typescript
// Extend existing close code check
if (event.code === 1008 || event.code === 1003 ||
    event.code === 4003 || event.code === 4005 || event.code === 4006) {
  // Do not reconnect — these are terminal errors
  if (reconnectRef.current) {
    clearTimeout(reconnectRef.current);
    reconnectRef.current = null;
  }
  return;
}
```

---

### Step 3 — Version bump + publish

Since `email` is a new **required** prop, this is a **breaking change** → bump to `0.3.0`.

```bash
npm version minor   # 0.2.4 → 0.3.0
npm publish --access public
git push --follow-tags
```

---

## 3. Changes to `vibhor-goyal-portfolio`

### Step 4 — `src/App.jsx`: Update `ChatWidget` usage

```diff
- const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:5001/ws';
- const { elevenlabsVoiceId, openaiVoiceId } = data.chatConfig || {};
+ const wsUrl = import.meta.env.VITE_WS_URL || 'wss://api.aivedalabs.com/agent/ws';
+ const userEmail = import.meta.env.VITE_AGENT_EMAIL || data.chatConfig?.email || '';

  <ChatWidget
    websocketUrl={wsUrl}
    initData={data}
+   email={userEmail}
-   elevenlabsVoiceId={elevenlabsVoiceId}
-   openaiVoiceId={openaiVoiceId}
  />
```

### Step 5 — `src/data.json`: Update `chatConfig`

```diff
  "chatConfig": {
-   "elevenlabsVoiceId": "k9gnUwI5v1CTZB4E2JoK",
-   "openaiVoiceId": "echo",
+   "email": ""           // or leave blank and use VITE_AGENT_EMAIL env var
  }
```

> Voice is no longer configured here — it is set on the backend via `PLATFORM_PROVIDER` and user plan.

### Step 6 — `.env.example`: Update URLs and add email

```diff
- VITE_WS_URL=ws://localhost:5001/ws
+ VITE_WS_URL=wss://api.aivedalabs.com/agent/ws
+ VITE_AGENT_EMAIL=your-aivedalabs-account-email@example.com
```

### Step 7 — `package.json`: Bump widget version

```bash
npm install @vibhorgoyal/portfolio-ai-chat-widget@0.3.0
```

---

## 4. What Does NOT Change

| Area | Reason |
|---|---|
| All text chat message handling | Protocol identical |
| `audio_chunk` / `audio_end` JSON path | OpenAI TTS path unchanged |
| `interrupt` message | Unchanged |
| `audio_stream_start` / `audio_chunk` / `audio_stream_end` | iOS STT recording unchanged |
| `init_success` handling | Still present (OpenAI path) |
| `done` / `cancelled` / `interrupted` messages | Unchanged |
| Reconnect logic | Unchanged (new close codes 4003/4005/4006 are non-retriable) |
| UI/UX | No visual changes |

---

## 5. Implementation Order

1. **`portfolio-ai-chat-widget`** (package):
   1. `src/types.ts` — update props (remove voice params, add `email`)
   2. `src/components/ChatWidget.tsx` — 4 changes (remove voice URL params, add email to init_data, binary PCM, new message types)
   3. Bump version to `0.3.0`, publish to npm

2. **`vibhor-goyal-portfolio`** (consumer):
   1. `src/App.jsx` — update props
   2. `src/data.json` — update chatConfig
   3. `.env.example` — update env vars
   4. `.env` (local) — set `VITE_AGENT_EMAIL`
   5. `npm install @vibhorgoyal/portfolio-ai-chat-widget@0.3.0`

---

## 6. Testing Checklist

- [ ] OpenAI path: text message → display response → TTS audio plays (MP3 chunks)
- [ ] OpenAI path: iOS microphone → STT → display + TTS
- [ ] Gemini path: real-time voice → PCM audio plays smoothly
- [ ] Gemini path: user transcript appears in chat
- [ ] `credits_update` logged (no crash)
- [ ] `credits_exhausted` shows message, does not reconnect
- [ ] `invalid_api_key` shows friendly error, does not reconnect
- [ ] Email missing → `email_required` error handled gracefully
- [ ] WS close code 4003/4005/4006 → no reconnect loop
