# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with the n8n Workflow Builder application.

---

## Project Overview

**n8n Workflow Builder** is an AI-powered web application that helps users design and build n8n automation workflows through conversational interaction. The application generates visual Mermaid diagrams and downloadable n8n JSON workflows.

**Key Technologies**: Vanilla JavaScript, Node.js/Express, Mermaid.js, Deepgram Nova-3, GPT-5 Nano, Claude Sonnet 4.5

---

## Architecture: Two-File System

The project uses **two separate application files** to isolate MCP functionality:

| File | Purpose | When Used |
|------|---------|-----------|
| `app-mcp.js` | MCP-enabled version with Model Context Protocol tools | MCP toggle ON |
| `app-original.js` | Clean version without any MCP functionality | MCP toggle OFF |

**Critical**: The MCP toggle in `index.html` dynamically loads the appropriate script and triggers a page reload. Do NOT try to add conditional MCP logic within a single file - this was the root cause of the "MCP toggle broken" bug.

### Dynamic Loading Pattern (index.html)

```javascript
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
    saveStateForToggle();  // Preserve conversation state
    mcpEnabled = mcpToggle.checked;
    localStorage.setItem('mcpEnabled', mcpEnabled);
    location.reload();    // Full reload required
});
```

---

## Conversation Flow Stages

The application follows a **7-stage conversation flow**:

```
initial → clarifying → design_proposed → ready_for_diagram → diagram_generated → building → complete
```

| Stage | Trigger | User Action |
|-------|---------|-------------|
| `initial` | First user input | User describes automation goal |
| `clarifying` | After initial response | AI asks 2-3 questions about systems/APIs |
| `design_proposed` | After 2nd clarification | AI provides text design proposal |
| `ready_for_diagram` | User clicks "Diagram it" | Triggers Mermaid generation |
| `diagram_generated` | Diagram renders | User chooses: Explain or Build |
| `building` | User clicks "Build It" | Claude generates JSON |
| `complete` | JSON validation passes | Download button appears |

**Stage Management**: The `currentStage` variable controls which system prompt is used. Be careful when modifying stage transitions.

---

## Critical Technical Patterns

### 1. Async DOM Rendering for Mermaid

**Problem**: Mermaid v10+ requires elements to be in the DOM before rendering.

**Solution**: Append to DOM first, render asynchronously.

```javascript
// CORRECT Pattern (from app-original.js lines 197-215)
const containerDiv = document.createElement('div');
containerDiv.innerHTML = '<div class="diagram-loading">...</div>';
chatMessages.appendChild(messageDiv);  // Append FIRST

// Auto-scroll
setTimeout(() => { chatMessages.scrollTop = chatMessages.scrollHeight; }, 100);

// Render asynchronously
renderMermaidDiagram(content, containerDiv).then((result) => {
    if (result.success) {
        containerDiv.addEventListener('click', () => openDiagramModal(content));
    }
});
```

**Do NOT use** `mermaid.init()` - use `mermaid.render()`:

```javascript
// CORRECT (v10+ API)
const { svg, bindFunctions } = await mermaid.render(diagramId, content);
containerDiv.innerHTML = svg;
if (bindFunctions) bindFunctions(containerDiv);
```

### 2. API Response Parsing

**GPT-5 Nano Response Structure**:
```javascript
// Response from /api/openai-proxy
{
    output: [
        {
            type: 'message',
            content: [
                {
                    type: 'output_text',  // NOT 'text'!
                    text: 'AI response here...'
                }
            ]
        }
    ]
}

// Extract text correctly:
const messageOutput = data.output.find(item => item.type === 'message');
if (messageOutput && messageOutput.content) {
    const textContent = messageOutput.content.find(c => c.type === 'output_text');
    assistantResponse = textContent ? textContent.text : '';
}
```

**Claude Sonnet 4.5 Response Structure**:
```javascript
// Response from /api/claude-proxy
{
    content: [
        {
            type: 'text',
            text: '{ "name": "workflow", ... }'
        }
    ]
}

// Extract text correctly:
const textBlock = data.content.find(block => block.type === 'text');
jsonContent = textBlock ? textBlock.text : '';
```

