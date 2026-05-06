import React from 'react';
import MessageActions from './MessageActions';
import AnalysisDropdown from '../common/AnalysisDropdown';

/**
 * Renders assistant text with markdown: tables, lists, bold, code, headings.
 */
function MessageText({ text }) {
  if (!text) return null;

  const lines = text.split('\n');
  const elements = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line
    if (!line.trim()) { i++; continue; }

    // Heading ###
    if (line.startsWith('### ')) {
      elements.push(<h3 key={i} className="msg-h3">{renderInline(line.slice(4))}</h3>);
      i++; continue;
    }
    // Heading ####
    if (line.startsWith('#### ')) {
      elements.push(<h4 key={i} className="msg-h4">{renderInline(line.slice(5))}</h4>);
      i++; continue;
    }

    // Markdown table: collect all pipe-rows
    if (line.trim().startsWith('|')) {
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      elements.push(<MdTable key={i} rows={tableLines} />);
      continue;
    }

    // Bullet list item
    if (/^[-•*]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-•*]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[-•*]\s+/, ''));
        i++;
      }
      elements.push(
        <ul key={i} className="msg-ul">
          {items.map((item, idx) => (
            <li key={idx} className="msg-li msg-li--bullet">{renderInline(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Numbered list
    if (/^\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i++;
      }
      elements.push(
        <ol key={i} className="msg-ul">
          {items.map((item, idx) => (
            <li key={idx} className="msg-li">{renderInline(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Normal paragraph
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith('### ') &&
      !lines[i].startsWith('#### ') &&
      !lines[i].trim().startsWith('|') &&
      !/^[-•*]\s/.test(lines[i]) &&
      !/^\d+\.\s/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length) {
      elements.push(
        <p key={i} className="msg-p">
          {paraLines.map((pl, idx) => (
            <React.Fragment key={idx}>
              {idx > 0 && <br />}
              {renderInline(pl)}
            </React.Fragment>
          ))}
        </p>
      );
    }
  }

  return <div className="message-text">{elements}</div>;
}

/** Render a markdown table from raw pipe-delimited lines */
function MdTable({ rows }) {
  const isSep = (r) => /^\|[\s\-|:]+\|$/.test(r.trim());
  const parseRow = (r) => r.split('|').map(function(c){ return c.trim(); }).filter(Boolean);

  const headerRow = rows[0] ? parseRow(rows[0]) : [];
  const dataRows = rows.filter(function(r, idx){ return idx !== 0 && !isSep(r); });

  if (!headerRow.length) return null;

  return (
    <div className="msg-table-wrap">
      <table className="msg-table">
        <thead>
          <tr>{headerRow.map(function(h, i){ return <th key={i}>{renderInline(h)}</th>; })}</tr>
        </thead>
        <tbody>
          {dataRows.map(function(row, ri) {
            const cells = parseRow(row);
            return (
              <tr key={ri}>
                {headerRow.map(function(_, ci){ return <td key={ci}>{renderInline(cells[ci] || '')}</td>; })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Inline markdown: bold and inline code */
function renderInline(text) {
  if (!text) return null;
  const parts = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/^(.*?)\*\*(.+?)\*\*(.*)/s);
    const codeMatch = remaining.match(/^(.*?)`([^`]+)`(.*)/s);

    const boldIdx = boldMatch ? (boldMatch[1] ? boldMatch[1].length : 0) : Infinity;
    const codeIdx = codeMatch ? (codeMatch[1] ? codeMatch[1].length : 0) : Infinity;

    if (boldMatch && boldIdx <= codeIdx) {
      if (boldMatch[1]) parts.push(<React.Fragment key={key++}>{boldMatch[1]}</React.Fragment>);
      parts.push(<strong key={key++}>{boldMatch[2]}</strong>);
      remaining = boldMatch[3];
    } else if (codeMatch && codeIdx < boldIdx) {
      if (codeMatch[1]) parts.push(<React.Fragment key={key++}>{codeMatch[1]}</React.Fragment>);
      parts.push(<code key={key++} className="msg-code">{codeMatch[2]}</code>);
      remaining = codeMatch[3];
    } else {
      parts.push(<React.Fragment key={key++}>{remaining}</React.Fragment>);
      break;
    }
  }
  return parts;
}

/**
 * DataTable — renders structured dataRows + dataColumns from the API response.
 * Shows a paginated, scrollable table if data is present.
 */
function DataTable({ rows, columns }) {
  const [page, setPage] = React.useState(0);
  const PAGE_SIZE = 50;
  const dateFormatter = React.useMemo(function() {
    return new Intl.DateTimeFormat('en-GB');
  }, []);

  function formatCellValue(value) {
    if (value === null || value === undefined) return '—';
    if (typeof value !== 'string') return String(value);

    const trimmed = value.trim();
    const isoDateTimePattern = /^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
    if (!isoDateTimePattern.test(trimmed)) {
      return trimmed;
    }

    const parsedDate = new Date(trimmed);
    if (Number.isNaN(parsedDate.getTime())) {
      return trimmed;
    }

    return dateFormatter.format(parsedDate);
  }

  if (!rows || !Array.isArray(rows) || rows.length === 0) return null;

  // Detect if rows are arrays (positional) or objects (keyed)
  const rowsAreArrays = Array.isArray(rows[0]);

  const cols = (columns && columns.length > 0)
    ? columns
    : rowsAreArrays
      ? rows[0].map(function(_, i) { return 'Column ' + (i + 1); })
      : Object.keys(rows[0] || {});

  if (cols.length === 0) return null;

  const totalPages = Math.ceil(rows.length / PAGE_SIZE);
  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="data-table-section">
      <div className="data-table-meta">
        <span className="data-table-count">
          {rows.length} {rows.length === 1 ? 'record' : 'records'} found
        </span>
        {totalPages > 1 && (
          <span className="data-table-page">Page {page + 1} of {totalPages}</span>
        )}
      </div>
      <div className="msg-table-wrap">
        <table className="msg-table">
          <thead>
            <tr>
              {cols.map(function(col, ci) {
                return <th key={ci}>{String(col).replace(/_/g, ' ')}</th>;
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.map(function(row, ri) {
              return (
                <tr key={ri}>
                  {cols.map(function(col, ci) {
                    // Support both array rows (positional) and object rows (keyed)
                    const val = rowsAreArrays ? row[ci] : row[col];
                    return <td key={ci}>{formatCellValue(val)}</td>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="data-table-pagination">
          <button className="dt-page-btn" onClick={function(){ setPage(function(p){ return Math.max(0, p-1); }); }} disabled={page === 0}>
            Prev
          </button>
          {Array.from({ length: totalPages }, function(_, i){ return i; })
            .filter(function(i){ return Math.abs(i - page) <= 2; })
            .map(function(i) {
              return (
                <button
                  key={i}
                  className={'dt-page-btn' + (i === page ? ' dt-page-btn--active' : '')}
                  onClick={function(){ setPage(i); }}
                >
                  {i + 1}
                </button>
              );
            })}
          <button className="dt-page-btn" onClick={function(){ setPage(function(p){ return Math.min(totalPages-1, p+1); }); }} disabled={page === totalPages - 1}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Message Bubble Component
 */
function MessageBubble({ message, index, messages }) {
  if (messages === undefined) messages = [];
  const isUser = message.role === 'user';
  const [showSQL, setShowSQL] = React.useState(false);
  const hasSQL = !isUser && message.sql_query && String(message.sql_query).trim().length > 0;
  const hasSummaryHighlight =
    !isUser &&
    typeof message.summary_highlight === 'string' &&
    message.summary_highlight.trim().length > 0;
  const shouldRenderMessageText =
    typeof message.text === 'string' &&
    message.text.trim().length > 0 &&
    (!hasSummaryHighlight || message.text.trim() !== message.summary_highlight.trim());

  return (
    <div className={'message ' + (isUser ? 'user-message' : 'bot-message')}>
      <div className="message-bubble">

        {!isUser && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1F7246', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              CGMSCL GPT
            </span>
            {typeof message.response_time_sec === 'number' && (
              <span style={{ fontSize: '0.72rem', color: '#9ca3af', background: '#f3f4f6', padding: '2px 8px', borderRadius: 20, border: '1px solid #e5e7eb' }}>
                {message.response_time_sec.toFixed(1)}s
              </span>
            )}
            {message.feedback_rule_applied && (
              <span className="feedback-memory-badge">Feedback applied</span>
            )}
          </div>
        )}

        <div className="message-content">
          {hasSummaryHighlight && (
            <p className="msg-p" style={{ fontWeight: 600 }}>
              {message.summary_highlight}
            </p>
          )}
          {hasSQL && (
            <div style={{ marginBottom: 8 }}>
              <button className="sql-toggle-btn" onClick={function(){ setShowSQL(function(v){ return !v; }); }}>
                {showSQL ? 'Hide SQL' : 'Show SQL'}
              </button>
              {showSQL && <pre className="sql-query-block">{message.sql_query}</pre>}
            </div>
          )}
          {hasSQL && <AnalysisDropdown sqlQuery={message.sql_query} />}

          {shouldRenderMessageText && <MessageText text={message.text} />}

          <DataTable rows={message.dataRows} columns={message.dataColumns} />
        </div>

        {!isUser && (
          <MessageActions message={message} index={index} messages={messages} />
        )}
      </div>
    </div>
  );
}

export default MessageBubble;
