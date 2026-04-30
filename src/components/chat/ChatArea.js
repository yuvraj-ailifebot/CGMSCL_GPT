import React, { useState, useEffect, useRef } from 'react';
import ChatHeader from './ChatHeader';
import ChatMessages from './ChatMessages';
import ChatInput from './ChatInput';
import ChatSuggestions from './ChatSuggestions';
import PromptGalleryModal from '../modals/PromptGalleryModal';

/**
 * Chat Area Component
 * Main chat interface for conversations
 */
function ChatArea({
  chatHistory,
  onSendMessage,
  onReceiveResponse,
  onNewChat,
  onClearSessionMemory,
  isSending,
  backendType,
  setBackendType,
  sessions,
  activeSessionId,
  onSelectSession,
  followUpDelaySeconds = 4,
  sessionMemoryMaxRounds = 6
}) {
  const [messages, setMessages] = useState(chatHistory);
  const [showPromptGallery, setShowPromptGallery] = useState(false);
  const [showFollowUpChips, setShowFollowUpChips] = useState(false);
  const [followUpCountdown, setFollowUpCountdown] = useState(0);
  const messagesEndRef = useRef(null);
  const chatInputRef = useRef(null);
  const previousAssistantCountRef = useRef(0);
  const followUpTimeoutRef = useRef(null);
  const followUpIntervalRef = useRef(null);

  const clearFollowUpTimers = () => {
    if (followUpTimeoutRef.current) {
      clearTimeout(followUpTimeoutRef.current);
      followUpTimeoutRef.current = null;
    }
    if (followUpIntervalRef.current) {
      clearInterval(followUpIntervalRef.current);
      followUpIntervalRef.current = null;
    }
  };

  useEffect(() => {
    setMessages(chatHistory);
  }, [chatHistory]);

  useEffect(() => {
    // Scroll to bottom when messages change
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const assistantCount = messages.filter((msg) => msg.role === 'assistant').length;
    if (assistantCount > previousAssistantCountRef.current) {
      clearFollowUpTimers();
      setShowFollowUpChips(false);

      if (followUpDelaySeconds > 0) {
        setFollowUpCountdown(followUpDelaySeconds);
        followUpIntervalRef.current = setInterval(() => {
          setFollowUpCountdown((previousSeconds) => Math.max(previousSeconds - 1, 0));
        }, 1000);
        followUpTimeoutRef.current = setTimeout(() => {
          setShowFollowUpChips(true);
          setFollowUpCountdown(0);
          clearFollowUpTimers();
        }, followUpDelaySeconds * 1000);
      } else {
        setFollowUpCountdown(0);
        setShowFollowUpChips(true);
      }
    }
    previousAssistantCountRef.current = assistantCount;
  }, [messages, followUpDelaySeconds, isSending]);

  useEffect(() => {
    return () => {
      clearFollowUpTimers();
    };
  }, []);

  const handleSend = async (message) => {
    // Delegate sending to parent (App) so both WelcomeScreen and ChatInput share the same flow
    await onSendMessage(message);
  };     

  const handlePromptSelect = (prompt) => {
    chatInputRef.current?.setValue(prompt);
    setShowPromptGallery(false);
  };

  // Show floating gallery button only after at least one assistant response exists,
  // and hide it while generating a response (isSending).
  // The button appears under the response, matching the behavior in igl.html.
  const hasAssistantResponse = messages.some((msg) => msg.role === 'assistant');
  const shouldShowGalleryButton = hasAssistantResponse && !isSending;

  const getFollowUpSuggestions = () => {
    const latestBackendFollowUps = [...messages]
      .reverse()
      .find(
        (msg) =>
          msg.role === 'assistant' &&
          Array.isArray(msg.follow_up_questions) &&
          msg.follow_up_questions.length > 0
      );
    if (latestBackendFollowUps) {
      return latestBackendFollowUps.follow_up_questions
        .filter((item) => typeof item === 'string' && item.trim())
        .map((item) => item.trim())
        .slice(0, 5);
    }

    const lastUserMessage = [...messages].reverse().find((msg) => msg.role === 'user');
    const query = (lastUserMessage?.text || '').toLowerCase();

    if (/(supplier|vendor|po|purchase)/i.test(query)) {
      return ['Filter by region', 'Show delivery performance', 'Compare last quarter'];
    }
    if (/(payment|pending|overdue|bill)/i.test(query)) {
      return ['Show overdue only', 'Group by supplier', 'Export report'];
    }
    if (/(stock|expiry|inventory|batch)/i.test(query)) {
      return ['Show near-expiry only', 'Filter by warehouse', 'Below reorder level'];
    }
    if (/(tender|rc|rate contract)/i.test(query)) {
      return ['Show expired RCs', 'Participation rate by supplier', 'Upcoming RC renewals'];
    }
    return ['Top suppliers by PO value', 'Pending payments', 'Near-expiry stock'];
  };

  const followUpSuggestions = hasAssistantResponse && showFollowUpChips ? getFollowUpSuggestions() : [];

  return (
    <div className="chat-area has-header" id="chat-area">
      <ChatHeader
        onNewChat={onNewChat}
        onClearSessionMemory={onClearSessionMemory}
        isSending={isSending}
      />


      <div className="chat-messages chat-container" id="chat-container">
        <ChatMessages messages={messages} isSending={isSending} />

        {followUpSuggestions.length > 0 && (
          <div className="follow-up-suggestions-container">
            {followUpSuggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => chatInputRef.current?.setValue(suggestion)}
                className="follow-up-suggestion-btn"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        {!showFollowUpChips && followUpCountdown > 0 && (
          <div className="follow-up-timer">
            Follow-up suggestions in {followUpCountdown}s
          </div>
        )}

        {shouldShowGalleryButton && (
          <div className="floating-suggestions-container inline-floating" data-floating="gallery-btn">
            <div className="floating-suggestions-wrapper">
              <ChatSuggestions
                onOpenPromptGallery={() => setShowPromptGallery(true)}
              /> 
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-wrapper">
        <ChatInput 
          ref={chatInputRef} 
          onSend={handleSend} 
          isSending={isSending} 
          backendType={backendType}
          setBackendType={setBackendType}
          onManualInputChange={() => {
            clearFollowUpTimers();
            setFollowUpCountdown(0);
            setShowFollowUpChips(false);
          }}
        />
      </div>

      {showPromptGallery && (
        <PromptGalleryModal
          onClose={() => setShowPromptGallery(false)}
          onPromptSelect={handlePromptSelect}
        />
      )}
    </div>
  );
}

export default ChatArea;

