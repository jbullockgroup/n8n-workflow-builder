# Secure API Keys - Remove Browser Exposure

## Problem Statement

Currently, **all API keys are visible in the browser** through two mechanisms:

1. **`/.env` endpoint** (proxy-server.js:462-476): Directly serves the `.env` file to any browser request
2. **Frontend passes keys to proxy**: `config.js` fetches keys from `/.env`, stores in `window.ENV`, then frontend sends keys in request bodies to proxy endpoints

This defeats the purpose of having a proxy server. The Deepgram implementation already follows the correct pattern (server-side key usage with temporary tokens).

## Current Architecture (INSECURE)

```
┌─────────────────────────────────────────┐
│  Browser                                │
│  1. config.js fetches /.env             │
│  2. Keys stored in window.ENV           │
│  3. Keys sent in POST body to proxy     │
└─────────────────┬───────────────────────┘
                  │ POST {openaiApiKey: "sk-...", anthropicApiKey: "sk-..."}
                  ▼
┌─────────────────────────────────────────┐
│  proxy-server.js                        │
│  - Receives keys from browser           │
│  - Forwards to OpenAI/Anthropic APIs    │
│  - Also serves /.env file directly!     │
└─────────────────────────────────────────┘
```

## Target Architecture (SECURE)

```
┌─────────────────────────────────────────┐
│  Browser                                │
│  - NO access to API keys                │
│  - Sends requests without keys          │
└─────────────────┬───────────────────────┘
                  │ POST {systemPrompt: "...", conversationHistory: [...]}
                  ▼
┌─────────────────────────────────────────┐
│  proxy-server.js                        │
│  - Reads keys from .env (server-side)   │
│  - /.env endpoint BLOCKED               │
│  - Attaches keys to outgoing API calls  │
└─────────────────────────────────────────┘
```

## Implementation Steps

### Step 1: Block /.env Endpoint

**File**: `workflow-planner/proxy-server.js`
**Location**: Lines 462-476

**Change**: Replace the endpoint that serves `.env` file with a 403 Forbidden response

```javascript
// BEFORE (INSECURE)
if (req.url === '/.env' && req.method === 'GET') {
    const envPath = path.join(__dirname, '..', '.env');
    fs.readFile(envPath, (err, data) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(data);  // Exposes ALL keys!
    });
    return;
}

// AFTER (SECURE)
if (req.url === '/.env' || req.url.includes('.env')) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
}
```

### Step 2: Modify OpenAI Proxy to Use Server-Side Keys

**File**: `workflow-planner/proxy-server.js`
**Location**: `/api/openai-proxy` handler (~lines 669-850)

**Changes**:
1. Remove `openaiApiKey` from request body destructuring
2. Read key from `env.OPENAI_API_KEY` (already loaded at server start)
3. Update validation to check server-side key exists

```javascript
// BEFORE
const { systemPrompt, conversationHistory, openaiApiKey, stage } = JSON.parse(body);
if (!systemPrompt || !conversationHistory || !openaiApiKey) { ... }

// AFTER
const { systemPrompt, conversationHistory, stage } = JSON.parse(body);
const openaiApiKey = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
if (!openaiApiKey) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'OPENAI_API_KEY not configured on server' }));
    return;
}
if (!systemPrompt || !conversationHistory) { ... }
```

### Step 3: Modify Claude Proxy to Use Server-Side Keys

**File**: `workflow-planner/proxy-server.js`
**Location**: `/api/claude-proxy` handler (~lines 566-667)

**Changes**:
1. Remove `anthropicApiKey` from request body destructuring
2. Read key from `env.ANTHROPIC_API_KEY`
3. Update validation

```javascript
// BEFORE
const { system, userPrompt, anthropicApiKey } = requestData;
if (!system || !userPrompt || !anthropicApiKey) { ... }

// AFTER
const { system, userPrompt } = requestData;
const anthropicApiKey = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
if (!anthropicApiKey) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured on server' }));
    return;
}
if (!system || !userPrompt) { ... }
```

