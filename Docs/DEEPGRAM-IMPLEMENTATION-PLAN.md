# Deepgram Voice Input Implementation Plan
**Based on Real-World Implementation Experience**  
**Last Updated**: January 13, 2026

---

## Executive Summary

This document provides a battle-tested implementation plan for integrating Deepgram Nova-3 voice transcription into a web application. The solution uses a **WebSocket proxy pattern** to work around browser security limitations that prevent direct WebSocket authentication.

**Key Insight**: Browsers cannot set custom headers on WebSocket connections. Direct browser-to-Deepgram connections will fail with error 1006. A server-side proxy is **required**.

---

## Prerequisites

### Deepgram Account Setup
1. Create account at https://console.deepgram.com
2. Create API key with **Member** role (not Default)
   - Default role lacks `usage::write` scope for token generation
   - Member role includes `asr:write` scope for transcription
3. Note: API key format is 40 characters (e.g., `a9b9d1873627703971a38a9f3712b61fb161ab72`)

### Required Dependencies
```bash
npm install ws  # For WebSocket proxy server
```

### Browser Requirements
- WebSocket support (all modern browsers)
- MediaRecorder API (Chrome, Firefox, Edge, Safari 14.1+)
- `getUserMedia` for microphone access

---

## Architecture Overview

### Why Not Direct Browser Connection?

**Original Plan (WRONG)**:
```javascript
// ❌ This will ALWAYS fail with error 1006
const token = await fetchToken();
const ws = new WebSocket(url, ['bearer', token]);  // Browsers can't set custom headers!
```

**Actual Solution (CORRECT)**:
```
Browser ←→ WebSocket Proxy (Node.js) ←→ Deepgram API
```

### Data Flow
```
1. Browser: getUserMedia() → capture audio
2. Browser: Connect to ws://localhost:8099/api/deepgram/ws
3. Server: Connect to Deepgram with Authorization header
4. Server: Forward audio chunks bidirectionally
5. Server: Forward transcription results back to browser
6. Browser: Convert Blob to text, update input field
```

---

## Implementation Steps

### Step 1: Environment Configuration

**File**: `.env` (project root)

```bash
# Deepgram API Key (Member role required)
DEEPGRAM_API_KEY=your_40_character_api_key_here
```

**Verification**:
```bash
curl -X POST https://api.deepgram.com/v1/auth/grant \
  -H "Authorization: Token YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"ttl_seconds": 60}'
  
# Should return: {"access_token":"eyJ...", "expires_in":60}
```

---

### Step 2: Install WebSocket Package

```bash
cd workflow-planner
npm install ws
```

**Verify**: Check `package.json` includes `"ws": "^X.X.X"` in dependencies

---

### Step 3: Add WebSocket Proxy to Server

**File**: `workflow-planner/proxy-server.js`

#### 3a. Import WebSocket module (top of file)
```javascript
const WebSocket = require('ws');
```

