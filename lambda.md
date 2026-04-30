# Master Lambda Stage2 - Full Integration Guide

This document is a complete handoff for frontend/backend integration of the deployed Lambda.
It explains request/response contracts, internal logic, memory behavior, external APIs, expected logs, and test scenarios.

### Document changelog (backend updates your frontend must handle)

Use this as the single source of truth for **current** behavior versus older integrations.

| Area | Change |
|------|--------|
| **Response types** | Normal NL replies may be `type: "general"` (conversational), standard SQL success (default `type` absent — treat as data+sql path), or construction. New metadata now includes `follow_up_questions` and `feedback_rule_applied` on conversational/data summary flows. There is **no** `memory_wait` response type in the current build. |
| **Short-term session memory** | At the start of each NL request with `use_memory=true`, Lambda calls **`retrieve_past_context`**, which uses AgentCore **`list_events`** (synchronous, fast) to build recent context for this `actor_id` + `session_id` (including feedback events). That text is injected into **GENERAL** (Haiku), **CONSTRUCTION** (Sonnet), and **standard-SQL summary** (Haiku) prompts. Each successful GENERAL or standard-SQL turn is written with **`create_event`**; feedback can also be written as a dedicated memory event. |
| **Conversational tone** | The GENERAL system prompt instructs the model to **trust** injected session context and **not** deny remembering when that context is present. |
| **Context-followup routing** | Queries matching memory-intent phrases (e.g. *prior context*, *what did we discuss*, *based on earlier turns*) **skip table classification** and are forced to **`GENERAL`** so they do not run bogus SQL. |
| **Classifier robustness** | If Haiku returns a long string instead of a single token, Lambda **extracts** the first embedded valid table token when possible instead of immediately falling back to `PO_DATA`. |
| **Dynamo MCP cache** | **`put_mcp_response` is disabled** in code. **`cache_id` is always `null`** on `direct_sql` and standard SQL responses. Flag `ENABLE_DYNAMO_CACHE` exists but cache write is not wired; do not rely on `cache_id` for drill-down until re-enabled. |
| **MCP execution** | SQL execution **retries up to 3 times** with short backoff on transient network failures. |
| **MCP URL** | **`MCP_URL`** environment variable overrides default endpoint. |
| **AgentCore limits** | **`AGENTCORE_MEMORY_MAX_TURNS`** (default **6**): at most **six conversation rounds** (six AgentCore **events**) are kept per `actor_id` + `session_id`; when a **seventh** round is written, the **oldest** event(s) are deleted (`turn_pruned` in logs). **`AGENTCORE_MEMORY_TTL_HOURS`** (default **2**) removes older events (`ttl_pruned`). **`AGENTCORE_MEMORY_TOP_K`** (default follows max turns) caps how many recent **events** are considered when building the context string for the LLM. Optional **`AGENTCORE_MEMORY_LIST_EVENTS_MAX_PAGES`** (default **40**) bounds `list_events` pagination during retrieve. |
| **Logging** | Table/memory logs use ASCII markers (`OK` / `ERR`) for Windows-safe output. |
| **QA** | Repo script **`test_memory_ttl_turns.ps1`** still tolerates a legacy **`memory_wait`** response if ever reintroduced; typical runs see **no** `memory_wait` and finish with a **PASS/FAIL JSON summary**. |

---

## 1) What This Lambda Does

The Lambda serves as an AI query orchestrator for CGMSCL data and supports four major paths:

1. `direct_sql` path (execute SQL directly on MCP and return raw data; `cache_id` is currently `null`)
2. `GENERAL` conversational path (no SQL, no MCP; **uses AgentCore context when available** and **persists** turns to memory)
3. `CONSTRUCTION` path (fetch live construction API data + LLM narrative)
4. `STANDARD SQL` path (classify table -> generate SQL -> execute MCP -> summarize -> memory write)

