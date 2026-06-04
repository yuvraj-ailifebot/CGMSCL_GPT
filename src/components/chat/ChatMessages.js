import React, { useRef } from 'react';
import MessageBubble from './MessageBubble';
import { useChartRenderer } from '../../hooks/useChartRenderer';
import { useMarkdownRenderer } from '../../hooks/useMarkdownRenderer';
import { useMathJaxRenderer } from '../../hooks/useMathJaxRenderer';
import { useSequentialLoading } from '../../hooks/useSequentialLoading';

/**
 * Chat Messages Component
 * Displays all chat messages
 */
function ChatMessages({ messages, isSending = false }) {
  const containerRef = useRef(null);
  const loadingMessage = useSequentialLoading(isSending);

  // Render charts in messages
  useChartRenderer(containerRef, messages);
  
  // Render markdown in messages
  useMarkdownRenderer(containerRef, messages);
  
  // Render MathJax in messages
  useMathJaxRenderer(containerRef, messages);

  return (
    <div ref={containerRef}>
      {messages.map((message, index) => (
        <MessageBubble key={index} message={message} index={index} messages={messages} />
      ))}
      
      {isSending && loadingMessage && (function() {
        const phases = [
          'Understanding your query...',
          'Retrieving data...',
          'Analyzing data...',
          'Generating response...',
        ];
        const activeIdx = phases.indexOf(loadingMessage);
        return (
          <div className="message bot-message" aria-live="polite">
            <div className="message-bubble thinking-bubble">
              <div className="thinking-header">
                <span className="thinking-brand">CGMSCL GPT</span>
                <span className="thinking-live-badge">thinking</span>
              </div>
              <div className="thinking-body">
                <div className="thinking-dots">
                  <span className="thinking-dot" />
                  <span className="thinking-dot" />
                  <span className="thinking-dot" />
                </div>
                <span key={loadingMessage} className="thinking-phase">{loadingMessage}</span>
              </div>
              <div className="thinking-steps">
                {phases.map(function(phase, i) {
                  const cls = 'thinking-step' +
                    (i === activeIdx ? ' thinking-step--active' : '') +
                    (i < activeIdx ? ' thinking-step--done' : '');
                  return <span key={i} className={cls} title={phase.replace('...', '')} />;
                })}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export default ChatMessages;

