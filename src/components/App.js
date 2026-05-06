import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import LoadingScreen from './common/LoadingScreen';
import Login from './auth/Login';
import WelcomeScreen from './welcome/WelcomeScreen';
import ChatArea from './chat/ChatArea';
import AnalysisPanel from './common/AnalysisPanel';
import SessionSidebar from './common/SessionSidebar';
import { extractData } from '../utils/responseNormalizer';
import { getAnalysisApiUrl, normalizeBackendResponse, sendChatQuery } from '../services/chatApi';
import { showNotification } from '../utils/notifications';

const CACHE_ONLY_RESPONSE_PATTERN = /mcp result cached for analysis|use cache_id with analysis api/i;
const ACTOR_STORAGE_KEY = 'cgmscl_actor_id';
const FOLLOW_UP_SUGGESTION_DELAY_SECONDS = 4;
const SESSION_MEMORY_MAX_ROUNDS = 6;
const MONGO_API_BASE = process.env.REACT_APP_MONGO_API_URL || '';


function createSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}`;
}

const DEFAULT_ACTOR_ID = (() => {
  const existing = localStorage.getItem(ACTOR_STORAGE_KEY);
  if (existing) return existing;
  const nextId = `user_${createSessionId()}`;
  localStorage.setItem(ACTOR_STORAGE_KEY, nextId);
  return nextId;
})();

function isCacheOnlyResponse(text) {
  return typeof text === 'string' && CACHE_ONLY_RESPONSE_PATTERN.test(text);
}

function getDisplayText(data) {
  if (!data || typeof data !== 'object') return '';
  if (typeof data.error_message === 'string' && data.error_message.trim()) return data.error_message.trim();
  if (typeof data.data?.detail?.message === 'string' && data.data.detail.message.trim()) return data.data.detail.message.trim();
  if (typeof data.analysis === 'string' && data.analysis.trim() && !isCacheOnlyResponse(data.analysis)) return data.analysis.trim();
  if (typeof data.response === 'string' && data.response.trim() && !isCacheOnlyResponse(data.response)) return data.response.trim();
  return '';
}

function buildSummaryHighlight(data) {
  if (!data || typeof data !== 'object') return null;

  const shortSummary =
    typeof data.short_summary === 'string' ? data.short_summary.trim() : '';
  if (shortSummary) return shortSummary;

  const responseText =
    typeof data.response === 'string' ? data.response.replace(/\*\*/g, '').trim() : '';
  if (!responseText) return null;

  const firstLine = responseText.split('\n').find((line) => line.trim()) || '';
  const compact = firstLine.trim();
  if (!compact) return null;
  if (compact.length <= 220) return compact;
  return `${compact.slice(0, 217).trim()}...`;
}

async function fetchAnalysisPreview(cacheId, selectedBackendType, sessionId) {
  if (!cacheId) return null;
  const analysisUrl = getAnalysisApiUrl(selectedBackendType);
  const response = await fetch(analysisUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cache_id: cacheId, mode: 'eco', actor_id: DEFAULT_ACTOR_ID, session_id: sessionId })
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Analysis API error ${response.status}${errorText ? `: ${errorText}` : ''}`);
  }
  const rawData = await response.json();
  return normalizeBackendResponse(rawData, selectedBackendType);
}

/**
 * Main App Content — requires AuthProvider above it
 */
