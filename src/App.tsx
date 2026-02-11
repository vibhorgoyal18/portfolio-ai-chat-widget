import React, { useEffect } from 'react';
import { ChatWidget } from './index';

const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:5001/ws';

const initData = {
  profile: {
    name: 'Demo User'
  }
};

const App: React.FC = () => {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('open-chat-voice'));
    }, 300);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="demo-root min-h-screen bg-background-light dark:bg-background-dark text-slate-900 dark:text-white font-display">
      <ChatWidget websocketUrl={wsUrl} initData={initData} />
    </div>
  );
};

export default App;