### 3. Retry Pattern with User Feedback

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
            addMessage('assistant', `⚠️ Connection issue, retrying...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            return generateWorkflowJSON(workflowDesign, retryCount + 1);
        }
        throw error;
    }
}
```

---

## Known Bugs and Solutions

### Bug #1: "Container not in DOM yet" (Mermaid)

**Symptom**: `SyntaxError, line 0: Cannot read mermaid element from DOM`

**Solution**: Always append Mermaid container to DOM BEFORE calling `mermaid.render()`. See "Async DOM Rendering" pattern above.

### Bug #2: "Empty response from Claude API"

**Symptom**: Response parsing returns empty string

**Root Cause**: Using wrong content type key (`'text'` instead of `'output_text'`)

**Solution**: Update parsing to use `'output_text'` key for GPT-5 Nano responses

### Bug #3: Mermaid Download Buttons Not Working

**Symptom**: PNG/SVG download buttons do nothing

**Root Cause**: SVG selector was `.mermaid svg` (too specific)

**Solution**: Use simple `svg` selector:
```javascript
const svgElement = modalBody.querySelector('svg');  // NOT .mermaid svg
```

### Bug #4: MCP Toggle Logic Leakage

**Symptom**: MCP tools executing when toggle is OFF

**Root Cause**: MCP logic wasn't fully isolated, code paths leaked between modes

**Solution**: Complete separation into two files (app-mcp.js vs app-original.js). Do NOT reunite them.

---

## Security Architecture

### Server-Side API Key Management

**Current State (Phase 2)**: All API keys are server-side only.

**Proxy Endpoints**:
```
/api/openai-proxy   → GPT-5 Nano requests
/api/claude-proxy   → Claude Sonnet requests
/api/deepgram/ws    → Deepgram WebSocket proxy
```

**Blocked Endpoint**:
```
/.env  → Returns 403 Forbidden (security measure)
```

**Critical Rules**:
1. Never call `getApiKey()` from frontend - keys are server-side only
2. Never include `openaiApiKey` or `anthropicApiKey` in request bodies
3. Use proxy endpoints for all AI API calls

### Deepgram WebSocket Proxy Pattern

Browser WebSocket cannot set headers, so a server-side proxy is required:

```javascript
// Client connects to proxy
const wsUrl = `${wsProtocol}//${window.location.host}/api/deepgram/ws`;
deepgramConnection = new WebSocket(wsUrl);

// Server adds auth headers and bridges to Deepgram
// See server.js for implementation
```

---

## Mermaid Syntax Rules (Critical)

The AI system prompt enforces strict Mermaid syntax. When updating system prompts, maintain these rules:

**FORBIDDEN in Labels** (causes parse errors):
- Parentheses: `(retry)` ❌
- Hyphens: `HTTP-Request` ❌
- Colons: `5s:10s` ❌
- Commas: `item1, item2` ❌
- Ampersands: `save & notify` ❌
- Quotes: `"text"` ❌

**CORRECT Examples**:
- `A[Fetch Orders]` ✅
- `B[HTTP Request with Retry]` ✅
- `C{Has New Data}` ✅
- `D[Send Slack Message]` ✅

**WRONG Examples**:
- `A[HTTP Request - List Orders]` ❌ (hyphen)
- `B[Retry (3x)]` ❌ (parentheses)
- `C[Wait 5s, then continue]` ❌ (comma)
- `D[Save & Notify]` ❌ (ampersand)

---

## File Modification Guidelines

### When Modifying System Prompts

System prompts are stage-dependent (`getSystemPrompt()` function). When updating:

1. **Maintain stage structure** - Each stage has specific instructions
2. **Preserve Mermaid syntax rules** in diagram stages
3. **Keep JSON constraints** in build stages
4. **Don't mention JSON generation** before diagram stage

### When Adding UI Features

1. Follow existing button styling: `.build-it-btn`, `.dual-button-row`
2. Use gradient styles: `linear-gradient(135deg, ...)`
3. Add auto-scroll after DOM changes: `chatMessages.scrollTop = chatMessages.scrollHeight`
4. Preserve state during MCP toggle if needed

### When Modifying MCP Features

1. Changes go in `app-mcp.js` only
2. Keep `app-original.js` free of any MCP code
3. Maintain timeout constants: `MCP_CHAT_TIMEOUT_MS`, `MCP_BUILD_TIMEOUT_MS`
4. Respect max call limits: `MCP_MAX_CALLS_CHAT`, `MCP_MAX_CALLS_BUILD`

---

## Development Workflow

### Running the Application

```bash
# Start the proxy server (port 8099)
node server.js

# Open in browser
open http://localhost:8099
```

### Environment Variables Required

```bash
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
DEEPGRAM_API_KEY=...
```

### Testing MCP Toggle

1. Click MCP toggle switch
2. Verify page reload occurs
3. Check browser console for correct script loaded (`app-mcp.js` or `app-original.js`)
4. Verify conversation state is preserved

---

## External Dependencies

| Library | Version | Purpose |
|---------|---------|---------|
| marked.js | Latest | Markdown parsing |
| mermaid.js | v10+ | Diagram rendering |
| domtoimage | Latest | PNG export |
| Express | Latest | Proxy server |
| @deepgram/sdk | Latest | Voice transcription |
| openai | Latest | GPT-5 Nano API |
| anthropic | Latest | Claude Sonnet API |

---

## Session History Reference

For detailed development history, see:
- `project-summary-1.md` through `project-summary-10.md`
- `project-summary-10-2.md` through `project-summary-10-9.md` (bug fix sessions)
- `MASTER-PROJECT-SUMMARY.md` (comprehensive overview)

---

## Common Tasks Reference

### Adding a New Conversation Stage

1. Add stage name to `currentStage` variable options
2. Add `else if` block in `getSystemPrompt()` for the new stage
3. Add transition logic in `processUserInput()` if needed
4. Update stage progression logic

### Modifying Mermaid Styling

Edit `mermaid.initialize()` at top of file:
```javascript
mermaid.initialize({
    startOnLoad: true,
    theme: 'default',
    themeVariables: {
        primaryColor: '#2563eb',
        primaryTextColor: '#fff',
        // ... etc
    }
});
```

### Adding a New Loading Message

Add to `loadingMessages` array:
```javascript
const loadingMessages = [
    "The AI workflow builder is thinking... 🤔",
    // ... add your message here
];
```