It also supports session memory lifecycle (short-term, same as NL-to-SQL “previous context”):
- **Retrieve** recent conversation lines from AgentCore **`list_events`** at request start (when `use_memory=true`)
- **Inject** that context into the **standard-SQL summary** LLM prompt and into the **GENERAL** LLM prompt when non-empty
- **Write** each completed round (user query + assistant reply) as one **`create_event`** after GENERAL and standard SQL flows
- **Prune** to the last **`AGENTCORE_MEMORY_MAX_TURNS`** rounds (default 6) after each write; older rounds are removed so the **next** user message starts a fresh tail of at most six stored rounds
- **Clear** all session events (and related summary records) when `end_session=true`

---

## 2) High-Level Architecture

Input (API Gateway/Lambda Event) -> `lambda_handler` ->

- Parse body safely (`_parse_api_gateway_body`)
- Read request metadata (`query`, `actor_id`, `session_id`, `end_session`, `direct_sql`, optional `use_memory`)
- If `direct_sql` → skip memory and LLM classification, go straight to MCP
- If `use_memory=true` (or omitted): **retrieve** short-term session context (`retrieve_past_context` → `list_events`) on the NL path (no wait / no `memory_wait`)
- If `use_memory=false`: **skip** AgentCore retrieval for this turn (stateless handling; empty `past_context`)
- Table classification LLM (Haiku)
- Route to one of:
  - GENERAL response LLM (Haiku) with optional memory context
  - CONSTRUCTION data fetch + response LLM (Sonnet)
  - STANDARD SQL pipeline:
    - SQL generation LLM (Sonnet)
    - MCP SQL execution
    - Cache store is disabled in current build (`cache_id=null`)
    - Summary generation LLM (Haiku) with optional memory context injection
    - Memory write (`write_to_memory`) unless `end_session=true`
- Return API response with CORS headers

External dependencies:
- AWS Bedrock Runtime (`invoke_model`, `count_tokens`)
- AWS Bedrock AgentCore (`list_events`, `create_event`, `delete_event`, optional `list_memory_records` / deletes for clear and prune side-effects)
- MCP SQL endpoint (`MCP_URL`)
- Construction API (`CONSTRUCTION_API_URL`)

---

## 3) Runtime Files and Responsibilities

- `lambda_function.py`
  - Main request router and LLM orchestration
  - SQL execution and response formatting
  - Construction mode logic

- `agentcore_memory.py`
  - AgentCore memory read/write/clear logic
  - Verbose memory diagnostics (`MEMORY_VERBOSE_LOG`)

- `llm_limits.py`
  - Payload and prompt safety limits
  - Helper functions for truncation/shrinking payloads

- `cache_store.py`
  - Present in repository, but runtime cache-write path is intentionally disabled in current build

- `hardening_e2e_test.py`
  - Local harness: classify → generate SQL → MCP execute for a fixed set of NL queries (requires network to MCP and Bedrock credentials)

- `prompts/`
  - Classifier and table-specific SQL generation instructions (see §7.8)

---

## 4) Input Contract (What Frontend Should Send)

### 4.1 API Gateway POST body (preferred)

Send JSON object directly:

```json
{
  "query": "Which POs have partial supply below 50 percent?",
  "actor_id": "user_123",
  "session_id": "chat_001",
  "end_session": false
}
```

### 4.2 Lambda test event shape (console tests)

Use wrapper object with `body`:

```json
{
  "body": {
    "query": "Which POs have partial supply below 50 percent?",
    "actor_id": "user_123",
    "session_id": "chat_001",
    "end_session": false
  }
}
```

`body` may be stringified JSON as well; parser supports both.

---

## 5) Request Fields

### Required (typical request)
- `query` (string): natural-language question

### Optional
- `actor_id` (string): logical user id for memory scope
  - default: `user_default`
- `session_id` (string): chat/session id for memory scope
  - default: `session_default`
- `end_session` (bool/string/int):
  - truthy accepted: `true`, `"true"`, `"True"`, `1`, `"1"`
  - when true: clears memory at end of request (or immediately if no query)
