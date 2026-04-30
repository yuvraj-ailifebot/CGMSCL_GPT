import { normalizeAWSResponse, normalizeOCIResponse } from '../utils/responseNormalizer';

const AWS_QUERY_API_URL = 'https://qgpel27gok.execute-api.ap-south-1.amazonaws.com/dev/master';
const OCI_QUERY_API_URL = 'https://kkthcckqby2ta244ytlu4r25xi.apigateway.ap-hyderabad-1.oci.customer-oci.com/api/test';
const AWS_ANALYSIS_API_URL = 'https://ytfvdexbhj.execute-api.ap-south-1.amazonaws.com/prod/query';
const OCI_ANALYSIS_API_URL = 'https://kkthcckqby2ta244ytlu4r25xi.apigateway.ap-hyderabad-1.oci.customer-oci.com/api/analysis';

export function getQueryApiUrl(backendType) {
  return backendType === 'OCI' ? OCI_QUERY_API_URL : AWS_QUERY_API_URL;
}

export function getAnalysisApiUrl(backendType) {
  return backendType === 'OCI' ? OCI_ANALYSIS_API_URL : AWS_ANALYSIS_API_URL;
}

export function normalizeBackendResponse(rawResponse, backendType) {
  return backendType === 'OCI' ? normalizeOCIResponse(rawResponse) : normalizeAWSResponse(rawResponse);
}

function buildChatPayload({
  query,
  actorId,
  sessionId,
  endSession = false,
  directSql = null,
  useMemory,
  feedback = null
}) {
  const payload = {
    actor_id: actorId,
    session_id: sessionId
  };

  if (typeof query === 'string' && query.trim()) {
    payload.query = query.trim();
  }

  if (endSession) {
    payload.end_session = true;
  }

  if (typeof directSql === 'string' && directSql.trim()) {
    payload.direct_sql = directSql.trim();
  }

  if (typeof useMemory === 'boolean') {
    payload.use_memory = useMemory;
  }

  if (feedback && typeof feedback === 'object') {
    const normalizedFeedback = {};
    if (typeof feedback.reaction === 'string' && feedback.reaction.trim()) {
      normalizedFeedback.reaction = feedback.reaction.trim().toLowerCase();
    }
    if (typeof feedback.comment === 'string' && feedback.comment.trim()) {
      normalizedFeedback.comment = feedback.comment.trim();
    }
    if (Object.keys(normalizedFeedback).length > 0) {
      payload.feedback = normalizedFeedback;
    }
  }

  return payload;
}

export async function sendChatQuery({
  backendType,
  query,
  actorId,
  sessionId,
  endSession = false,
  directSql = null,
  useMemory,
  feedback = null
}) {
  const requestUrl = getQueryApiUrl(backendType);
  const payload = buildChatPayload({
    query,
    actorId,
    sessionId,
    endSession,
    directSql,
    useMemory,
    feedback
  });

  const response = await fetch(requestUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`API error ${response.status}${errorText ? `: ${errorText}` : ''}`);
  }

  const rawData = await response.json();
  return normalizeBackendResponse(rawData, backendType);
}
