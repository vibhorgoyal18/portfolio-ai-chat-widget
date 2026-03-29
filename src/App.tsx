import React, { useEffect } from 'react';
import { ChatWidget } from './index';

const backendUrl = import.meta.env.VITE_BACKEND_URL || 'https://api.aivedalabs.com';
const wsUrl = `${backendUrl}/agent/ws`;

const App: React.FC = () => {
  const userEmail = import.meta.env.VITE_AGENT_EMAIL || '';
  
  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('open-chat-voice'));
    }, 300);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="demo-root min-h-screen bg-background-light dark:bg-background-dark text-slate-900 dark:text-white font-display">
      <ChatWidget
        websocketUrl={wsUrl}
        email={userEmail}
      />
    </div>
  );
};

export default App;