- `direct_sql` (string): bypass LLM classification and SQL generation
- `use_memory` (bool/string/int, **optional**):
  - when omitted: treated as **true** (backwards compatible; memory is used when available)
  - explicit **false** values: `false`, `"false"`, `"False"`, `0`, `"0"`
  - when `use_memory=true`:
    - Lambda **immediately** retrieves short-term session context from AgentCore (`list_events`). There is **no** `memory_wait` gate.
    - On GENERAL and standard SQL paths, Lambda **writes** the completed round to AgentCore unless `end_session=true`.
  - when `use_memory=false`:
    - Lambda **skips** AgentCore retrieval for this request.
    - The request is handled as a **stateless** turn (no injected past context), which typically improves latency.
- `feedback` (object, **optional**):
  - accepted fields:
    - `reaction`: `like` or `dislike` (aliases like `up/down`, `thumbsup/thumbsdown` are normalized in backend)
    - `comment`: free text (optional, truncated server-side)
  - behavior:
    - feedback is written to session memory as a dedicated event and used as a **critical guidance rule** in subsequent responses
    - can be sent together with a normal `query`, or as a feedback-only call without `query`

### Feedback-only request shape
If you only want to store feedback (no chat turn), send:

```json
{
  "actor_id": "user_123",
  "session_id": "chat_001",
  "feedback": {
    "reaction": "dislike",
    "comment": "Need shorter answer and supplier-wise split."
  }
}
```

---

## 6) Output Contract (What Frontend Receives)

All responses include:
- `statusCode`
- CORS headers
- `body` as JSON string

### 6.0 Response `type` quick reference

| Situation | HTTP | `type` (if set) | Typical fields |
|-----------|------|-----------------|----------------|
| Standard SQL success | 200 | *(omitted)* | `query`, `sql`, `data`, `response`, `message`, `cache_id` (null) |
| GENERAL success | 200 | `"general"` | `query`, `sql`: null, `data`: [], `response`, `visualization` |
| CONSTRUCTION success | 200 | *(no `type`; same as before)* | `query`, `data`, `response`, `visualization` |
| `direct_sql` success | 200 | *(no `type`)* | `data`, `sql`, `cache_id` (null) |
| End session only | 200 | *(no `type`)* | `message`, `actor_id`, `session_id` |

**Frontend rule:** branch on **`body.type`** when present; otherwise treat as the standard SQL payload shape above.

### 6.1 Standard SQL success
`body` contains:
- `query`
- `sql`
- `data` (MCP result payload)
- `cache_id` (`null` while cache store is disabled)
- `response` (AI summary text)
- `message` (`Data returned with inline AI summary.`)

### 6.2 General path success
`body` contains:
- `query`
- `sql`: `null`
- `data`: `[]`
- `response` (plain conversational text; may use **prior-session** context when AgentCore returned recent turns for this `actor_id` + `session_id`)
- `type`: `"general"`
- `visualization` object with null fields

**Memory note:** Before responding, Lambda builds short-term context from **`list_events`** and passes a **truncated** block into the GENERAL model (`MAX_SUMMARY_MEMORY_CONTEXT_CHARS`, default 8000). After a successful reply, Lambda calls **`write_to_memory`** with the user query and assistant text unless `end_session=true`.

### 6.3 Construction path success
`body` contains:
- `query`
- `sql`: `null`
- `data`: construction array
- `response` (markdown)
- `visualization` (chart recommendation object)

### 6.4 Direct SQL success
`body` contains:
- `data`
- `sql`
- `cache_id` (`null` while cache store is disabled)

### 6.5 End-session-only success
`body` contains:
- `message`: `"Session memory cleared."`
- `actor_id`
- `session_id`

### 6.6 Error responses
- `400`: invalid JSON / missing required fields
- `500`: Bedrock/API/internal errors

---

## 7) Detailed Flow Logic

End-to-end sequence for a normal NL question (standard SQL path):

1. Parse body → read `query`, `actor_id`, `session_id`, `end_session`, optional `direct_sql`.
2. If `direct_sql` is set → validate → MCP → return (`cache_id=null`; no classification, no summary LLM).
3. If `end_session` only (no query) → clear memory → return.
4. Else (not `direct_sql`): check `use_memory` (defaults to true when omitted).
5. If `use_memory=true`:
   - **retrieve** short-term session context via `retrieve_past_context` → AgentCore `list_events` (non-blocking; failures yield empty `past_context` and the request continues).
