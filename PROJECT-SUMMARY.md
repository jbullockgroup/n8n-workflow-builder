# n8n Workflow Builder - Master Project Summary

**Project**: AI-Powered n8n Workflow Builder Web Application
**Architecture**: Two-file system (app-mcp.js with MCP, app-original.js without MCP)
**Status**: Production-ready with comprehensive feature set

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture & File Structure](#architecture--file-structure)
3. [Two-File System Design](#two-file-system-design)
4. [Core Features](#core-features)
5. [AI Model Integration](#ai-model-integration)
6. [Development History](#development-history)
7. [Bug Fixes & Solutions](#bug-fixes--solutions)
8. [Security Architecture](#security-architecture)
9. [Voice Input Implementation](#voice-input-implementation)
10. [Deployment Configuration](#deployment-configuration)
11. [Technical Patterns & Best Practices](#technical-patterns--best-practices)
12. [Known Limitations](#known-limitations)
13. [Future Enhancements](#future-enhancements)

---

## Project Overview

The n8n Workflow Builder is an AI-powered web application that helps users design and build n8n automation workflows through conversational interaction. The application guides users through a multi-stage process:

1. **Initial Consultation**: User describes what they want to automate
2. **Clarification Phase**: AI asks 2-3 targeted questions about systems, APIs, and processes
3. **Design Proposal**: AI provides a detailed text-based workflow design
4. **Visual Diagram**: Mermaid flowchart diagram of the proposed workflow
5. **Educational Explanation**: Optional first-person explanation of design decisions
6. **JSON Generation**: Complete n8n workflow JSON for direct import

**Key Value Propositions**:
- Zero prior n8n knowledge required
- Visual diagrams make complex workflows understandable
- Educational explanations teach n8n best practices
- One-click JSON export for immediate deployment

---

## Architecture & File Structure

### Primary Application Files

| File | Purpose | Lines of Code | MCP Features |
|------|---------|---------------|--------------|
| `app-mcp.js` | MCP-enabled version with Model Context Protocol tools | ~2,500+ | Yes (always enabled) |
| `app-original.js` | Clean version without any MCP functionality | ~1,985 | No |

### Configuration & Documentation Files

| File | Purpose |
|------|---------|
| `index.html` | Main HTML with dynamic script loading based on MCP toggle |
| `server.js` | Express server with API proxy endpoints |
| `.env` | Server-side API keys (OpenAI, Anthropic, Deepgram) |
| `DEPLOYMENT.md` | Deployment configuration and model settings |
| `DEEPGRAM-IMPLEMENTATION-PLAN.md` | Voice input architecture |
| `API-SECURITY-PLAN.md` | Security hardening roadmap |
| `n8n-MCP-Claude-Project-Setup.md` | MCP tool usage patterns |
| `rebuild-plan` | Two-file architecture decision document |

### Project Summary Files (Session History)

- `project-summary-1.md` through `project-summary-10.md`: Main development sessions
- `project-summary-10-2.md` through `project-summary-10-9.md`: Bug fix iterations
- `MASTER-PROJECT-SUMMARY.md`: This comprehensive summary

---

## Two-File System Design

### Rationale

The project evolved from a single application with an MCP toggle to two completely separate files due to **logic leakage** between MCP and non-MCP code paths.

**Root Cause**: The MCP toggle feature was broken because MCP-related logic (tool_action parsing, MCP response handling, MCP timeout loops) was executing even when MCP was supposedly disabled.

**Solution**: Complete separation into two files:
- `app-mcp.js` - Always has MCP enabled, contains all MCP-specific code
- `app-original.js` - Zero MCP code, `useMcpTools: false` hardcoded

### Dynamic Loading Mechanism

The `index.html` file dynamically loads the appropriate script based on the MCP toggle state:

```javascript
// In index.html
const mcpToggle = document.getElementById('mcpToggle');
let mcpEnabled = localStorage.getItem('mcpEnabled') === 'true';

function loadAppScript() {
    const scriptId = 'appScript';
    const existingScript = document.getElementById(scriptId);
    if (existingScript) existingScript.remove();

    const script = document.createElement('script');
    script.id = scriptId;
    script.src = mcpEnabled ? 'app-mcp.js' : 'app-original.js';
    document.head.appendChild(script);
}

mcpToggle.addEventListener('change', () => {
    saveStateForToggle();
    mcpEnabled = mcpToggle.checked;
    localStorage.setItem('mcpEnabled', mcpEnabled);
    location.reload(); // Full page reload to switch apps
});
```

### State Preservation Across Toggle

When switching between MCP modes, the application preserves:
- Conversation history
- Current workflow stage
- Clarification/diagram counts
- Chat messages HTML
- Input field contents

---

## Core Features

### 1. Multi-Stage Conversation Flow

```
initial → clarifying → design_proposed → ready_for_diagram → diagram_generated → building → complete
```

**Stage Behaviors**:
- **initial**: First user input, triggers clarifying questions
- **clarifying**: AI asks 2-3 questions about systems/APIs/volumes
- **design_proposed**: Text-based design proposal, "Diagram it" button appears
- **ready_for_diagram**: User clicked diagram button, triggers Mermaid generation
- **diagram_generated**: Mermaid diagram rendered, dual choice buttons shown
- **building**: Claude Sonnet generating JSON workflow
- **complete**: Download button for JSON file

### 2. Mermaid Diagram Generation

**Key Features**:
- Real-time rendering with `mermaid.render()` API (v10+)
- Automatic syntax error detection and retry (up to 3 attempts)
- Click-to-expand modal view
- PNG/SVG download functionality
- Forbidden character enforcement (no parentheses, hyphens, colons, etc.)

**Syntax Rules Enforced**:
```
Node IDs: [A-Za-z0-9]+ only (no spaces, hyphens, special chars)
Node Labels: Plain text only (no ()-:,&" special chars)
Arrows: Use --> only
Edge Labels: |text| format
```

### 3. Educational Explanations

After diagram generation, users can request an explanation of:
1. Why the specific workflow design was chosen
2. Intentional design decisions and their rationale
3. How n8n best practices were applied
4. Specific benefits of the approach

Written in first-person ("I designed this...") for conversational tone.

### 4. Workflow JSON Generation

**Claude Sonnet 4.5 Integration**:
- Generates complete n8n-compatible JSON
- Includes proper UUIDs, timestamps, node types
- Retry logic for malformed JSON (up to 3 attempts)
- Validation before download
- Timestamped filename: `n8n-workflow-YYYY-MM-DD-HHMMSS.json`

### 5. Voice Input (Deepgram Nova-3)

**WebSocket Proxy Pattern**:
```
Browser → WebSocket Proxy (server) → Deepgram API (with auth headers)
```

**Technical Details**:
- Model: Nova-3 with smart formatting
- URL: `wss://api.deepgram.com/v1/listen?model=nova-3&language=en-US&smart_format=true&endpointing=300`
- Chunk size: 250ms via MediaRecorder
- Blob-to-text conversion for ws module compatibility
- Recording indicator: "Listening... Speak now!"

### 6. UI/UX Features

- **Playful loading messages**: 8 rotating messages with typing dots animation
- **Progress indicators**: During JSON generation
- **Auto-scroll**: Chat stays at bottom during interactions
- **Markdown support**: Full GitHub-flavored markdown via marked.js
- **Responsive design**: Works on desktop and mobile
- **Error recovery**: Retry buttons for each failure phase
- **Dual choice buttons**: Side-by-side layout for "Explain" vs "Build" options

---

## AI Model Integration

### GPT-5 Nano (2025-08-07)

**Purpose**: Conversational interactions, clarifications, design proposals

**Endpoint**: `/api/openai-proxy` (server-side)

**Configuration**:
```javascript
const requestBody = {
    systemPrompt: systemPrompt,
    conversationHistory: conversationHistory.slice(-10),
    useMcpTools: mcpEnabled  // true for app-mcp.js, false for app-original.js
};
```

**Response Structure**:
```
{
    output: [
        {
            type: 'message',
            content: [
                {
                    type: 'output_text',
                    text: 'AI response here...'
                }
            ]
        }
    ]
}
```

### Claude Sonnet 4.5

**Purpose**: n8n workflow JSON generation

**Endpoint**: `/api/claude-proxy` (server-side)

**System Prompt Emphasis**:
- Valid JSON only - no explanations or comments
- n8n workflow export format compliance
- Double quotes throughout, proper syntax
- Unique UUIDs, ISO 8601 timestamps
- Canonical n8n node type strings

**Response Structure**:
```
{
    content: [
        {
            type: 'text',
            text: '{ "name": "workflow", "nodes": [...] }'
        }
    ]
}
```

### MCP Tools (app-mcp.js only)

**Enabled for**: Both chat and build phases

**Timeout Configurations**:
- Chat phase: 1500ms (MCP_CHAT_TIMEOUT_MS)
- Build phase: 3000ms (MCP_BUILD_TIMEOUT_MS)

**Max Calls**:
- Chat: 2 calls (MCP_MAX_CALLS_CHAT)
- Build: 2 calls (MCP_MAX_CALLS_BUILD)

**Tool Actions**: Parsed and executed from MCP response structure

---

## Development History

### Session 1: Initial Implementation
- Basic conversation flow
- GPT-4 integration for chat
- Simple workflow diagram generation

### Session 2: Mermaid Integration
- Added mermaid.js for visual diagrams
- Basic rendering with `mermaid.init()`

### Session 3: Multi-Stage Flow
- Implemented initial → clarifying → design stages
- Added clarification counting
- Stage-based system prompts

### Session 4: Diagram Improvements
- Enhanced Mermaid syntax instructions
- Better error handling

### Session 5: JSON Generation
- Claude API integration for workflow JSON
- Download functionality
- Basic validation

### Session 6: Voice Input
- Deepgram Nova-3 WebSocket integration
- Recording state management
- UI indicators

### Session 7: MCP Integration
- Added Model Context Protocol support
- Tool action parsing
- MCP timeout logic

### Session 8: MCP Toggle Issues
- Discovered logic leakage between MCP modes
- Attempted fixes with conditional logic

### Session 9: Architecture Decision
- Decision to split into two files
- Rebuild plan documented

### Session 10: Critical Bug Fixes (see below)

---

## Bug Fixes & Solutions

### Bug Fix 10-7: Mermaid Rendering Failures

**Problem**: Multiple Mermaid-related errors
- `API_KEY is not defined` error
- "Container not in DOM yet" error
- Wrong API usage (`mermaid.init()` instead of `mermaid.render()`)

**Solutions**:
1. Fixed API_KEY error by using `await getApiKey('openai')` in all API calls
2. Fixed DOM error by appending container to DOM BEFORE rendering
3. Updated to `mermaid.render()` API for v10+ compatibility

```javascript
// Before (broken)
containerDiv.innerHTML = svg;
mermaid.init(undefined, containerDiv);

// After (fixed)
const { svg, bindFunctions } = await mermaid.render(diagramId, content);
containerDiv.innerHTML = svg;
if (bindFunctions) bindFunctions(containerDiv);
```

### Bug Fix 10-8: UI Refinements

**Changes**:
- Removed "Should I create the visual diagram?" prompt text
- Repositioned buttons to right side using `justify-content: flex-end`
- Corrected model name to "Claude Sonnet 4.5"
- Implemented consistent "AI Assistant" label policy
- Removed Mermaid diagram hover animation (was causing visual glitches)

### Bug Fix 10-9: Critical Response Handling

**Problem 1**: `ReferenceError: API_KEY is not defined` in `addEducationalExplanation()`
- **Solution**: Removed direct API_KEY usage, proxy now handles keys server-side

**Problem 2**: "Empty response from Claude API"
- **Root Cause**: Wrong response parsing - looking for `'text'` instead of `'output_text'`
- **Solution**: Updated parsing logic:

```javascript
// Before (wrong)
const textContent = messageOutput.content.find(content => content.type === 'text');

// After (correct)
const textContent = messageOutput.content.find(content => content.type === 'output_text');
```

**Problem 3**: Mermaid download buttons not working
- **Root Cause**: SVG selector `.mermaid svg` was incorrect
- **Solution**: Changed to simple `svg` selector

```javascript
// Before (broken)
const diagramElement = modalBody.querySelector('.mermaid svg');

// After (fixed)
const diagramElement = modalBody.querySelector('svg');
```

**Problem 4**: No progress indicator during JSON generation
- **Solution**: Added inline thinking message during `handleBuildItClick()`

---

## Security Architecture

### Evolution: Client-Side → Server-Side

**Phase 1 (Original)**: API keys in browser `.env` endpoint
- **Problem**: Keys exposed in browser, security risk
- **Endpoint**: `GET /.env` returned all keys as JSON

**Phase 2 (Current)**: Server-side proxy with hardened endpoints
- **Proxy Endpoints**:
  - `/api/openai-proxy` - OpenAI/GPT requests
  - `/api/claude-proxy` - Anthropic/Claude requests
  - `/api/deepgram/ws` - Deepgram WebSocket proxy

**Security Measures**:
1. **Blocked `/.env`**: Returns 403 Forbidden
2. **Server-side keys**: All API keys stored in server `.env` only
3. **No browser exposure**: `getApiKey()` calls removed from frontend
4. **Clean request bodies**: No `openaiApiKey` or `anthropicApiKey` in requests

### Proxy Request Pattern

```javascript
// Frontend (no keys)
const response = await fetch('/api/openai-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        systemPrompt: systemPrompt,
        conversationHistory: history,
        useMcpTools: false
    })
});

// Server (holds keys)
const openaiKey = process.env.OPENAI_API_KEY;
const anthropicKey = process.env.ANTHROPIC_API_KEY;
const deepgramKey = process.env.DEEPGRAM_API_KEY;
```

---

## Voice Input Implementation

### Deepgram Nova-3 Configuration

**WebSocket URL**:
```
wss://api.deepgram.com/v1/listen?model=nova-3&language=en-US&smart_format=true&endpointing=300
```

**Proxy Pattern Required**:
Browser cannot set WebSocket headers, so a server-side proxy is required:

```javascript
// Server-side (server.js)
const Deepgram = require('@deepgram/sdk');
const deepgram = new Deepgram(process.env.DEEPGRAM_API_KEY);

wsServer.on('connection', (ws) => {
    const deepgramWs = deepgram.transcription.live({
        model: 'nova-3',
        language: 'en-US',
        smart_format: true,
        endpointing: 300
    });

    // Bridge browser ↔ Deepgram
    ws.on('message', (data) => deepgramWs.send(data));
    deepgramWs.on('results', (data) => ws.send(JSON.stringify(data)));
});
```

**Client-Side Recording**:
```javascript
mediaRecorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm' });
mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0 && deepgramConnection?.readyState === WebSocket.OPEN) {
        deepgramConnection.send(event.data);
    }
};
mediaRecorder.start(250); // 250ms chunks
```

**Blob Conversion**:
```javascript
// Handle Blob data from ws module compatibility
let textData;
if (event.data instanceof Blob) {
    textData = await event.data.text();
} else {
    textData = event.data;
}
const data = JSON.parse(textData);
```

### API Key Requirements

Deepgram API key must have **Member role** (not Default) for WebSocket access.

---

## Deployment Configuration

### Server Setup

**Port**: 8099 (local proxy server)

**Required Environment Variables**:
```bash
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
DEEPGRAM_API_KEY=...
```

**Endpoints**:
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/openai-proxy` | POST | GPT-5 Nano chat requests |
| `/api/claude-proxy` | POST | Claude Sonnet JSON generation |
| `/api/deepgram/ws` | WebSocket | Deepgram voice transcription |
| `/.env` | GET | **BLOCKED** (403 Forbidden) |

### Client Configuration

**Script Loading** (index.html):
```html
<!-- Dynamically loads app-mcp.js or app-original.js -->
<script src="" id="appScript"></script>
```

**Libraries**:
- marked.js - Markdown parsing
- mermaid.js v10+ - Diagram rendering
- domtoimage - PNG export

---

## Technical Patterns & Best Practices

### 1. Async DOM Rendering Pattern

**Problem**: Mermaid requires element to be in DOM before rendering

**Solution**: Append first, render asynchronously

```javascript
// 1. Create and append container with loading state
containerDiv.innerHTML = '<div class="diagram-loading">...</div>';
chatMessages.appendChild(messageDiv);

// 2. Auto-scroll
setTimeout(() => { chatMessages.scrollTop = chatMessages.scrollHeight; }, 100);

// 3. Render diagram asynchronously
renderMermaidDiagram(content, containerDiv).then((result) => {
    if (result.success) {
        // Make clickable on success
        containerDiv.addEventListener('click', () => openDiagramModal(content));
    }
});
```

### 2. Retry Pattern with User Feedback

```javascript
async function generateWorkflowJSON(workflowDesign, retryCount = 0) {
    const MAX_RETRIES = 3;

    try {
        const jsonWorkflow = await callClaudeAPI();
        const validation = validateWorkflowJSON(jsonWorkflow);

        if (validation.valid) {
            return validation.json;
        } else if (retryCount < MAX_RETRIES) {
            // Show retry message to user
            addMessage('assistant', `⚠️ Fixing JSON structure... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            return generateWorkflowJSON(workflowDesign, retryCount + 1);
        }
        return null;
    } catch (error) {
        if (retryCount < MAX_RETRIES) {
            addMessage('assistant', `⚠️ Connection issue, retrying... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            return generateWorkflowJSON(workflowDesign, retryCount + 1);
        }
        throw error;
    }
}
```

### 3. Phase-Specific Retry Buttons

```javascript
function addRetryButton(phase) {
    const buttonConfigs = {
        'clarification': { text: 'Try Again', handler: retryClarification },
        'design_proposal': { text: 'Try Again', handler: retryDesignProposal },
        'diagram': { text: 'Diagram it! 📊', handler: handleDiagramItClick },
        'explanation': { text: 'Explain the design 💡', handler: addEducationalExplanation },
        'build': { text: "Let's Build It! 🚀", handler: handleBuildItClick },
        'download': { text: 'Download Workflow JSON', handler: downloadWorkflowJSON }
    };

    const config = buttonConfigs[phase];
    // Create and attach button with proper styling
}
```

### 4. State Preservation Pattern

```javascript
function saveStateForToggle() {
    const state = {
        conversationHistory,
        currentStage,
        clarificationCount,
        diagramCount,
        chatHTML: document.getElementById('chatMessages')?.innerHTML || '',
        timestamp: Date.now()
    };
    localStorage.setItem('mcpToggleState', JSON.stringify(state));
}

function restoreStateFromToggle() {
    const saved = localStorage.getItem('mcpToggleState');
    if (!saved) return false;

    const state = JSON.parse(saved);
    // Only restore if recent (within 5 seconds)
    if (Date.now() - state.timestamp > 5000) {
        localStorage.removeItem('mcpToggleState');
        return false;
    }

    // Restore state...
    localStorage.removeItem('mcpToggleState');
    return true;
}
```

---

**Document Version**: 1.0
**Last Updated**: January 2026
**Project Status**: Production-ready
