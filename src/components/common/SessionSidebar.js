import React, { useState } from 'react';

function SessionSidebar({
  sessions = [],
  activeSessionId,
  onSelectSession,
  onNewChat,
  onDeleteSession,
  user,
  onLogout,
  isOpen = true,
  onClose,
}) {
  const [confirmLogout, setConfirmLogout] = useState(false);

  const handleLogout = () => {
    if (confirmLogout) {
      onLogout && onLogout();
    } else {
      setConfirmLogout(true);
      setTimeout(() => setConfirmLogout(false), 3000);
    }
  };

  const getUserInitials = () => {
    if (!user) return '?';
    const name = user.name || user.username || '';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase() || '?';
  };

  const getDisplayName = () => {
    if (!user) return 'User';
    return user.name || user.username || 'User';
  };

  const getDisplayRole = () => {
    if (!user) return '';
    return user.role || user.designation || '';
  };

  return (
    <aside className={`session-sidebar${isOpen ? '' : ' collapsed'}`} aria-label="Chat sessions">
      {/* Sidebar Header: New Chat + Close */}
      <div className="session-sidebar-header">
        <button className="session-new-btn" onClick={onNewChat}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          New Chat
        </button>
        <button
          className="sidebar-close-btn"
          onClick={onClose}
          title="Close sidebar"
          aria-label="Close sidebar"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/>
          </svg>
        </button>
      </div>

      {/* Sessions */}
      <div className="session-sidebar-title">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        Recent Chats
      </div>

      <div className="session-list">
        {sessions.length === 0 && (
          <div className="session-empty">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <span>No conversations yet</span>
          </div>
        )}

        {sessions.map((session) => (
          <div
            key={session.session_id}
            className={`session-item${session.session_id === activeSessionId ? ' active' : ''}`}
          >
            <button
              className="session-item-main"
              onClick={() => onSelectSession && onSelectSession(session.session_id)}
              title={session.title || 'Untitled Session'}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.5 }}>
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              <span className="session-item-title">{session.title || 'Untitled Session'}</span>
            </button>
            <button
              className="session-item-delete"
              onClick={(e) => { e.stopPropagation(); onDeleteSession && onDeleteSession(session.session_id); }}
              aria-label="Delete conversation"
              title="Delete conversation"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* User Profile + Logout */}
      {user && (
        <div className="session-user-section">
          <div className="session-user-card">
            <div className="session-user-avatar">{getUserInitials()}</div>
            <div className="session-user-info">
              <div className="session-user-name" title={getDisplayName()}>{getDisplayName()}</div>
              {getDisplayRole() && <div className="session-user-role">{getDisplayRole()}</div>}
            </div>
          </div>
          <button
            className={`session-logout-btn${confirmLogout ? ' session-logout-btn--confirm' : ''}`}
            onClick={handleLogout}
            title={confirmLogout ? 'Click again to confirm logout' : 'Sign out'}
          >
            {confirmLogout ? (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                Confirm Sign Out
              </>
            ) : (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
                Sign Out
              </>
            )}
          </button>
        </div>
      )}
    </aside>
  );
}

export default SessionSidebar;