6. If `use_memory=false`:
   - **skip** AgentCore retrieval for this turn; continue with empty `past_context`.
7. **Classify** query → table token (Haiku), with robust token extraction from verbose classifier output.
8. Memory-intent conversational prompts (substring match, case-insensitive): `prior context`, `earlier in this session`, `what did we discuss`, `based on earlier turns`, `conversation so far`, `using our prior chat context`, `from previous answers`, `from earlier answers` — forced to **`GENERAL`** (classifier skipped).
9. If `GENERAL` or `CONSTRUCTION` → dedicated branches (no MCP for GENERAL).
10. If SQL table token → **generate SQL** (Sonnet) with general + table + strict prompts → **MCP execute** → **summarize** (Haiku, with optional memory context when `use_memory=true`) → **write memory** unless `end_session=true`.
11. If `end_session=true` with a query → same branch as above for that path, then **clear** memory instead of write (GENERAL path clears at end; standard SQL clears at end; CONSTRUCTION clears at end if flag set).

### 7.1 Body Parsing and Validation
- `_parse_api_gateway_body` normalizes input:
  - `body=null` -> `{}`
  - string JSON -> parsed dict
  - invalid JSON -> `None` -> returns 400

### 7.2 Session Controls
- If `end_session=true` and no `query` -> clear session memory and return immediately.
- If `end_session=true` with normal query:
  - process request normally
  - clear session at the end (instead of writing new turn in standard flow)
- If `direct_sql` is set: no memory retrieve; if `end_session=true`, memory is cleared after MCP returns (same request).
- On NL requests with `use_memory=true`, retrieval runs **every** turn with **no** artificial delay.

### 7.3 Table Classifier (LLM Call 1)
- Model: `CLASSIFIER_MODEL_ID` (Haiku default)
- Response is normalized to **uppercase** and matched against `valid_tables`.
- If exact-match fails but output contains a valid token, backend extracts that token instead of defaulting immediately.
- Valid tokens (same order as code):
  - `PO_DATA`, `TENDER_DATA`, `EXPIRED_ITEMS`, `MV_QC_TRANSACTIONS`,
    `MV_ACCEPTED_RC_PENDING`, `MV_BATCHWISECURRENTSTOCK`, `MV_PAYMENT_STATUS`,
    `MV_PIPELINE_SUPPLIES`, `MASVENDORREGISTRATION`, `MV_PO_PLANNING26_27`,
    `MV_WH_STOCK_READY_UQC`, `MV_TENDER_PO_PLANNING`, `CONSTRUCTION`, `GENERAL`
- **Planning compatibility:** `MV_PO_PLANNING26_27` is the primary planning token aligned with the live materialized view name. `MV_TENDER_PO_PLANNING` remains a **valid classifier output** for backward compatibility (older prompts/docs); SQL generation loads the **same** prompt file as `MV_PO_PLANNING26_27` (`table10_MV_PO_PLANNING26_27.txt`) so generated SQL targets `MV_PO_PLANNING26_27`. If your Oracle schema still has `MV_TENDER_PO_PLANNING`, adjust prompts or classifier only after confirming the object exists.
- Invalid classifier result falls back to `PO_DATA`.

### 7.4 SQL Generation (LLM Call 2)
- Uses:
  - `prompt_general.txt`
  - table-specific schema prompt
  - `strict_restrictions.txt`
- Model: `MODEL_ID` (Sonnet default)
- Returns cleaned Oracle SQL string.

### 7.5 SQL Execution
- Sends POST to `MCP_URL` with:
  - `{"sql": "<generated sql>"}`
- Timeout: 30s per attempt
- On failure (network reset, empty response, etc.), **up to 3 attempts** with short backoff before returning `{"error": "SQL execution failed: ..."}`.
- Returns MCP JSON payload directly on success.

### 7.6 Summary Generation (LLM Call 3 in current active flow)
- Function: `generate_summary_from_data`
- Model: `CLASSIFIER_MODEL_ID` (Haiku)
- Extracts rows robustly from multiple MCP formats
- For empty rows: returns deterministic "No data found..." message without invoking model
- For non-empty rows:
  - samples/shrinks JSON payload using limits
  - injects memory context if available
  - returns concise insight summary

