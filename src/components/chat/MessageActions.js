import React, { useEffect, useRef, useState } from 'react';
import { showNotification } from '../../utils/notifications';
import { generateExcelFromData, generateExcelFromResponse } from '../../utils/excelGenerator';
import { sendChatQuery } from '../../services/chatApi';
// import { trackDownload } from '../../utils/feedbackService';
// import FeedbackModal from '../modals/FeedbackModal';
import excelIcon from '../../assets/images/excel.png';

const MONGO_API_BASE = process.env.REACT_APP_MONGO_API_URL || '';

/**
 * Message Actions Component
 * Actions for each message (copy, excel, feedback, etc.)
 */
function MessageActions({ message, index, messages = [] }) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [feedbackType, setFeedbackType] = useState(null); // 'dislike' | 'suggest' | null
  const [selectedFeedback, setSelectedFeedback] = useState(null); // 'like' | 'dislike' | null
  const [dislikeReasons, setDislikeReasons] = useState([]);
  const [dislikeComment, setDislikeComment] = useState('');
  const [suggestionComment, setSuggestionComment] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const dislikePopoverRef = useRef(null);
  const suggestPopoverRef = useRef(null);
  const actorId = message.actor_id || 'user_001';
  const messageSessionId = message.session_id || messages.find((msg) => msg?.session_id)?.session_id || null;
  const messageBackendType = message.backendType || 'AWS';

  const submitFeedback = async ({ type, reasons = [], comment = '' }) => {
    if (!messageSessionId) {
      showNotification('Session id missing. Feedback not saved.', 'error');
      return false;
    }

    try {
      const feedbackCommentParts = [];
      if (Array.isArray(reasons) && reasons.length > 0) {
        feedbackCommentParts.push(`Reasons: ${reasons.join(', ')}`);
      }
      if (typeof comment === 'string' && comment.trim()) {
        feedbackCommentParts.push(comment.trim());
      }
      const feedbackPayload = {
        reaction: type === 'like' ? 'like' : 'dislike',
        comment: feedbackCommentParts.join(' | ')
      };

      await sendChatQuery({
        backendType: messageBackendType,
        actorId,
        sessionId: messageSessionId,
        feedback: feedbackPayload
      });

      if (MONGO_API_BASE) {
        const response = await fetch(`${MONGO_API_BASE}/api/feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actor_id: actorId,
            session_id: messageSessionId,
            message_index: index,
            type,
            reasons,
            comment
          })
        });
        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          throw new Error(`Feedback API error ${response.status}${errorText ? `: ${errorText}` : ''}`);
        }
      }

      return true;
    } catch (error) {
      console.error('Failed to submit feedback:', error);
      showNotification('Failed to save feedback in memory. Please try again.', 'error');
      return false;
    }
  };

  /**
   * Get the query from the previous user message
   * Currently unused - kept for potential future use with feedback modal
   */
  // const getQuery = () => {
  //   // Find the previous user message in the messages array
  //   for (let i = index - 1; i >= 0; i--) {
  //     if (messages[i] && messages[i].role === 'user') {
  //       return messages[i].text;
  //     }
  //   }
  //   return 'Unknown query';
  // };

  /**
   * Handle copy to clipboard
   */
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.text);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
      showNotification('Failed to copy to clipboard', 'error');
    }
  };

  useEffect(() => {
    if (!feedbackType) {
      return undefined;
    }

    const handleOutsideClick = (event) => {
      if (
        feedbackType === 'dislike' &&
        dislikePopoverRef.current &&
        !dislikePopoverRef.current.contains(event.target)
      ) {
        setFeedbackType(null);
      }

      if (
        feedbackType === 'suggest' &&
        suggestPopoverRef.current &&
        !suggestPopoverRef.current.contains(event.target)
      ) {
        setFeedbackType(null);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [feedbackType]);

  /**
   * Handle Excel download
   */
  const handleExcelDownload = async () => {
    if (isDownloading) return;
    
    setIsDownloading(true);
    try {
      
      // Priority 1: Use excel_file_id if available (from backend that supports it)
      if (message.excel_file_id) {
        const apiBase = (process.env.REACT_APP_API_BASE_URL || '').replace(/\/+$/, '');
        const downloadUrl = `${apiBase}/download-excel/${message.excel_file_id}`;
        const response = await fetch(downloadUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          }
        });
        
        if (!response.ok) {
          throw new Error(`Failed to download Excel file: ${response.statusText}`);
        }
        
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `CGMSCL_Query_Results_${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        // Track download for feedback
        // trackDownload('excel');
      }
      // Priority 2: Generate Excel from data rows (from current API)
      else if (message.dataRows && Array.isArray(message.dataRows) && message.dataRows.length > 0) {
        const filename = `CGMSCL_Query_Results_${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx`;
        // Pass columns if available
        await generateExcelFromData(message.dataRows, filename, message.dataColumns);
        // trackDownload('excel');
      }
      // Priority 3: Generate Excel from suggestions (alternative data format)
      else if (message.suggestions && Array.isArray(message.suggestions) && message.suggestions.length > 0) {
        const filename = `CGMSCL_Query_Results_${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx`;
        await generateExcelFromData(message.suggestions, filename);
        // trackDownload('excel');
      }
      // Priority 4: Generate Excel from response text (extract tables if present)
      else if (message.text) {
        const filename = `CGMSCL_Query_Results_${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx`;
        await generateExcelFromResponse(message.text, filename);
        // trackDownload('excel');
      }
      else {
        throw new Error('No data available to export');
      }
    } catch (error) {
      console.error('Error downloading Excel file:', error);
      showNotification('Failed to download Excel file. Please try again.', 'error');
    } finally {
      setIsDownloading(false);
    }
  };

  /**
   * Handle feedback button click
   */
  // const handleFeedback = (rating) => {
  //   setSelectedRating(rating);
  //   setActiveFeedback(rating);
  //   setShowFeedbackModal(true);
  // };

  /**
   * Handle feedback modal close
  //  * @param {string|null} submittedRating - The rating that was submitted, or null if cancelled
  //  */
  // const handleCloseFeedbackModal = (submittedRating) => {
  //   setShowFeedbackModal(false);
  //   // If feedback was submitted, keep the active state; otherwise reset it
  //   if (submittedRating) {
  //     setActiveFeedback(submittedRating);
  //   } else {
  //     // Only reset if no feedback was previously submitted
  //     // This allows users to change their feedback
  //     if (!activeFeedback) {
  //       setActiveFeedback(null);
  //     }
  //   }
  // };

  return (
    <>
      {feedbackType === 'dislike' && (
        <div
          ref={dislikePopoverRef}
          style={{
            marginBottom: 8,
            padding: 10,
            border: '1px solid #e0e0e0',
            borderRadius: 8,
            position: 'relative'
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>What went wrong?</div>
          {['Wrong SQL generated', 'Incorrect data returned', 'Unclear response', 'Wrong table used'].map((reason) => (
            <label key={reason} style={{ display: 'block', fontSize: '0.9rem' }}>
              <input
                type="checkbox"
                checked={dislikeReasons.includes(reason)}
                onChange={(e) => {
                  setDislikeReasons((prev) => e.target.checked ? [...prev, reason] : prev.filter((item) => item !== reason));
                }}
              />{' '}
              {reason}
            </label>
          ))}
          <textarea
            value={dislikeComment}
            onChange={(e) => setDislikeComment(e.target.value)}
            placeholder="Additional comments (optional)"
            style={{ width: '100%', marginTop: 8, minHeight: 60 }}
          />
          <button
            className="feedback-submit-btn"
            onClick={async () => {
              const saved = await submitFeedback({
                type: 'dislike',
                reasons: dislikeReasons,
                comment: dislikeComment
              });
              if (!saved) return;
              setSelectedFeedback('dislike');
              setFeedbackType(null);
              setDislikeComment('');
              setDislikeReasons([]);
            }}
          >
            Submit
          </button>
        </div>
      )}

      {feedbackType === 'suggest' && (
        <div
          ref={suggestPopoverRef}
          style={{
            marginBottom: 8,
            padding: 10,
            border: '1px solid #e0e0e0',
            borderRadius: 8,
            position: 'relative'
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Suggest an improvement</div>
          <textarea
            value={suggestionComment}
            onChange={(e) => setSuggestionComment(e.target.value)}
            placeholder="How could this answer be better?"
            style={{ width: '100%', minHeight: 70 }}
          />
          <button
            className="feedback-submit-btn"
            onClick={async () => {
              const saved = await submitFeedback({
                type: 'suggest',
                comment: suggestionComment.trim()
              });
              if (!saved) return;
              setFeedbackType(null);
              setSuggestionComment('');
            }}
          >
            Submit
          </button>
        </div>
      )}

      <div className="message-actions">
        <button 
          className={`action-btn thumbs-up-btn ${selectedFeedback === 'like' ? 'active' : ''}`}
          onClick={async () => {
            const saved = await submitFeedback({ type: 'like' });
            if (!saved) return;
            setSelectedFeedback('like');
            setFeedbackType(null);
          }}
          title="Like"
          aria-label="Like response"
          disabled={selectedFeedback === 'dislike'}
        >
          <i className="fas fa-thumbs-up"></i>
        </button>
        <button
          className={`action-btn thumbs-down-btn ${selectedFeedback === 'dislike' ? 'active' : ''}`}
          onClick={() => {
            setFeedbackType(feedbackType === 'dislike' ? null : 'dislike');
          }}
          title="Dislike"
          aria-label="Dislike response"
          disabled={selectedFeedback === 'like'}
        >
          <i className="fas fa-thumbs-down"></i>
        </button>
        <button
          className="action-btn"
          onClick={() => setFeedbackType(feedbackType === 'suggest' ? null : 'suggest')}
          title="Suggest"
          aria-label="Suggest improvement"
        >
          <i className="fas fa-comment-dots"></i>
        </button>
        <button
          className="action-btn copy-btn"
          onClick={handleCopy}
          title="Copy message"
          aria-label="Copy message"
        >
          {isCopied ? <i className="fas fa-check"></i> : <i className="fas fa-copy"></i>}
        </button>
        {(message.excel_download || message.excel_file_id || message.dataRows || message.suggestions) && (
          <button
            className="action-btn excel-download-btn"
            onClick={handleExcelDownload}
            title="Download Excel file"
            aria-label="Download Excel file"
            disabled={isDownloading}
          >
            <img src={excelIcon} alt="Download Excel" style={{ width: '20px', height: '20px', objectFit: 'contain' }} />
          </button>
        )}
      </div>

    </>
  );
}

export default MessageActions;