#### 3b. Create WebSocket Server (before `server.listen()`)
```javascript
// ============================================================================
// WebSocket Server for Deepgram Proxy
// ============================================================================

const wss = new WebSocket.Server({ noServer: true });

// Handle WebSocket upgrade requests
server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    
    if (pathname === '/api/deepgram/ws') {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});

// Handle WebSocket connections
wss.on('connection', (clientWs, request) => {
    console.log('🎤 Browser WebSocket connected for Deepgram proxy');
    
    const deepgramApiKey = env.DEEPGRAM_API_KEY || process.env.DEEPGRAM_API_KEY;
    
    if (!deepgramApiKey) {
        console.error('❌ DEEPGRAM_API_KEY not configured');
        clientWs.close(1008, 'DEEPGRAM_API_KEY not configured');
        return;
    }
    
    // Build Deepgram WebSocket URL
    // CRITICAL: Do NOT use utterance_end_ms with interim_results=false - they conflict!
    const deepgramUrl = 'wss://api.deepgram.com/v1/listen?model=nova-3&language=en-US&smart_format=true&endpointing=300';
    
    console.log('🔗 Connecting to Deepgram:', deepgramUrl);
    console.log('🔑 API Key (first 8 chars):', deepgramApiKey.substring(0, 8) + '...');
    
    // Connect to Deepgram with proper Authorization header
    const deepgramWs = new WebSocket(deepgramUrl, {
        headers: {
            'Authorization': `Token ${deepgramApiKey}`
        }
    });
    
    deepgramWs.on('open', () => {
        console.log('✅ Connected to Deepgram API');
        // Notify client that connection is ready
        clientWs.send(JSON.stringify({ type: 'ready' }));
    });
    
    deepgramWs.on('message', (data) => {
        // Forward Deepgram transcription results to browser
        const dataStr = data.toString();
        console.log('📝 Deepgram message:', dataStr.substring(0, 200));
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(data);
        }
    });
    
    deepgramWs.on('error', (error) => {
        console.error('❌ Deepgram WebSocket error:', error.message);
        console.error('❌ Full error:', error);
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: 'error', message: error.message }));
        }
    });
    
    // Handle unexpected HTTP responses (like 400, 401, etc.)
    deepgramWs.on('unexpected-response', (req, res) => {
        console.error('❌ Deepgram unexpected response:', res.statusCode, res.statusMessage);
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
            console.error('❌ Response body:', body);
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ 
                    type: 'error', 
                    message: `Deepgram error ${res.statusCode}: ${body || res.statusMessage}` 
                }));
                clientWs.close();
            }
        });
    });
    
    deepgramWs.on('close', (code, reason) => {
        console.log(`🔌 Deepgram connection closed: ${code} ${reason}`);
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.close(code, reason);
        }
    });
    
    // Forward audio data from browser to Deepgram
    clientWs.on('message', (data) => {
        if (deepgramWs.readyState === WebSocket.OPEN) {
            deepgramWs.send(data);
        }
    });
    
    clientWs.on('close', () => {
        console.log('🔌 Browser WebSocket disconnected');
        if (deepgramWs.readyState === WebSocket.OPEN) {
            deepgramWs.close();
        }
    });
    
    clientWs.on('error', (error) => {
        console.error('❌ Browser WebSocket error:', error.message);
    });
});
```