### 7.7 Memory Lifecycle
- **Retrieve (when `use_memory=true`):**
  - `retrieve_past_context` calls **`list_events`** for this `memoryId`, `actor_id`, `session_id`.
  - It **pages** through results (bounded by `AGENTCORE_MEMORY_LIST_EVENTS_MAX_PAGES`), sorts events by time, keeps the **most recent** up to `min(AGENTCORE_MEMORY_TOP_K, AGENTCORE_MEMORY_MAX_TURNS)` **events**, and formats embedded **`conversational`** payloads as `User:` / `Assistant:` lines for the LLM.
  - This path is **synchronous and fast**; it does **not** depend on long-term summary extraction.

- **Write** at **standard SQL** success and **`GENERAL`** success:
  - One **`create_event`** per completed round: payload contains **USER** then **ASSISTANT** for that turn.
  - **CONSTRUCTION** path does **not** write to AgentCore in the current code; logs still indicate no memory write for that flow.

- **Clear:**
  - Deletes session **events** and best-effort deletes **summary** records under `/summaries/{actor_id}/{session_id}/` so nothing stale remains after “End chat”.

- **Limits** (enforced after each successful `write_to_memory`):
  - **At most `AGENTCORE_MEMORY_MAX_TURNS` conversation rounds** (default **6**) are stored: each round is **one** AgentCore event. When a **new** round is written and the session already has six, the **oldest** event(s) are deleted first (`turn_pruned` in logs).
  - **TTL:** events older than `AGENTCORE_MEMORY_TTL_HOURS` are removed (`ttl_pruned` in logs).
  - When pruning deletes any event, summary records for that session namespace are cleared (`summary_records_pruned`) so long-term indexes do not disagree with trimmed short-term events.

### 7.8 Prompt file map (SQL generation)
Classifier token → file under `prompts/`:

| Token | Prompt file |
|-------|----------------|
| `PO_DATA` | `table1_po_data.txt` |
| `TENDER_DATA` | `table2_tender_data.txt` |
| `EXPIRED_ITEMS` | `table3_expired_items.txt` |
| `MV_QC_TRANSACTIONS` | `table4_MV_QC_TRANSACTIONS.txt` |
| `MV_ACCEPTED_RC_PENDING` | `table5_MV_ACCEPTED_RC_PENDING.txt` |
| `MV_BATCHWISECURRENTSTOCK` | `table6_MV_BATCHWISECURRENTSTOCK.txt` |
| `MV_PAYMENT_STATUS` | `table7_MV_PAYMENT_STATUS.txt` |
| `MV_PIPELINE_SUPPLIES` | `table8_MV_PIPELINE_SUPPLIES.txt` |
| `MASVENDORREGISTRATION` | `table9_MASVENDORREGISTRATION.txt` |
| `MV_PO_PLANNING26_27` | `table10_MV_PO_PLANNING26_27.txt` |
| `MV_WH_STOCK_READY_UQC` | `table11_MV_WH_STOCK_READY_UQC.txt` |
| `MV_TENDER_PO_PLANNING` | `table10_MV_PO_PLANNING26_27.txt` (compat; same instructions as planning26_27) |

Shared on every SQL path: `prompt_general.txt`, `strict_restrictions.txt`, plus `table_classifier.txt` for call 1 only.

Legacy file `table12_MV_tender_po_planning.txt` may exist for reference; runtime SQL gen uses `table10` for both planning tokens above.

---

## 8) AgentCore Memory Behavior (Important for Frontend)

### Key point
Session memory is **short-term**: the Lambda reads **raw conversational events** via **`list_events`** and injects the latest few rounds into the next LLM call. There is **no** client-visible wait for “summary extraction.”

Expected behavior:
1. **First** request in a new session (or right after `end_session`):
   - `retrieve_past_context` is often **empty** (nothing stored yet).
   - After the response, **write** adds the first round (unless `end_session=true` on that same request).