function AppContent() {
  const { isAuthenticated, isLoading: authLoading, user, logout } = useAuth();

  const [isLoading, setIsLoading]           = useState(true);
  const [showWelcome, setShowWelcome]       = useState(true);
  const [showChat, setShowChat]             = useState(false);
  const [chatHistory, setChatHistory]       = useState([]);
  const [sessions, setSessions]             = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(createSessionId());
  const [isSending, setIsSending]           = useState(false);
  const [backendType, setBackendType]       = useState('AWS');
  const [sessionId, setSessionId]           = useState(() => createSessionId());

  const closeBackendSession = async (sessionIdToClose, backendForSession = backendType) => {
    if (!sessionIdToClose) return;
    try {
      await sendChatQuery({ backendType: backendForSession, actorId: DEFAULT_ACTOR_ID, sessionId: sessionIdToClose, endSession: true });
    } catch (error) {
      console.warn('Failed to close backend session gracefully:', error);
    }
  };

  const handleClearSessionMemory = async () => {
    try {
      const data = await sendChatQuery({ backendType, actorId: DEFAULT_ACTOR_ID, sessionId, endSession: true });
      const serverLine = typeof data?.message === 'string' && data.message.trim() ? data.message.trim() : 'Session memory cleared.';
      const note = {
        role: 'assistant',
        text: `**${serverLine}** Follow-up answers will not use earlier turns on the server until you exchange new messages.`,
        sql_query: null, suggestions: null,
        timestamp: new Date().toISOString(),
        actor_id: DEFAULT_ACTOR_ID, session_id: sessionId,
        response_type: 'session_cleared'
      };
      setChatHistory((prev) => { const updated = [...prev, note]; updateActiveSession(updated, backendType); return updated; });
    } catch (error) {
      console.warn('Failed to clear session memory:', error);
      showNotification('Could not clear session memory. Try again.', 'error');
    }
  };

  const saveSessionToMongo = async (sessionPayload) => {
    if (!MONGO_API_BASE) return;
    try {
      await fetch(`${MONGO_API_BASE}/api/sessions/upsert`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actor_id: DEFAULT_ACTOR_ID, ...sessionPayload })
      });
    } catch (e) { console.warn('Mongo sync failed:', e); }
  };

  const persistSessions = (updatedSessions) => setSessions(updatedSessions);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const updateActiveSession = (messages, nextBackendType = backendType) => {
    const sid = activeSessionId;
    const titleSource = messages.find(m => m.role === 'user')?.text || 'New Chat';
    const title = titleSource.length > 60 ? `${titleSource.slice(0, 57)}...` : titleSource;
    const sessionRecord = { session_id: sid, title, backendType: nextBackendType, updated_at: new Date().toISOString(), messages };
    persistSessions((() => {
      const existing = sessions.filter(s => s.session_id !== sid);
      return [sessionRecord, ...existing];
    })());
    saveSessionToMongo(sessionRecord);
  };

  useEffect(() => {
    if (!MONGO_API_BASE) {
      const newSessionId = createSessionId();
      setActiveSessionId(newSessionId);
      setSessionId(newSessionId);
      return;
    }
    const loadSessionsFromMongo = async () => {
      try {
        const response = await fetch(`${MONGO_API_BASE}/api/sessions?actor_id=${encodeURIComponent(DEFAULT_ACTOR_ID)}`);
        if (!response.ok) throw new Error(`Failed loading sessions: ${response.status}`);
        const payload = await response.json();
        const mongoSessions = Array.isArray(payload.sessions) ? payload.sessions : [];
        if (mongoSessions.length > 0) {
          setSessions(mongoSessions);
          const firstSession = mongoSessions[0];
          setActiveSessionId(firstSession.session_id);
          setSessionId(firstSession.session_id);
          setChatHistory(firstSession.messages || []);
          setBackendType(firstSession.backendType || 'AWS');
          setShowWelcome(false); setShowChat(true);
          return;
        }
      } catch (error) { console.warn('Mongo session load failed:', error); }
      const newSessionId = createSessionId();
      setActiveSessionId(newSessionId);
      setSessionId(newSessionId);
    };
    loadSessionsFromMongo();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 500);
    return () => clearTimeout(timer);
  }, []);

  const handleNewChat = () => {
    closeBackendSession(activeSessionId, backendType);
    const nextSessionId = createSessionId();
    setShowWelcome(true); setShowChat(false);
    setChatHistory([]);
    setActiveSessionId(nextSessionId); setSessionId(nextSessionId);
    const newSession = { session_id: nextSessionId, title: 'New Chat', backendType, updated_at: new Date().toISOString(), messages: [] };
    persistSessions([newSession, ...sessions]);
    saveSessionToMongo(newSession);
  };

  const handleSelectSession = (sid) => {
    const selected = sessions.find(s => s.session_id === sid);
    if (!selected) return;
    setActiveSessionId(sid); setSessionId(sid);
    setChatHistory(selected.messages || []);
    setBackendType(selected.backendType || 'AWS');
    setShowWelcome(false); setShowChat(true);
  };

  const handleDeleteSession = async (sid) => {
    const selectedSession = sessions.find(s => s.session_id === sid);
    closeBackendSession(sid, selectedSession?.backendType || backendType);
    const remaining = sessions.filter(s => s.session_id !== sid);
    persistSessions(remaining);
    if (MONGO_API_BASE) {
      try {
        await fetch(`${MONGO_API_BASE}/api/sessions/delete`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actor_id: DEFAULT_ACTOR_ID, session_id: sid })
        });
      } catch (e) { console.warn('Failed to delete session in Mongo:', e); }
    }
    if (activeSessionId === sid) {
      if (remaining.length > 0) {
        handleSelectSession(remaining[0].session_id);
      } else {
        const freshSession = createSessionId();
        setActiveSessionId(freshSession); setSessionId(freshSession);
        setChatHistory([]); setShowWelcome(true); setShowChat(false);
      }
    }
  };

  const handleSendMessage = async (message) => {
    if (!message || !message.trim()) return;
    setShowWelcome(false); setShowChat(true); setIsSending(true);
    const trimmed = message.trim();

    const userMessage = {
      role: 'user', text: trimmed,
      timestamp: new Date().toISOString(),
      actor_id: DEFAULT_ACTOR_ID, session_id: sessionId
    };
    setChatHistory(prev => { const updated = [...prev, userMessage]; updateActiveSession(updated, backendType); return updated; });

    try {
      const requestStartedAt = Date.now();
      let data = await sendChatQuery({ backendType, query: trimmed, actorId: DEFAULT_ACTOR_ID, sessionId });

      if (data?.type === 'memory_wait') {
        const hint = getDisplayText(data) || 'Please wait before sending the next message.';
        setChatHistory(prev => {
          const updated = [...prev, { role: 'assistant', text: hint, sql_query: null, suggestions: null, timestamp: new Date().toISOString(), actor_id: DEFAULT_ACTOR_ID, session_id: sessionId, response_type: 'memory_wait' }];
          updateActiveSession(updated, backendType);
          return updated;
        });
        return;
      }

      if (data.cache_id && isCacheOnlyResponse(data.response) && !getDisplayText(data)) {
        try {
          const analysisPreview = await fetchAnalysisPreview(data.cache_id, backendType, sessionId);
          if (analysisPreview) {
            data = { ...data, analysis: getDisplayText(analysisPreview) || data.analysis, response: getDisplayText(analysisPreview) || data.response, visualization: analysisPreview.visualization || data.visualization, summary_mode: 'eco' };
          }
        } catch (analysisError) { console.warn('Initial analysis preview fetch failed:', analysisError); }
      }

      let { rows: possibleRows, columns: possibleColumns } = extractData(data);
      if ((!possibleRows || possibleRows.length === 0) && data.data?.result) {
        if (Array.isArray(data.data.result.rows) && data.data.result.rows.length > 0) possibleRows = data.data.result.rows;
        if (Array.isArray(data.data.result.columns) && data.data.result.columns.length > 0) possibleColumns = data.data.result.columns;
      }

      let visualizationDataRows = null, visualizationDataColumns = null;
      if (data.visualization?.data) {
        if (Array.isArray(data.visualization.data)) visualizationDataRows = data.visualization.data;
        else if (data.visualization.data.rows) { visualizationDataRows = data.visualization.data.rows; visualizationDataColumns = data.visualization.data.columns; }
      }

      const finalDataRows = possibleRows || visualizationDataRows || null;
      const finalDataColumns = possibleColumns || visualizationDataColumns || null;
      const hasTabularData = finalDataRows && Array.isArray(finalDataRows) && finalDataRows.length > 0 && finalDataColumns && Array.isArray(finalDataColumns) && finalDataColumns.length > 0;
      const displayText = getDisplayText(data);

      const assistantMessage = {
        role: 'assistant',
        text: displayText || (hasTabularData ? '' : 'No response received.'),
        summary_highlight: buildSummaryHighlight(data),
        sql_query: data.sql_query || data.sql || null,
        cache_id: data.cache_id || null,
        backendType,
        suggestions: finalDataRows || null,
        dataRows: finalDataRows,
        dataColumns: finalDataColumns,
        excel_download: !!(finalDataRows && Array.isArray(finalDataRows) && finalDataRows.length > 0),
        visualization: data.visualization || null,
        timestamp: new Date().toISOString(),
        response_time_sec: Number(((Date.now() - requestStartedAt) / 1000).toFixed(1)),
        response_type: data.type || null,
        follow_up_questions: Array.isArray(data.follow_up_questions) ? data.follow_up_questions : [],
        feedback_rule_applied: Boolean(data.feedback_rule_applied),
        actor_id: DEFAULT_ACTOR_ID,
        session_id: sessionId
      };

      setChatHistory(prev => { const updated = [...prev, assistantMessage]; updateActiveSession(updated, backendType); return updated; });
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage = {
        role: 'assistant', text: 'Sorry, I encountered an error. Please try again.',
        sql_query: null, suggestions: null, timestamp: new Date().toISOString(),
        actor_id: DEFAULT_ACTOR_ID, session_id: sessionId
      };
      setChatHistory(prev => { const updated = [...prev, errorMessage]; updateActiveSession(updated, backendType); return updated; });
    } finally {
      setIsSending(false);
    }
  };

  const handleReceiveResponse = (response, sqlQuery = null, suggestions = null) => {
    const assistantMessage = {
      role: 'assistant', text: response,
      sql_query: sqlQuery, suggestions,
      timestamp: new Date().toISOString(),
      actor_id: DEFAULT_ACTOR_ID, session_id: sessionId
    };
    setChatHistory(prev => [...prev, assistantMessage]);
    return assistantMessage;
  };

  // Auth loading state
  if (authLoading) return <LoadingScreen />;

  // Not authenticated → show Login
  if (!isAuthenticated) return <Login />;

  return (
    <div className="copilot-layout" id="chatContainer">
      {isLoading && <LoadingScreen />}
      <SessionSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        onDeleteSession={handleDeleteSession}
        user={user}
        onLogout={logout}
      />
      <div className="main-content" id="main-content">
        <AnalysisPanel />
        {showWelcome && (
          <WelcomeScreen
            onSendMessage={handleSendMessage}
            onNewChat={handleNewChat}
            backendType={backendType}
            setBackendType={setBackendType}
          />
        )}
        {showChat && (
          <ChatArea
            chatHistory={chatHistory}
            onSendMessage={handleSendMessage}
            onReceiveResponse={handleReceiveResponse}
            onNewChat={handleNewChat}
            onClearSessionMemory={handleClearSessionMemory}
            isSending={isSending}
            backendType={backendType}
            setBackendType={setBackendType}
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelectSession={handleSelectSession}
            followUpDelaySeconds={FOLLOW_UP_SUGGESTION_DELAY_SECONDS}
            sessionMemoryMaxRounds={SESSION_MEMORY_MAX_ROUNDS}
          />
        )}
      </div>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