#### 3c. Update server.listen() logs
```javascript
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📡 Claude proxy available at: http://localhost:${PORT}/api/claude-proxy`);
    console.log(`📊 Database API available at: http://localhost:${PORT}/api/db/*`);
    console.log(`🎤 Deepgram WebSocket proxy at: ws://localhost:${PORT}/api/deepgram/ws`);
});
```

---

### Step 4: Update Frontend (app-original.js)

**File**: `workflow-planner/app-original.js`

#### 4a. Update state variables (after existing voice variables)
```javascript
// Voice input state (Deepgram Nova-3)
let isRecording = false;
let deepgramConnection = null;
let mediaRecorder = null;
let audioStream = null;
let finalTranscript = '';
let initialInputContent = '';
```

#### 4b. Replace handleVoiceInput() function
```javascript
// Handle voice input with Deepgram Nova-3
async function handleVoiceInput(inputElement, submitHandler) {
    const isMainScreen = inputElement === userInput;
    const voiceButton = isMainScreen ? voiceBtn : chatVoiceBtn;

    // STOP RECORDING
    if (isRecording) {
        stopRecording(voiceButton, inputElement);
        return;
    }

    // START RECORDING
    try {
        // Get microphone access first
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });

        // Store initial input content
        initialInputContent = inputElement.value;
        finalTranscript = '';

        // Connect to our WebSocket proxy (server handles Deepgram auth with proper headers)
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${window.location.host}/api/deepgram/ws`;

        console.log('Connecting to Deepgram via WebSocket proxy:', wsUrl);

        deepgramConnection = new WebSocket(wsUrl);

        deepgramConnection.onopen = () => {
            console.log('WebSocket proxy connected, waiting for Deepgram ready signal...');
        };

        deepgramConnection.onmessage = async (event) => {
            try {
                // Handle Blob data (from ws module via proxy) by converting to text
                let textData;
                if (event.data instanceof Blob) {
                    textData = await event.data.text();
                } else {
                    textData = event.data;
                }
                
                const data = JSON.parse(textData);
                
                // Handle ready signal from proxy
                if (data.type === 'ready') {
                    console.log('Deepgram connection ready via proxy');
                    setRecordingState(true, voiceButton, inputElement);

                    // Create MediaRecorder to capture audio
                    mediaRecorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm' });

                    mediaRecorder.ondataavailable = (event) => {
                        if (event.data.size > 0 && deepgramConnection?.readyState === WebSocket.OPEN) {
                            deepgramConnection.send(event.data);
                        }
                    };

                    // Start recording with 250ms chunks
                    mediaRecorder.start(250);
                    console.log('Voice recognition started - Speak now!');
                    return;
                }
                
                // Handle error from proxy
                if (data.type === 'error') {
                    console.error('Deepgram proxy error:', data.message);
                    stopRecording(voiceButton, inputElement);
                    alert(`Voice input error: ${data.message}`);
                    return;
                }
                
                // Handle transcription results
                const transcript = data.channel?.alternatives?.[0]?.transcript;

                if (transcript && data.is_final) {
                    finalTranscript += transcript + ' ';
                    inputElement.value = initialInputContent + finalTranscript;
                    console.log('Final transcript:', transcript);
                }
            } catch (e) {
                console.error('Error parsing Deepgram message:', e);
            }
        };

        deepgramConnection.onerror = (error) => {
            console.error('Deepgram WebSocket error:', error);
            stopRecording(voiceButton, inputElement);
            alert('Voice input error. Please try again.');
        };

        deepgramConnection.onclose = (event) => {
            console.log('Deepgram connection closed:', event.code, event.reason);
            if (isRecording) {
                stopRecording(voiceButton, inputElement);
            }
        };

    } catch (error) {
        console.error('Failed to start voice input:', error);
        stopRecording(voiceButton, inputElement);

        if (error.name === 'NotAllowedError') {
            alert('Please allow microphone access to use voice input.');
        } else if (error.message.includes('DEEPGRAM_API_KEY')) {
            alert('Voice input is not configured. Please add your Deepgram API key.');
        } else {
            alert(`Voice input error: ${error.message}`);
        }
    }
}

// Stop recording and cleanup resources
function stopRecording(voiceButton, inputElement) {
    // Stop MediaRecorder
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    mediaRecorder = null;

    // Close WebSocket
    if (deepgramConnection) {
        deepgramConnection.close();
    }
    deepgramConnection = null;

    // Stop audio tracks
    if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
    }
    audioStream = null;

    // Update UI
    setRecordingState(false, voiceButton, inputElement);
    console.log('Voice recognition ended');
}
```

---

### Step 5: Update Frontend (app-mcp.js)

**File**: `workflow-planner/app-mcp.js`

Apply **identical changes** as Step 4 to `app-mcp.js`. The code is the same for both files.

---

## Critical Configuration Details

### Deepgram URL Parameters

**CORRECT Configuration**:
```javascript
const deepgramUrl = 'wss://api.deepgram.com/v1/listen?model=nova-3&language=en-US&smart_format=true&endpointing=300';
```

**WRONG Configurations** (will cause error 400):
```javascript
// ❌ utterance_end_ms requires interim_results=true
'...&interim_results=false&utterance_end_ms=1000'

// ❌ Conflicting parameters
'...&interim_results=false&endpointing=300&utterance_end_ms=1000'
```

### MediaRecorder Settings
```javascript
new MediaRecorder(audioStream, { mimeType: 'audio/webm' });
mediaRecorder.start(250);  // 250ms chunks
```

**Note**: Deepgram auto-detects webm format. No encoding parameter needed.

---

## Common Pitfalls & Solutions

### Issue 1: WebSocket Error 1006 (Abnormal Closure)

**Symptoms**: 
- Connection closes immediately
- Error 1006 in console
- No meaningful error message

**Root Causes**:
1. **Browser security limitation**: Cannot set `Authorization` header on WebSocket
2. **Invalid parameter combination**: `utterance_end_ms` with `interim_results=false`
3. **Wrong API key permissions**: Key has Default role instead of Member