2. **Later** requests with the same `actor_id` + `session_id` and `use_memory=true`:
   - `past_context` should include **recent** `User:` / `Assistant:` lines from prior turns (up to **`AGENTCORE_MEMORY_MAX_TURNS`** rounds, default 6).
3. **After the seventh stored round** in the same session (with default `6`):
   - the **oldest** stored round is **removed** automatically; the model only ever sees at most the **last six** completed rounds.
4. **After clear** (`end_session=true`):
   - retrieval is **empty** again until new rounds are written.

Frontend recommendation:
- Keep `actor_id` stable per user.
- Keep `session_id` stable per chat thread.
- Send `end_session=true` when user clicks "End Chat".

---

## 9) External APIs and Network

### 9.1 MCP SQL API
- URL: environment variable `MCP_URL`, default `http://13.232.184.226:9000/run_sql` (port **9000** in current deployment)
- Method: POST
- Request:
```json
{"sql":"SELECT ..."}
```
- Response: arbitrary JSON from MCP (passed through in `data`)

### 9.2 Construction API
- URL:
`https://www.cgmsc.gov.in/himis_apin/api/payment/UnionPendigBill?mainSchemeId=101&officeOrder=1`
- Method: GET
- TLS verification is disabled in current code path (`cert_reqs="CERT_NONE"`).

---

## 10) Environment Variables

### Models / Region
- `AWS_REGION` (default `ap-south-1`)
- `BEDROCK_MODEL_ID` (default Sonnet)
- `BEDROCK_MODEL_ID_CLASSIFIER` (default Haiku)

### MCP
- `MCP_URL` — full URL of the `run_sql` endpoint (default matches §9.1)

### Memory
- `AGENTCORE_MEMORY_MAX_TURNS` (default `6`) — max **conversation rounds** (AgentCore **events**) kept per session; older rounds deleted when exceeded
- `AGENTCORE_MEMORY_TOP_K` (default follows max turns, bounded by max turns) — max **recent events** used when building the context string for the LLM
- `AGENTCORE_MEMORY_TTL_HOURS` (default `2`)
- `AGENTCORE_MEMORY_LIST_EVENTS_MAX_PAGES` (default `40`) — safety cap on `list_events` pagination during retrieve
- `MEMORY_VERBOSE_LOG` (default `true`)

### Cache (disabled in current build)
- `ENABLE_DYNAMO_CACHE` (default `false`) — reserved; **`put_mcp_response` / Dynamo cache writes are not executed** in the current code path regardless of this flag. Responses always include **`cache_id: null`** for `direct_sql` and standard SQL.

### LLM safety caps (`llm_limits.py`)
- `MAX_USER_QUERY_CHARS` (8000)
- `MAX_CLASSIFIER_SYSTEM_CHARS` (100000)
- `MAX_SQL_SYSTEM_CHARS` (130000)
- `MAX_SUMMARY_DATA_JSON_CHARS` (75000)
- `MAX_SUMMARY_MEMORY_CONTEXT_CHARS` (8000)
- `MAX_SUMMARY_SAMPLE_ROWS` (25)
- `MAX_CONSTRUCTION_RECORDS` (200)
- `MAX_CONSTRUCTION_JSON_CHARS` (80000)
- `MAX_GENERAL_USER_CHARS` (4000)
- `TOKEN_THRESHOLD_RESPONSE` (80000) [legacy path]
- `MAX_RESPONSE_USER_MESSAGE_CHARS` (120000) [legacy path]
- `MAX_MEMORY_SEARCH_QUERY_CHARS` (2000)

---

## 11) IAM Permissions Required

### Bedrock Runtime
- `bedrock:InvokeModel`
- `bedrock:CountTokens` (if count token path is used)

### AgentCore Memory
- `bedrock-agentcore:ListEvents` (retrieve short-term context)
- `bedrock-agentcore:CreateEvent` (write each completed round)
- For clear session and prune-after-write cleanup:
  - `bedrock-agentcore:ListEvents`
  - `bedrock-agentcore:DeleteEvent`
  - `bedrock-agentcore:ListMemoryRecords`
  - `bedrock-agentcore:BatchDeleteMemoryRecords`
  - `bedrock-agentcore:DeleteMemoryRecord`