### Step 4: Update Frontend - Remove API Key Handling

**Files**: 
- `workflow-planner/app-original.js`
- `workflow-planner/app-mcp.js`

**Changes**: Remove `getApiKey()` calls and `openaiApiKey`/`anthropicApiKey` from request bodies

#### 4a. app-original.js - processUserInput() (~line 540-546)

```javascript
// BEFORE
const apiKey = await getApiKey('openai');
const requestBody = {
    systemPrompt: systemPrompt,
    conversationHistory: conversationHistory.slice(-10),
    openaiApiKey: apiKey
};

// AFTER
const requestBody = {
    systemPrompt: systemPrompt,
    conversationHistory: conversationHistory.slice(-10),
    stage: currentStage
};
```

#### 4b. app-original.js - requestDiagramFix() (~lines 339-346)

Remove `openaiApiKey` from request body.

#### 4c. app-original.js - addEducationalExplanation() (~lines 845-851)

Remove `openaiApiKey` from request body.

#### 4d. app-original.js - handleBuildItClick() (~lines 1058-1064)

Remove `anthropicApiKey` from Claude proxy request body.

#### 4e. app-mcp.js - Same changes as above

Apply identical changes to the MCP version at corresponding line numbers.

### Step 5: Simplify/Remove config.js

**File**: `workflow-planner/config.js`

**Change**: Remove API key loading entirely. The file can be simplified or removed if no other config is needed.

```javascript
// BEFORE: 87 lines loading .env, parsing keys, exposing to window.ENV
// AFTER: Remove or simplify to non-sensitive config only
```

**Alternative**: Keep config.js but remove sensitive key handling:

```javascript
class Config {
    constructor() {
        // No longer loads .env - keys are server-side only
    }
    
    // Remove getApiKey() method entirely
    // Remove validateApiKeys() method entirely
}
```

### Step 6: Remove getApiKey Helper Function

**Files**: `app-original.js` and `app-mcp.js`
**Location**: Lines 4-10 in both files

**Change**: Remove the helper function since it's no longer needed

```javascript
// REMOVE THIS ENTIRE FUNCTION
async function getApiKey(service) {
    if (window.AppConfig) {
        return await window.AppConfig.getApiKey(service);
    }
    throw new Error('Config not loaded. Please refresh the page.');
}
```

### Step 7: Update index.html

**File**: `workflow-planner/index.html`

**Change**: Remove config.js script tag if the file is removed, or keep it if simplified

```html
<!-- BEFORE -->
<script src="config.js"></script>
<script src="app-original.js"></script>

<!-- AFTER (if config.js removed) -->
<script src="app-original.js"></script>
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `proxy-server.js` | Block /.env, use server-side keys for OpenAI/Claude |
| `app-original.js` | Remove API key handling from 4 functions |
| `app-mcp.js` | Remove API key handling from 4 functions |
| `config.js` | Remove or simplify (no sensitive data) |
| `index.html` | Possibly remove config.js script tag |

---

## Verification Steps

1. **Server starts**: Proxy reads keys from .env successfully
2. **/.env blocked**: Browser request to `http://localhost:8099/.env` returns 403 Forbidden
3. **Browser DevTools**: Network tab shows NO API keys in request/response payloads
4. **OpenAI calls work**: Chat conversations function normally
5. **Claude calls work**: "Build It" generates workflow JSON
6. **Deepgram calls work**: Voice input continues to function (already secure)
7. **Error handling**: Missing server-side keys return clear error messages

---

## Risk Assessment

**Risk Level**: LOW

- Changes are straightforward (remove from one place, read from another)
- Deepgram already uses this pattern successfully
- No breaking changes to user-facing functionality
- Easy to verify with browser DevTools

---

## Rollback Plan

If issues arise:

1. Restore /.env endpoint in proxy-server.js
2. Restore getApiKey() calls in app-original.js and app-mcp.js
3. Restore config.js to original state

All changes can be reverted via git: `git checkout HEAD~1 -- workflow-planner/`