**Solution**:
- ✅ Use WebSocket proxy (server-side can set headers)
- ✅ Remove conflicting parameters from URL
- ✅ Create API key with Member role

### Issue 2: "Failed to get Deepgram token"

**Root Cause**: API key has Default role without `usage::write` scope

**Solution**: 
1. Go to Deepgram Console → API Keys
2. Create new key with **Member** role
3. Update `.env` with new key

### Issue 3: "SyntaxError: Unexpected token 'o'"

**Root Cause**: Node.js `ws` module sends Buffers, browser receives Blobs

**Solution**: Convert Blob to text before parsing
```javascript
let textData;
if (event.data instanceof Blob) {
    textData = await event.data.text();
} else {
    textData = event.data;
}
const data = JSON.parse(textData);
```

### Issue 4: No transcription appearing

**Possible Causes**:
1. Not speaking loud/clear enough
2. Microphone muted at OS level
3. Wrong audio codec
4. WebSocket closed prematurely

**Debug Steps**:
```javascript
// Check server logs for:
console.log('📝 Deepgram message:', dataStr);  // Should show transcription JSON

// Check browser console for:
console.log('Final transcript:', transcript);  // Should show text
```

---

## Testing Checklist

### Pre-Launch Testing

- [ ] **Environment Setup**
  - [ ] `DEEPGRAM_API_KEY` in `.env`
  - [ ] API key has Member role
  - [ ] `npm install ws` completed
  
- [ ] **Server Startup**
  - [ ] Server logs show WebSocket proxy endpoint
  - [ ] No errors on startup
  - [ ] Can access `http://localhost:8099`

- [ ] **Main Screen Voice Input**
  - [ ] Click mic button → "Listening..." badge appears
  - [ ] Speak 5-10 seconds
  - [ ] Transcript appears in input field
  - [ ] Click mic button → recording stops, badge disappears
  
- [ ] **Chat Screen Voice Input**
  - [ ] Enter chat mode
  - [ ] Same behavior as main screen
  
- [ ] **Edge Cases**
  - [ ] Record → toggle MCP → text persists
  - [ ] Existing text + voice input → both preserved
  - [ ] Deny mic permission → clear error message
  - [ ] Remove API key → graceful error
  - [ ] Speak nothing → no crash, empty transcript

### Cross-Browser Testing

- [ ] Chrome/Edge (Chromium)
- [ ] Firefox
- [ ] Safari (Mac)

---

## Debugging Guide

### Enable Verbose Logging

**Server**: Already has console.log statements in proxy code

**Browser**: Check console for:
```
Connecting to Deepgram via WebSocket proxy: ws://localhost:8099/api/deepgram/ws
WebSocket proxy connected, waiting for Deepgram ready signal...
Deepgram connection ready via proxy
Voice recognition started - Speak now!
Final transcript: [your speech]
```

### Test Direct Server Connection

Verify API key and server-side WebSocket work:
```bash
node -e '
const WebSocket = require("ws");
const ws = new WebSocket("wss://api.deepgram.com/v1/listen?model=nova-3", {
    headers: { "Authorization": "Token YOUR_API_KEY_HERE" }
});
ws.on("open", () => console.log("SUCCESS"));
ws.on("error", (e) => console.log("ERROR:", e.message));
'
```

Expected output: `SUCCESS`

### Check Deepgram API Status

Test token generation:
```bash
curl -X POST https://api.deepgram.com/v1/auth/grant \
  -H "Authorization: Token YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"ttl_seconds": 60}'
```

Expected response: `{"access_token":"eyJ...","expires_in":60}`

---

## Performance Considerations

### Audio Chunk Size
**Recommended**: 250ms
- Balance between latency and overhead
- Tested across browsers
- Works well with Deepgram processing

### WebSocket Keep-Alive
**Not needed** - Deepgram handles connection maintenance

### Memory Management
✅ **Cleanup on stop**:
- Stop MediaRecorder
- Close WebSocket
- Stop all audio tracks
- Clear references (prevents leaks)

