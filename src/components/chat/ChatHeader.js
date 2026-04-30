import React from 'react';

function ChatHeader({ onNewChat, onClearSessionMemory, isSending = false }) {
  return (
    <div className="chat-glassmorphism-header" id="chat-glassmorphism-header">
      <div className="chat-header-left">
        <div className="chat-brand-pill" onClick={onNewChat} style={{ cursor: 'pointer' }}>
          <div className="chat-brand-dot"></div>
          <span className="chat-brand-name">CGMSCL GPT</span>
          <span className="chat-brand-badge">AWS</span>
        </div>
      </div>
      <div className="chat-header-right">
        {onClearSessionMemory && (
          <button
            type="button"
            className="clear-session-memory-btn"
            onClick={onClearSessionMemory}
            disabled={isSending}
            title="Clear session memory"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            Clear memory
          </button>
        )}
        <button className="new-chat-btn" onClick={onNewChat} aria-label="New Chat" title="New Chat">
          <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
            <mask id="mask0_chat" maskUnits="userSpaceOnUse" x="0" y="0" width="20" height="20" style={{ maskType: 'alpha' }}>
              <path d="M19.7803 1.28033C20.0732 0.987435 20.0732 0.512561 19.7803 0.219669C19.4874 -0.0732238 19.0125 -0.0732228 18.7196 0.219671L8.71967 10.2197L8.25 11.75L9.78033 11.2803L19.7803 1.28033ZM4.25 1C2.45507 1 1 2.45508 1 4.25V15.75C1 17.5449 2.45507 19 4.25 19H15.75C17.5449 19 19 17.5449 19 15.75V7.75C19 7.33579 18.6642 7 18.25 7C17.8358 7 17.5 7.33579 17.5 7.75V15.75C17.5 16.7165 16.7165 17.5 15.75 17.5H4.25C3.2835 17.5 2.5 16.7165 2.5 15.75V4.25C2.5 3.2835 3.2835 2.5 4.25 2.5H12.25C12.6642 2.5 13 2.16421 13 1.75C13 1.33579 12.6642 1 12.25 1H4.25Z" fill="currentColor"/>
            </mask>
            <g mask="url(#mask0_chat)"><rect width="24" height="24" transform="translate(-2 -2)" fill="currentColor"/></g>
          </svg>
        </button>
      </div>
    </div>
  );
}

export default ChatHeader;