Resource includes memory:
- `arn:aws:bedrock-agentcore:ap-south-1:<account-id>:memory/NLtoSQL_ChatbotMemory-ob7ivQCf44`

---

## 12) Frontend Integration Notes

1. Always send `actor_id` + `session_id`.
2. Use one `session_id` per chat tab/thread.
3. For UX:
   - show `response` as primary output
   - optionally keep raw `sql` and `data` in debug panel
   - treat `cache_id` as optional/null in this build
   - when you send `use_memory=false`, expect **no** session context from AgentCore for that turn (stateless, faster handling)
4. For "End Chat" button:
   - call API with `end_session=true`, same actor/session
5. Handle empty result responses gracefully:
   - standard no-data summary is expected and valid

---

## 13) Request/Response Examples

### A) Standard query
Request:
```json
{
  "query": "Which POs have partial supply below 50 percent?",
  "actor_id": "mem_test_user_01",
  "session_id": "mem_test_session_01"
}
```

Response body (example):
```json
{
  "query": "Which POs have partial supply below 50 percent?",
  "sql": "SELECT ...",
  "data": {"success": true, "result": {"rows": []}},
  "cache_id": null,
  "response": "No data found matching your query criteria....",
  "message": "Data returned with inline AI summary."
}
```

### B) End session
Request:
```json
{
  "end_session": true,
  "actor_id": "mem_test_user_01",
  "session_id": "mem_test_session_01"
}
```

Response body:
```json
{
  "message": "Session memory cleared.",
  "actor_id": "mem_test_user_01",
  "session_id": "mem_test_session_01"
}
```

### C) Direct SQL
Request:
```json
{
  "direct_sql": "SELECT 1 AS test_value FROM dual",
  "actor_id": "mem_test_user_01",
  "session_id": "mem_test_session_01"
}
```

Response body:
```json
{
  "data": {"success": true, "result": {"rows": [[1]]}},
  "sql": "SELECT 1 AS test_value FROM dual",
  "cache_id": null
}
```

### D) General path with session memory (shape)
After at least one prior turn in the same `actor_id` / `session_id`, the model answer may reference earlier user phrasing. The HTTP body shape is still **`type: "general"`** with `sql: null` and `data: []` (see §6.2). The backend does not currently echo `past_context` in the API response; verify behavior via CloudWatch `[MEMORY] RETRIEVE ok` / `merged_context_chars` when needed.

---

## 14) Logging and Troubleshooting Playbook

Log lines use **ASCII** markers (for example `[TABLE CLASSIFICATION] OK` / `ERR`) so local runs on Windows consoles and CloudWatch both stay readable.

Filter CloudWatch by:
- `[MEMORY]`
- `[TIMER]`
- `[TABLE CLASSIFICATION]`
- `[SQL GENERATION]`
- `[SUMMARY]`
- `[CONSTRUCTION]`

### Memory health indicators
- Good:
  - `[MEMORY] WRITE ok`
  - `[MEMORY] RETRIEVE ok` (with `merged_context_chars>0` on follow-up turns when memory is enabled)
  - `[MEMORY] INJECT ... injected_chars>0` (summary path)
  - `[MEMORY] LIMITS enforce` with expected `turn_pruned` / `ttl_pruned` when limits apply
  - `[MEMORY] CLEAR done`
- Potential issue:
  - persistent `RETRIEVE empty` long after successful writes (check IAM `ListEvents`, `memoryId`, region, `actor_id` / `session_id` mismatch)
  - `CLEAR FAILED` with AccessDeniedException

### Common failures
- `Invalid JSON in request body` -> malformed request payload
- `Missing required field: query` -> no query and no end_session-only intent
- Bedrock payload size pressure -> adjust `llm_limits` env vars
- AgentCore permission errors -> update IAM policy

---

## 15) Security and Operational Notes

1. Construction API currently disables SSL verification; harden this if possible.
2. Avoid exposing raw SQL to non-admin users in frontend UI.
3. Consider reducing verbose memory logs in production:
   - set `MEMORY_VERBOSE_LOG=false`