---

## Security Considerations

### API Key Protection
✅ **Server-side only**
- Never expose API key to browser
- Proxy pattern keeps key on server
- No JWT tokens in client code

### HTTPS in Production
```javascript
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
```
- Development: `ws://localhost:8099`
- Production: `wss://yourdomain.com`

---

## Rollback Plan

If issues arise:

1. **Stop using feature**: Comment out mic button click handlers
2. **Revert code**: `git revert <commit-hash>`
3. **Remove dependency**: `npm uninstall ws`
4. **Remove proxy code**: Delete WebSocket proxy section from `proxy-server.js`

Original WebSpeech API code available in git history.

---

## Production Deployment Checklist

- [ ] Environment variable `DEEPGRAM_API_KEY` set in production
- [ ] WebSocket proxy endpoint accessible (firewall rules)
- [ ] SSL/TLS certificate for `wss://` protocol
- [ ] Monitor Deepgram API usage (console.deepgram.com)
- [ ] Set up error logging/monitoring
- [ ] Test in production environment
- [ ] Load testing (concurrent connections)

---

## Cost Estimation

**Deepgram Pricing** (as of 2026):
- Nova-3 model: ~$0.0043/minute
- Typical workflow description: 10-30 seconds
- Average cost per voice input: $0.0007 - $0.0021

**Optimization**:
- Use Member role API keys (required, no additional cost)
- No interim results = less data transfer
- 250ms chunks = minimal overhead

---

## Future Enhancements

### Potential Improvements
1. **Interim Results**: Enable real-time typing effect
   - Requires `interim_results=true`
   - Can use `utterance_end_ms` with interim results
   
2. **Language Selection**: Dropdown for language choice
   - Currently hardcoded to `en-US`
   - Deepgram supports 30+ languages
   
3. **Custom Vocabulary**: Add n8n-specific terms
   - Improves accuracy for technical terms
   - Deepgram supports keyword boosting
   
4. **Error Recovery**: Auto-retry on connection failures
   - Exponential backoff
   - User notification

5. **Usage Analytics**: Track API usage and costs
   - Log transcription requests
   - Monitor Deepgram API quota

---

## Lessons Learned

### What Worked
✅ WebSocket proxy pattern (clean, secure)  
✅ Server-side authentication (only viable option)  
✅ Blob-to-text conversion (handles ws module output)  
✅ Auto-detection of webm format (less configuration)  
✅ 250ms audio chunks (good balance)

### What Didn't Work
❌ Direct browser-to-Deepgram WebSocket (browser limitation)  
❌ JWT tokens via subprotocol (wrong auth method)  
❌ Query parameter authentication (wrong for JWTs)  
❌ `utterance_end_ms` + `interim_results=false` (conflicts)

### Key Insights
1. **Always check API key permissions** - Default role insufficient
2. **Test server-side first** - Isolate browser issues
3. **Capture full error bodies** - `unexpected-response` handler essential
4. **Trust error messages** - Deepgram's 400 errors are accurate
5. **Proxy is the answer** - Only solution for WebSocket header limitation

---

## Support Resources

- **Deepgram Docs**: https://developers.deepgram.com
- **API Status**: https://status.deepgram.com
- **Console**: https://console.deepgram.com
- **Community**: https://github.com/orgs/deepgram/discussions

---

## Implementation Timeline

**Total Time**: 4-6 hours (first implementation)  
**Maintenance Time**: ~30 minutes (following this plan)

### Breakdown
- Environment setup: 15 minutes
- Server proxy code: 45 minutes
- Frontend integration: 45 minutes
- Testing & debugging: 2-4 hours (first time), 30 minutes (following plan)

---

## Conclusion

This plan reflects the **actual implementation experience**, not theoretical steps. Following this guide should result in a working Deepgram integration in **~30 minutes** rather than the 4-6 hours of trial-and-error.

**Key Takeaway**: The WebSocket proxy pattern is non-negotiable due to browser security limitations. Direct browser connections will always fail.

**Status**: ✅ Production-ready implementation
**Last Validated**: January 13, 2026