4. Keep model IDs and service endpoints configurable through env vars.
5. Add alerting for 5xx spikes and timeout increases.

---

## 16) Suggested Frontend Changes Checklist

- [ ] Add persistent `actor_id` mapping per authenticated user
- [ ] Add stable `session_id` per chat thread (rotate only when user starts a **new** chat)
- [ ] Add `End Session` action calling `end_session=true`
- [ ] Render `response` first; SQL/data optional behind "Show details"
- [ ] Handle empty/no-data summaries as successful responses
- [ ] Treat `cache_id` as optional/null while cache store is disabled
- [ ] For recall-style user phrases (see §7.3 / changelog), expect **`type: "general"`** and no `sql` — render like normal chat bubbles
- [ ] Set API Gateway / client timeouts high enough for heavy SQL + Bedrock (recommend **≥ 120s** server-side where configurable)
- [ ] Add UI hints when memory was likely used (optional; or request future backend fields like `memory_used` — see §19)
- [ ] Implement “select message for context” UX (WhatsApp-style): when user selects a previous message, visually mark it and send `use_memory=true` for the next turn(s); when nothing is selected, send `use_memory=false` for faster, stateless turns

---

## 17) Quick E2E Test Sequence (for frontend QA)

1. Ask first question with actor/session A
2. Ask second related question same actor/session A
3. Ask a follow-up that depends on the first answer (same `actor_id` / `session_id`, `use_memory=true`)
4. Verify context-aware behavior (and backend logs show `[MEMORY] RETRIEVE ok` with non-empty context when applicable)
5. End session for actor/session A (`end_session=true`)
6. Ask again with same actor/session A
7. Verify prior context is no longer used (or retrieval empty until new writes)

---

## 18) PowerShell integration test (`test_memory_ttl_turns.ps1`)

The repo includes **`test_memory_ttl_turns.ps1`** for end-to-end checks against the **deployed** API Gateway URL.

**What it covers (typical run):**
- `end_session` clear at start (isolated `actor_id` / `session_id` with timestamp suffix by default)
- `direct_sql` smoke (`SELECT 1 … FROM dual`) and asserts `cache_id` is null
- Optional GENERAL + CONSTRUCTION checks (`-SkipRouteChecks:$false` to enable)
- Several stable NL → SQL → MCP → summary turns (no `memory_wait` in current Lambda)
- Delayed “prior context” recall questions (`type: general`)
- Final `end_session` clear
- **`=== TEST SUMMARY (PASS/FAIL) ===`** plus **`OVERALL: PASS|PARTIAL|FAIL`** and a **JSON report** block (gate / write / recall / clear / direct_sql)

**Example:**
```powershell
cd path\to\function
.\test_memory_ttl_turns.ps1 `
  -ApiUrl "https://YOUR_API.execute-api.ap-south-1.amazonaws.com/stage/resource" `
  -WaitBetweenRequestsSeconds 2 `
  -WaitBeforeMemoryCheckSeconds 65 `
  -WaitBeforeDelayedFollowupSeconds 70 `
  -MaxMemoryWaitRetries 3
```

**Parameters (high level):**
- `-UseUniqueSession` (default `$true`) — appends timestamp to actor/session to avoid polluted memory from old QA runs
- `-SkipRouteChecks` (default `$true`) — skips extra GENERAL/CONSTRUCTION calls for faster runs
- `-MaxMemoryWaitRetries` — only relevant if a future build reintroduces `memory_wait`; current Lambda typically needs **zero** retries

**Note:** Script “write” / “retrieve” PASS lines **infer** success from HTTP responses; definitive AgentCore signals remain in CloudWatch (`[MEMORY] WRITE ok`, `[MEMORY] RETRIEVE ok`).

---

## 19) Ownership Notes

This Lambda is designed for non-blocking resiliency:
- Memory failures never block main response path
- SQL/MCP and LLM paths have safe fallbacks
- Response format remains stable for frontend integration

If frontend needs additional metadata (for example `flow_type`, `memory_used`, `retrieved_count`), add explicit response fields in `lambda_handler` return payloads (instead of relying only on logs).

