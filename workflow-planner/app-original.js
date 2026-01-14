// Configuration - API endpoint (keys are now managed server-side)
const API_ENDPOINT = '/api/openai-proxy';

// Initialize Mermaid
mermaid.initialize({ 
    startOnLoad: true,
    theme: 'default',
    themeVariables: {
        primaryColor: '#2563eb',
        primaryTextColor: '#fff',
        primaryBorderColor: '#1e40af',
        lineColor: '#fb923c',
        secondaryColor: '#fb923c',
        tertiaryColor: '#fbbf24'
    }
});

// Playful loading messages
const loadingMessages = [
    "The AI workflow builder is thinking... 🤔",
    "Analyzing your automation needs... 🔍",
    "Crafting the perfect workflow... ✨",
    "Consulting the automation spirits... 🔮",
    "Building something amazing... 🚀",
    "Almost there, just dotting the i's... ✏️",
    "Optimizing for maximum efficiency... ⚡",
    "Putting the pieces together... 🧩"
];

// Application state
let conversationHistory = [];
let currentStage = 'initial';
let clarificationCount = 0;
let diagramCount = 0;
let currentLoadingMessageIndex = 0;
let loadingInterval = null;
let lastDesignProposal = ''; // Store design proposal for diagram generation

// Retry state management
let lastUserInput = '';           // Store last user message for clarification retries
let lastFailedPhase = null;       // Track which phase failed
let retryContext = {};            // Store context needed for specific retries

// Voice input state (Deepgram Nova-3)
let isRecording = false;
let deepgramConnection = null;
let mediaRecorder = null;
let audioStream = null;
let finalTranscript = '';
let initialInputContent = '';

// DOM Elements
const container = document.querySelector('.container');
const inputSection = document.getElementById('inputSection') || document.querySelector('.input-section');
const chatInterface = document.getElementById('chatInterface');
const userInput = document.getElementById('userInput');
const submitBtn = document.getElementById('submitBtn');
const voiceBtn = document.getElementById('voiceBtn');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const chatVoiceBtn = document.getElementById('chatVoiceBtn');
const sendBtn = document.getElementById('sendBtn');
const backBtn = document.getElementById('backBtn');
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingText = document.getElementById('loadingText');
const suggestionBtns = document.querySelectorAll('.suggestion-btn');
const diagramModal = document.getElementById('diagramModal');
const modalClose = document.getElementById('modalClose');
const modalBody = document.getElementById('modalBody');
const downloadPng = document.getElementById('downloadPng');
const downloadSvg = document.getElementById('downloadSvg');

// Event Listeners
submitBtn.addEventListener('click', handleInitialSubmit);
voiceBtn.addEventListener('click', () => handleVoiceInput(userInput, handleInitialSubmit));
userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleInitialSubmit();
    }
});

sendBtn.addEventListener('click', handleChatSubmit);
chatVoiceBtn.addEventListener('click', () => handleVoiceInput(chatInput, handleChatSubmit));
chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleChatSubmit();
    }
});

backBtn.addEventListener('click', () => {
    // Go back to initial screen
    chatInterface.style.display = 'none';
    inputSection.style.display = 'block';
    document.querySelector('.main-title').style.display = 'block';
    // Clear conversation
    conversationHistory = [];
    currentStage = 'initial';
    clarificationCount = 0;
    diagramCount = 0;
    chatMessages.innerHTML = '';
    userInput.value = '';
});

suggestionBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        userInput.value = btn.dataset.suggestion;
        handleInitialSubmit();
    });
});

// Modal event listeners
modalClose.addEventListener('click', () => {
    diagramModal.classList.remove('active');
});

window.addEventListener('click', (e) => {
    if (e.target === diagramModal) {
        diagramModal.classList.remove('active');
    }
});

downloadPng.addEventListener('click', downloadDiagramAsPng);
downloadSvg.addEventListener('click', downloadDiagramAsSvg);

// Handle initial form submission
function handleInitialSubmit() {
    const input = userInput.value.trim();
    if (!input) return;
    
    // Switch to chat interface
    inputSection.style.display = 'none';
    document.querySelector('.main-title').style.display = 'none';
    chatInterface.style.display = 'flex';
    
    // Add user message to chat
    addMessage('user', input);
    
    // Clear input
    userInput.value = '';
    
    // Process the input
    processUserInput(input);
}

// Handle chat submission
function handleChatSubmit() {
    const input = chatInput.value.trim();
    if (!input) return;
    
    // Add user message to chat
    addMessage('user', input);
    
    // Clear input
    chatInput.value = '';
    
    // Process the input
    processUserInput(input);
}

// Track diagram retry attempts
let diagramRetryCount = 0;
const MAX_DIAGRAM_RETRIES = 3;

// Add message to chat with markdown support
async function addMessage(role, content, isDiagram = false, messageId = null, skipLabel = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    if (messageId) messageDiv.id = messageId;

    const labelDiv = document.createElement('div');
    labelDiv.className = 'message-label';
    labelDiv.textContent = role === 'user' ? 'You' : 'AI Assistant';

    const contentDiv = document.createElement('div');

    if (isDiagram) {
        // Create clickable diagram container
        const containerDiv = document.createElement('div');
        containerDiv.className = 'mermaid-container';
        containerDiv.id = 'diagram-' + Date.now();

        // Show loading state initially
        containerDiv.innerHTML = `
            <div class="diagram-loading">
                <p><strong>📊 Generating diagram...</strong></p>
                <div class="error-spinner"></div>
            </div>
        `;

        if (!skipLabel) {
            messageDiv.appendChild(labelDiv);
        }
        messageDiv.appendChild(containerDiv);

        // Append to DOM FIRST, then render asynchronously
        chatMessages.appendChild(messageDiv);

        // Auto-scroll to show loading message
        setTimeout(() => {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }, 100);

        // Try to render the diagram with error handling (async)
        renderMermaidDiagram(content, containerDiv).then((renderResult) => {
            if (renderResult.success) {
                containerDiv.title = 'Click to view full diagram';
                // Make it clickable only if successful
                containerDiv.addEventListener('click', () => openDiagramModal(content));
            } else {
                // Handle diagram error
                handleDiagramError(content, containerDiv, renderResult.error);
            }
        });

        return messageDiv;
    } else {
        contentDiv.className = 'message-content';
        // Parse markdown to HTML
        const htmlContent = marked.parse(content);
        contentDiv.innerHTML = htmlContent;

        if (!skipLabel) {
            messageDiv.appendChild(labelDiv);
        }
        messageDiv.appendChild(contentDiv);
    }

    chatMessages.appendChild(messageDiv);

    // Auto-scroll to bottom
    setTimeout(() => {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }, 100);

    return messageDiv;
}

// Render Mermaid diagram with error handling
async function renderMermaidDiagram(content, containerDiv) {
    try {
        // Create unique ID for this diagram
        const diagramId = 'mermaid-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

        // Clear container
        containerDiv.innerHTML = '';

        try {
            // Use modern Mermaid API (v10+)
            const { svg, bindFunctions } = await mermaid.render(diagramId, content);

            // Insert the rendered SVG
            containerDiv.innerHTML = svg;

            // Bind any interactive functions if they exist
            if (bindFunctions) {
                bindFunctions(containerDiv);
            }

            return { success: true };

        } catch (renderError) {
            console.error('Mermaid render error:', renderError);
            
            // Clean up any Mermaid error SVGs that were created
            document.querySelectorAll('svg[aria-roledescription="error"], svg[id*="syntax-error"], svg.error').forEach(el => el.remove());
            containerDiv.querySelectorAll('svg').forEach(el => el.remove());
            
            return { success: false, error: renderError.message || 'Diagram syntax error' };
        }

    } catch (error) {
        console.error('Mermaid setup error:', error);
        return { success: false, error: error.message || 'Failed to create diagram element' };
    }
}

// Handle diagram rendering errors
function handleDiagramError(diagramCode, containerDiv, errorMessage) {
    diagramRetryCount++;
    
    if (diagramRetryCount <= MAX_DIAGRAM_RETRIES) {
        // Show error state with auto-retry message
        containerDiv.innerHTML = `
            <div class="diagram-error">
                <p><strong>📊 Diagram Error Detected</strong></p>
                <p>Automatically fixing the diagram syntax...</p>
                <p class="error-detail">Attempt ${diagramRetryCount} of ${MAX_DIAGRAM_RETRIES}</p>
                <div class="error-spinner"></div>
            </div>
        `;
        containerDiv.classList.add('error-state');
        
        // Automatically request a fixed version
        requestDiagramFix(diagramCode, errorMessage, containerDiv);
    } else {
        // Show final error with manual retry option
        containerDiv.innerHTML = `
            <div class="diagram-error">
                <p><strong>⚠️ Unable to render diagram</strong></p>
                <p>The diagram syntax needs manual correction.</p>
                <button class="retry-diagram-btn" onclick="retryDiagramManually('${encodeURIComponent(diagramCode)}', this.parentElement.parentElement)">
                    Try Again
                </button>
            </div>
        `;
        containerDiv.classList.add('error-state');
        diagramRetryCount = 0; // Reset for next diagram
    }
}

// Request AI to fix the diagram
async function requestDiagramFix(brokenDiagram, errorMessage, containerDiv) {
    const fixPrompt = `The Mermaid diagram has a syntax error. Please fix it and return ONLY the corrected Mermaid code, nothing else.

Error message: ${errorMessage}

Broken diagram:
\`\`\`mermaid
${brokenDiagram}
\`\`\`

CRITICAL FIXES TO APPLY:
1. Remove ALL special characters from labels: no parentheses (), hyphens -, colons :, commas, ampersands &, quotes
2. Use ONLY simple plain text in labels
3. Node IDs must use only letters and numbers (no spaces or special chars)
4. Use only --> for arrows
5. Replace problematic labels:
   - "HTTP Request - List Orders" → "HTTP Request List Orders"
   - "Retry (3x)" → "Retry 3 times"
   - "Wait 5s, then continue" → "Wait then continue"
   - "Save & Notify" → "Save and Notify"

Return ONLY the fixed Mermaid code starting with "graph TD" - no markdown fences, no explanation.`;

    try {
        // Use proxy endpoint (secure server-side API call)
        const systemPrompt = 'You are a Mermaid diagram syntax expert. Fix syntax errors and return only valid Mermaid code.';

        const requestBody = {
            systemPrompt: systemPrompt,
            conversationHistory: [
                { role: 'user', content: fixPrompt }
            ],
            useMcpTools: false  // Disable MCP tools in app-original.js
        };

        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (response.ok) {
            const data = await response.json();

            // Extract text from GPT-5 Nano response structure
            let fixedDiagram = '';
            if (data.output && data.output.length > 0) {
                const messageOutput = data.output.find(item => item.type === 'message');
                if (messageOutput && messageOutput.content && messageOutput.content.length > 0) {
                    const textContent = messageOutput.content.find(content => content.type === 'output_text');
                    fixedDiagram = textContent ? textContent.text : '';
                }
            }
            
            // Clean up the response (remove markdown fences if present)
            fixedDiagram = fixedDiagram.replace(/```mermaid\n?/g, '').replace(/```\n?/g, '').trim();

            // Try rendering the fixed diagram
            containerDiv.innerHTML = '';
            containerDiv.classList.remove('error-state');
            const renderResult = await renderMermaidDiagram(fixedDiagram, containerDiv);
            if (renderResult.success) {
                // Success! Make it clickable
                containerDiv.title = 'Click to view full diagram';
                containerDiv.addEventListener('click', () => openDiagramModal(fixedDiagram));
                diagramRetryCount = 0; // Reset counter
                
                // Add success message
                addMessage('assistant', '✅ Diagram syntax has been automatically corrected and is now displaying properly.', false, null, false);
            } else {
                // Still broken, try again or show final error
                handleDiagramError(fixedDiagram, containerDiv, renderResult.error);
            }
        }
    } catch (error) {
        console.error('Error requesting diagram fix:', error);
        // Show error state
        containerDiv.innerHTML = `
            <div class="diagram-error">
                <p><strong>⚠️ Could not auto-fix diagram</strong></p>
                <p>Please try rephrasing your request.</p>
            </div>
        `;
        containerDiv.classList.add('error-state');
    }
}

// Manual retry function (accessible from onclick)
window.retryDiagramManually = function(encodedDiagram, containerDiv) {
    const diagramCode = decodeURIComponent(encodedDiagram);
    diagramRetryCount = 0; // Reset counter
    containerDiv.innerHTML = '';
    containerDiv.classList.remove('error-state');
    handleDiagramError(diagramCode, containerDiv, 'Manual retry requested');
}

// Open diagram in modal
async function openDiagramModal(diagramCode) {
    modalBody.innerHTML = '';

    // Try to render in modal with error handling
    const renderResult = await renderMermaidDiagram(diagramCode, modalBody);

    if (!renderResult.success) {
        // Show error in modal
        modalBody.innerHTML = `
            <div class="diagram-error">
                <p><strong>⚠️ Unable to display diagram</strong></p>
                <p>The diagram has syntax errors that need to be corrected.</p>
                <p class="error-detail">${renderResult.error}</p>
            </div>
        `;
    }

    // Show modal regardless
    diagramModal.classList.add('active');
}

// Download diagram as PNG
async function downloadDiagramAsPng() {
    const diagramElement = modalBody.querySelector('svg');
    if (!diagramElement) return;
    
    try {
        const dataUrl = await domtoimage.toPng(diagramElement);
        const link = document.createElement('a');
        link.download = 'workflow-diagram.png';
        link.href = dataUrl;
        link.click();
    } catch (error) {
        console.error('Error downloading PNG:', error);
        alert('Failed to download diagram as PNG. Please try again.');
    }
}

// Download diagram as SVG
function downloadDiagramAsSvg() {
    const svgElement = modalBody.querySelector('svg');
    if (!svgElement) return;
    
    const svgData = new XMLSerializer().serializeToString(svgElement);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);
    
    const link = document.createElement('a');
    link.download = 'workflow-diagram.svg';
    link.href = svgUrl;
    link.click();
    
    URL.revokeObjectURL(svgUrl);
}

// Show/hide loading with playful messages inline in chat
let thinkingMessageElement = null;

function showLoading(show) {
    if (show) {
        sendBtn.disabled = true;
        chatInput.disabled = true;
        
        // Add thinking message to chat
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message assistant thinking-message';
        
        const labelDiv = document.createElement('div');
        labelDiv.className = 'message-label';
        labelDiv.textContent = 'AI Assistant';
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        
        // Start with first loading message and typing dots
        currentLoadingMessageIndex = 0;
        contentDiv.innerHTML = `<em>${loadingMessages[currentLoadingMessageIndex]}<span class="typing-dots"><span></span><span></span><span></span></span></em>`;
        
        messageDiv.appendChild(labelDiv);
        messageDiv.appendChild(contentDiv);
        chatMessages.appendChild(messageDiv);
        
        // Store reference to remove later
        thinkingMessageElement = messageDiv;
        
        // Auto-scroll to show thinking message
        chatMessages.scrollTop = chatMessages.scrollHeight;
        
        // Start cycling through loading messages
        loadingInterval = setInterval(() => {
            currentLoadingMessageIndex = (currentLoadingMessageIndex + 1) % loadingMessages.length;
            if (thinkingMessageElement) {
                const content = thinkingMessageElement.querySelector('.message-content');
                if (content) {
                    content.innerHTML = `<em>${loadingMessages[currentLoadingMessageIndex]}<span class="typing-dots"><span></span><span></span><span></span></span></em>`;
                }
            }
        }, 2000);
    } else {
        sendBtn.disabled = false;
        chatInput.disabled = false;
        
        // Remove thinking message
        if (thinkingMessageElement && thinkingMessageElement.parentNode) {
            thinkingMessageElement.remove();
            thinkingMessageElement = null;
        }
        
        if (loadingInterval) {
            clearInterval(loadingInterval);
            loadingInterval = null;
        }
    }
}

/**
 * Retry handler for clarification phase
 */
function retryClarification() {
    if (lastUserInput) {
        console.log('🔄 Retrying clarification with input:', lastUserInput);
        processUserInput(lastUserInput);
    }
}

/**
 * Retry handler for design proposal phase
 */
function retryDesignProposal() {
    if (lastUserInput) {
        console.log('🔄 Retrying design proposal with input:', lastUserInput);
        processUserInput(lastUserInput);
    }
}

/**
 * Add phase-specific retry button beneath error message
 * Uses proper DOM structure matching original buttons for consistent styling
 */
function addRetryButton(phase) {
    const buttonConfigs = {
        'clarification': {
            text: 'Try Again',
            classes: 'build-it-btn single-button orange-gradient',
            handler: () => {
                // Don't call showLoading here - processUserInput() handles it
                retryClarification();
            }
        },
        'design_proposal': {
            text: 'Try Again',
            classes: 'build-it-btn single-button orange-gradient',
            handler: () => {
                // Don't call showLoading here - processUserInput() handles it
                retryDesignProposal();
            }
        },
        'diagram': {
            text: 'Diagram it! 📊',
            classes: 'build-it-btn single-button orange-gradient',
            handler: () => handleDiagramItClick()
        },
        'explanation': {
            text: 'Explain the design 💡',
            classes: 'build-it-btn single-button light-blue',
            handler: () => {
                showLoading(true);
                addEducationalExplanation();
            }
        },
        'build': {
            text: "Let's Build It! 🚀",
            classes: 'build-it-btn single-button',
            handler: () => handleBuildItClick()
        },
        'download': {
            text: 'Download Workflow JSON',
            classes: 'build-it-btn single-button',
            style: 'background: linear-gradient(135deg, #10b981 0%, #34d399 50%, #6ee7b7 100%);',
            handler: () => {
                if (retryContext.jsonWorkflow) {
                    downloadWorkflowJSON(retryContext.jsonWorkflow);
                } else {
                    console.error('❌ No workflow JSON available for retry');
                    addMessage('assistant', 'Unable to retry download - workflow data not found.');
                }
            }
        }
    };

    const config = buttonConfigs[phase];
    if (!config) {
        console.error('❌ Unknown retry phase:', phase);
        return;
    }

    // Create proper DOM structure matching original buttons
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';

    const buildItContainer = document.createElement('div');
    buildItContainer.className = 'build-it-container';

    const description = document.createElement('div');
    description.className = 'build-it-description';
    description.textContent = 'Ready to try again?';

    const button = document.createElement('button');
    button.textContent = config.text;
    button.className = config.classes;
    if (config.style) {
        button.style.cssText = config.style;
    }
    button.onclick = () => {
        button.disabled = true;
        messageDiv.remove();
        config.handler();
    };

    buildItContainer.appendChild(description);
    buildItContainer.appendChild(button);
    messageDiv.appendChild(buildItContainer);
    chatMessages.appendChild(messageDiv);

    // Auto-scroll to show button
    setTimeout(() => {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }, 100);
}

// Process user input with GPT-4
async function processUserInput(input) {
    // Store input for potential retry
    lastUserInput = input;

    // Add to conversation history
    conversationHistory.push({ role: 'user', content: input });

    // Determine the appropriate system prompt based on stage
    let systemPrompt = getSystemPrompt();

    try {
        showLoading(true);

        // Use proxy endpoint (secure server-side API call - keys managed server-side)
        const requestBody = {
            systemPrompt: systemPrompt,
            conversationHistory: conversationHistory.slice(-10), // Keep last 10 messages for context
            useMcpTools: false  // Disable MCP tools in app-original.js
        };

        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`API request failed: ${response.status}`);
        }

        const data = await response.json();

        // DEBUG: Log response structure for debugging empty responses
        console.log('🔍 API Response structure:', {
            hasOutput: !!data.output,
            hasChoices: !!data.choices,
            hasError: !!data.error,
            keys: Object.keys(data),
            preview: JSON.stringify(data).substring(0, 300)
        });

        // Check for error responses from proxy FIRST
        if (data.error) {
            console.error('❌ Proxy Error:', data.error, data.details);
            throw new Error(`API Error: ${data.details || data.error}`);
        }

        // Extract text from response structure (handle both MCP and OpenAI formats)
        let assistantResponse = '';

        // Try MCP format first (for compatibility)
        if (data.output && data.output.length > 0) {
            const messageOutput = data.output.find(item => item.type === 'message');
            if (messageOutput && messageOutput.content && messageOutput.content.length > 0) {
                const textContent = messageOutput.content.find(content => content.type === 'output_text');
                assistantResponse = textContent ? textContent.text : '';
            }
        }
        // Fallback to standard OpenAI format
        else if (data.choices && data.choices.length > 0) {
            const msg = data.choices[0].message;
            assistantResponse = msg.content;

            // Check if this was a tool_calls response (content would be null)
            if (msg.tool_calls && msg.tool_calls.length > 0) {
                console.warn('⚠️ Received tool_calls response without content - proxy should have handled this');
            }
        }

        // Guard against null/empty responses - throw for retry handling
        if (!assistantResponse) {
            console.error('❌ Empty response received - throwing for retry logic');
            throw new Error('Empty response received from API');
        }

        // Add assistant response to history
        conversationHistory.push({ role: 'assistant', content: assistantResponse });

        // Check if response contains a Mermaid diagram
        const mermaidMatch = assistantResponse.match(/```\s*mermaid\s*[\r\n]+([\s\S]*?)```/i);
        
        if (mermaidMatch) {
            // Extract the diagram and the rest of the message
            const diagramCode = mermaidMatch[1];
            const textBefore = assistantResponse.substring(0, mermaidMatch.index);
            const textAfter = assistantResponse.substring(mermaidMatch.index + mermaidMatch[0].length);
            
            if (textBefore.trim()) {
                addMessage('assistant', textBefore.trim());
            }

            // Add the diagram
            addMessage('assistant', diagramCode, true);

            if (textAfter.trim()) {
                addMessage('assistant', textAfter.trim());
            }

            // Show dual choice buttons after diagram
            setTimeout(() => {
                addDualChoiceButtons(diagramCode);
            }, 1000);

            currentStage = 'diagram_generated';
            diagramCount++;
        } else {
            // Regular text response
            addMessage('assistant', assistantResponse);

            // Update stage based on clarification count
            if (currentStage === 'initial' || currentStage === 'clarifying') {
                clarificationCount++;
                if (clarificationCount >= 2) {
                    currentStage = 'design_proposed'; // Changed from 'ready_for_diagram'
                    // Save the design proposal for diagram generation
                    lastDesignProposal = assistantResponse;
                } else {
                    currentStage = 'clarifying';
                }
            }

            // Show "Diagram it" button when design is proposed
            if (currentStage === 'design_proposed') {
                setTimeout(() => {
                    addDiagramItButton();
                }, 500);
            }
        }
        
    } catch (error) {
        console.error('Error:', error);
        addMessage('assistant', `Sorry, I encountered an error: ${error.message}. Please try again.`);

        // Determine retry phase based on current stage
        let retryPhase = null;
        if (currentStage === 'initial' || currentStage === 'clarifying') {
            retryPhase = 'clarification';
            lastFailedPhase = 'clarification';
        } else if (currentStage === 'design_proposed') {
            retryPhase = 'design_proposal';
            lastFailedPhase = 'design_proposal';
        } else if (currentStage === 'ready_for_diagram') {
            retryPhase = 'diagram';
            lastFailedPhase = 'diagram';
        }

        // Show retry button if applicable
        if (retryPhase) {
            addRetryButton(retryPhase);
        }
    } finally {
        showLoading(false);
    }
}

// Add "Diagram it" button after design proposal
function addDiagramItButton() {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';

    const container = document.createElement('div');
    container.className = 'build-it-container';

    const description = document.createElement('div');
    description.className = 'build-it-description';
    description.innerHTML = `📋 <strong>Design proposal is ready.</strong>`;

    // Diagram it button (orange)
    const diagramBtn = document.createElement('button');
    diagramBtn.className = 'build-it-btn single-button';
    diagramBtn.style.background = 'linear-gradient(135deg, #f59e0b 0%, #f97316 50%, #ea580c 100%)';
    diagramBtn.textContent = 'Diagram it! 📊';
    diagramBtn.id = 'diagramItBtn';

    diagramBtn.addEventListener('click', () => {
        diagramBtn.disabled = true;
        diagramBtn.textContent = 'Creating diagram... 🎨';
        messageDiv.remove();
        handleDiagramItClick();
    });

    container.appendChild(description);
    container.appendChild(diagramBtn);
    messageDiv.appendChild(container);
    chatMessages.appendChild(messageDiv);

    setTimeout(() => {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }, 100);
}

// Add "Diagram it" button to error message for manual retry
function addRetryDiagramButton(errorMessage) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.innerHTML = `❌ Failed to generate diagram after 3 attempts. Error: ${errorMessage}<br><br>You can try again:`;

    const button = document.createElement('button');
    button.className = 'build-it-btn single-button';
    button.style.background = 'linear-gradient(135deg, #f59e0b 0%, #f97316 50%, #ea580c 100%)';
    button.style.marginTop = '10px';
    button.textContent = 'Diagram it! 📊';

    button.addEventListener('click', () => {
        button.disabled = true;
        button.textContent = 'Creating diagram... 🎨';
        messageDiv.remove();
        handleDiagramItClick();
    });

    messageDiv.appendChild(contentDiv);
    messageDiv.appendChild(button);
    chatMessages.appendChild(messageDiv);

    setTimeout(() => {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }, 100);
}

// Handle "Diagram it" button click with retry logic
async function handleDiagramItClick(retryCount = 0) {
    const maxRetries = 3;
    console.log(`Diagram it clicked${retryCount > 0 ? ` (retry ${retryCount}/${maxRetries})` : ''} - requesting mermaid generation`);

    // Add user message indicating diagram request (only on first attempt)
    if (retryCount === 0) {
        addMessage('user', 'Please create the workflow diagram.');
    }

    // Update stage to trigger mermaid generation
    currentStage = 'ready_for_diagram';

    try {
        // Process with the current conversation context
        await processUserInput('Please create a detailed Mermaid workflow diagram based on our discussion.');
    } catch (error) {
        console.error(`Diagram generation attempt ${retryCount + 1} failed:`, error);

        if (retryCount < maxRetries) {
            // Retry after a short delay
            const delay = (retryCount + 1) * 1000; // 1s, 2s, 3s delays
            console.log(`Retrying in ${delay}ms...`);
            setTimeout(() => handleDiagramItClick(retryCount + 1), delay);
        } else {
            // All retries exhausted - show error with retry button
            addRetryDiagramButton(error.message);
        }
    }
}

// Add dual choice buttons (Explain design OR Build It)
function addDualChoiceButtons(diagramCode) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';

    const container = document.createElement('div');
    container.className = 'build-it-container';

    const description = document.createElement('div');
    description.className = 'build-it-description';
    description.textContent = 'Choose your next step:';

    // Button row container for side-by-side layout
    const buttonRow = document.createElement('div');
    buttonRow.className = 'dual-button-row';

    // Left button: Explain the design (light blue)
    const explainBtn = document.createElement('button');
    explainBtn.className = 'build-it-btn dual-button light-blue';
    explainBtn.textContent = 'Explain the design 💡';
    explainBtn.id = 'explainDesignBtn';

    explainBtn.addEventListener('click', () => {
        explainBtn.disabled = true;
        buildBtn.disabled = true;
        explainBtn.textContent = 'Loading explanation... 💡';
        messageDiv.remove();
        showLoading(true);
        addEducationalExplanation(diagramCode);
    });

    // Right button: Let's Build It (orange)
    const buildBtn = document.createElement('button');
    buildBtn.className = 'build-it-btn dual-button';
    buildBtn.textContent = "Let's Build It! 🚀";
    buildBtn.id = 'buildWorkflowBtn';

    buildBtn.addEventListener('click', () => {
        explainBtn.disabled = true;
        buildBtn.disabled = true;
        buildBtn.textContent = 'Building workflow... 🔨';
        messageDiv.remove();
        handleBuildItClick();
    });

    buttonRow.appendChild(explainBtn);
    buttonRow.appendChild(buildBtn);
    container.appendChild(description);
    container.appendChild(buttonRow);
    messageDiv.appendChild(container);
    chatMessages.appendChild(messageDiv);

    setTimeout(() => {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }, 100);
}

// Add educational explanation after diagram
async function addEducationalExplanation(diagramCode) {
    const explanationPrompt = `
Based on the workflow diagram that was just created, write a first-person explanation directly to the user explaining:
1. Why I chose this specific workflow design for their needs
2. The intentional design decisions I made and why each step matters
3. How I applied n8n best practices in this design
4. What specific benefits they'll get from this approach

Write as "I" speaking directly to "you" - be conversational, educational, and confident about the design choices. Explain your reasoning behind using certain nodes, the order of operations, and why this structure will be effective for their use case. Maximum 3-4 paragraphs.

Example tone: "I designed this workflow to start with X because... I chose to use a Switch node here instead of IF nodes because... I placed the error handling at this point because..."`;

    try {
        // Build conversation history for explanation
        const systemPrompt = 'You are a workflow automation expert speaking directly to a user. Use first person (I) and explain your design decisions confidently and personally.';
        const explanationHistory = [
            ...conversationHistory.slice(-5),
            { role: 'user', content: explanationPrompt }
        ];

        // Use proxy endpoint (secure server-side API call - keys managed server-side)
        const requestBody = {
            systemPrompt: systemPrompt,
            conversationHistory: explanationHistory,
            useMcpTools: false  // Disable MCP tools in app-original.js
        };

        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (response.ok) {
            const data = await response.json();

            // Extract text from response structure (handle both MCP and OpenAI formats)
            let explanation = '';

            // Try MCP format first (for compatibility)
            if (data.output && data.output.length > 0) {
                const messageOutput = data.output.find(item => item.type === 'message');
                if (messageOutput && messageOutput.content && messageOutput.content.length > 0) {
                    const textContent = messageOutput.content.find(content => content.type === 'output_text');
                    explanation = textContent ? textContent.text : '';
                }
            }
            // Fallback to standard OpenAI format
            else if (data.choices && data.choices.length > 0) {
                explanation = data.choices[0].message.content;
            }

            showLoading(false);

            if (explanation.trim()) {
                // Add explanation as a separate message
                addMessage('assistant', `💡 **My design rationale for this workflow:**\n\n${explanation}`);
            } else {
                console.warn('⚠️ Empty explanation received');
                addMessage('assistant', '💡 The workflow design is ready. You can now proceed to build it!');
            }

            // Add Build It button after explanation
            setTimeout(() => {
                addBuildItButton();
            }, 500);
        } else {
            showLoading(false);
            addMessage('assistant', '⚠️ Could not generate design explanation. Please proceed with building the workflow.', false, null, false);
            setTimeout(() => {
                addBuildItButton();
            }, 500);
        }
    } catch (error) {
        console.error('Error getting explanation:', error);
        showLoading(false);
        addMessage('assistant', `Sorry, I encountered an error generating the explanation: ${error.message}. Please try again.`);
        lastFailedPhase = 'explanation';
        addRetryButton('explanation');
    }
}

// Add Build It button after explanation
function addBuildItButton() {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';

    const buildItContainer = document.createElement('div');
    buildItContainer.className = 'build-it-container';
    
    const description = document.createElement('div');
    description.className = 'build-it-description';
    description.textContent = 'Ready to turn this workflow design into actual n8n JSON code?';
    
    const buildItBtn = document.createElement('button');
    buildItBtn.className = 'build-it-btn';
    buildItBtn.textContent = "Let's Build It! 🚀";
    buildItBtn.id = 'buildWorkflowBtn';
    
    // Add click event listener
    buildItBtn.addEventListener('click', handleBuildItClick);
    
    buildItContainer.appendChild(description);
    buildItContainer.appendChild(buildItBtn);

    messageDiv.appendChild(buildItContainer);
    
    chatMessages.appendChild(messageDiv);
    
    // Auto-scroll to show button
    setTimeout(() => {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }, 100);
}

// Handle Build It button click - Claude 4.5 Sonnet integration
async function handleBuildItClick() {
    console.log('Build It clicked - starting Claude 4.5 Sonnet integration');

    // Disable button to prevent multiple clicks
    const buildBtn = document.getElementById('buildWorkflowBtn');
    if (buildBtn) {
        buildBtn.disabled = true;
        buildBtn.textContent = 'Building workflow... 🔨';
    }

    // Show building message
    addMessage('assistant', '⚙️ **Building your n8n workflow...**\n\nI\'m now using Claude Sonnet 4.5 to generate the complete n8n JSON workflow based on our design. This may take a moment...', false, null, false);

    // Add progress indicator
    const progressDiv = document.createElement('div');
    progressDiv.className = 'message assistant thinking-message';

    const labelDiv = document.createElement('div');
    labelDiv.className = 'message-label';
    labelDiv.textContent = 'AI Assistant';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.innerHTML = `<em>Generating workflow JSON<span class="typing-dots"><span></span><span></span><span></span></span></em>`;

    progressDiv.appendChild(labelDiv);
    progressDiv.appendChild(contentDiv);
    chatMessages.appendChild(progressDiv);

    // Auto-scroll to show progress
    setTimeout(() => {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }, 100);

    try {
        // Get the workflow design from conversation history
        const workflowDesign = extractWorkflowDesign();

        // Generate JSON with Claude 4.5 Sonnet
        const jsonWorkflow = await generateWorkflowJSON(workflowDesign);

        // Remove progress indicator
        if (progressDiv && progressDiv.parentNode) {
            progressDiv.remove();
        }

        if (jsonWorkflow) {
            // Success - provide download
            addMessage('assistant', '✅ **Workflow JSON Generated Successfully!**\n\nYour n8n workflow has been generated and is ready for download. Click the button below to download the JSON file that you can import directly into your n8n instance.', false, null, true);
            addDownloadButton(jsonWorkflow);
        } else {
            // Failed after retries
            addMessage('assistant', '❌ **Unable to Generate Workflow**\n\nI encountered issues generating a valid JSON workflow. Please try rephrasing your workflow requirements or try again.', false, null, false);
        }

    } catch (error) {
        console.error('Error in handleBuildItClick:', error);

        // Remove progress indicator
        if (progressDiv && progressDiv.parentNode) {
            progressDiv.remove();
        }

        addMessage('assistant', `Sorry, I encountered an error building the workflow: ${error.message}. Please try again.`);
        lastFailedPhase = 'build';
        addRetryButton('build');

        // Re-enable button
        if (buildBtn) {
            buildBtn.disabled = false;
            buildBtn.textContent = "Let's Build It! 🚀";
        }
    }
}

// Extract workflow design from conversation history
function extractWorkflowDesign() {
    // Get the last few messages that contain the workflow discussion
    const relevantMessages = conversationHistory
        .slice(-10) // Get last 10 messages
        .map(msg => `${msg.role}: ${msg.content}`)
        .join('\n\n');
    
    return relevantMessages;
}

// Generate workflow JSON using Claude 4.5 Sonnet
async function generateWorkflowJSON(workflowDesign, retryCount = 0) {
    const MAX_RETRIES = 3;
    
    const systemPrompt = `You are an expert n8n workflow automation designer and JSON generator.
CRITICAL INSTRUCTIONS FOR JSON OUTPUT:
1. You MUST respond with valid JSON only — no explanations, comments, or text
2. The JSON must conform exactly to n8n's workflow export format
3. Use double quotes throughout and proper syntax
4. All IDs must be unique UUIDs, timestamps in ISO 8601
5. Node types must use canonical n8n strings (e.g., "n8n-nodes-base.manualTrigger")
Root fields: name, nodes, connections, active, settings, versionId, id, createdAt, updatedAt`;

    const userPrompt = `Based on the following workflow discussion, generate a complete n8n workflow in JSON format:

${workflowDesign}

Create a functional n8n workflow JSON that:
1. Implements the workflow design discussed
2. Uses appropriate n8n node types
3. Includes proper connections between nodes
4. Has realistic configuration for each node
5. Follows n8n best practices

Return ONLY the JSON, no other text or formatting.`;

    try {
        // Use proxy endpoint for secure server-side API call (keys managed server-side)
        const requestBody = {
            system: systemPrompt,
            userPrompt: userPrompt
        };

        const response = await fetch('/api/claude-proxy', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`Claude proxy request failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        // Extract text from Claude API response structure
        // Claude API returns: { content: [{ type: "text", text: "..." }], role: "assistant", ... }
        let jsonContent = '';
        if (data.content && data.content.length > 0) {
            const textBlock = data.content.find(block => block.type === 'text');
            jsonContent = textBlock ? textBlock.text : '';
        }

        if (!jsonContent) {
            console.error('Claude API response structure:', data);
            throw new Error('Empty response from Claude API');
        }

        // Clean up the response - remove any markdown formatting
        jsonContent = cleanupJSONResponse(jsonContent);

        // Validate the JSON
        const validationResult = validateWorkflowJSON(jsonContent);
        
        if (validationResult.valid) {
            return validationResult.json;
        } else {
            console.warn(`JSON validation failed (attempt ${retryCount + 1}):`, validationResult.error);
            
            if (retryCount < MAX_RETRIES) {
                // Show retry message to user
                addMessage('assistant', `⚠️ **Fixing JSON structure...** (Attempt ${retryCount + 1}/${MAX_RETRIES})\n\nThe generated JSON had syntax issues. Automatically retrying with corrections...`, false, null, false);

                // Wait a moment and retry
                await new Promise(resolve => setTimeout(resolve, 1000));
                return generateWorkflowJSON(workflowDesign, retryCount + 1);
            } else {
                // Max retries reached
                return null;
            }
        }

    } catch (error) {
        console.error('Error calling Claude 4.5 Sonnet:', error);

        if (retryCount < MAX_RETRIES) {
            addMessage('assistant', `⚠️ **Connection issue, retrying...** (Attempt ${retryCount + 1}/${MAX_RETRIES})\n\nHaving trouble connecting to the AI service. Retrying automatically...`, false, null, false);
            await new Promise(resolve => setTimeout(resolve, 2000));
            return generateWorkflowJSON(workflowDesign, retryCount + 1);
        }
        
        throw error;
    }
}

// Clean up JSON response from Claude
function cleanupJSONResponse(response) {
    // Remove markdown code blocks
    let cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    
    // Remove any leading/trailing whitespace
    cleaned = cleaned.trim();
    
    // Look for the first { and last } to extract just the JSON
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    
    if (firstBrace !== -1 && lastBrace !== -1) {
        cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }
    
    return cleaned;
}

// Validate workflow JSON
function validateWorkflowJSON(jsonString) {
    try {
        const parsed = JSON.parse(jsonString);
        
        // Basic validation of n8n workflow structure
        if (!parsed.name || !parsed.nodes || !parsed.connections) {
            return {
                valid: false,
                error: 'Missing required fields: name, nodes, or connections'
            };
        }
        
        if (!Array.isArray(parsed.nodes)) {
            return {
                valid: false,
                error: 'nodes must be an array'
            };
        }
        
        return {
            valid: true,
            json: parsed
        };
        
    } catch (error) {
        return {
            valid: false,
            error: `JSON parse error: ${error.message}`
        };
    }
}

// Add download button for the generated workflow JSON
function addDownloadButton(jsonWorkflow) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';

    const downloadContainer = document.createElement('div');
    downloadContainer.className = 'build-it-container';
    
    const description = document.createElement('div');
    description.className = 'build-it-description';
    description.innerHTML = `📁 <strong>Your n8n workflow is ready!</strong><br>Click below to download the JSON file and import it into your n8n instance.`;
    
    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'build-it-btn';
    downloadBtn.textContent = "Download Workflow JSON 📥";
    downloadBtn.style.background = 'linear-gradient(135deg, #059669 0%, #10b981 50%, #34d399 100%)';
    
    // Add click event listener for download
    downloadBtn.addEventListener('click', () => {
        downloadWorkflowJSON(jsonWorkflow);
    });
    
    downloadContainer.appendChild(description);
    downloadContainer.appendChild(downloadBtn);

    messageDiv.appendChild(downloadContainer);
    
    chatMessages.appendChild(messageDiv);
    
    // Auto-scroll to show download button
    setTimeout(() => {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }, 100);
}

// Download workflow JSON as file
function downloadWorkflowJSON(jsonWorkflow) {
    try {
        // Create filename with timestamp
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-');
        const filename = `n8n-workflow-${timestamp}.json`;
        
        // Convert to JSON string with proper formatting
        const jsonString = JSON.stringify(jsonWorkflow, null, 2);
        
        // Create blob and download
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.style.display = 'none';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Clean up the URL object
        URL.revokeObjectURL(url);
        
        // Show success message
        addMessage('assistant', `✅ **Download successful!**\n\nYour workflow JSON has been downloaded as \`${filename}\`. You can now import this file into your n8n instance by going to: **Workflows → Import from File** and selecting the downloaded JSON file.`, false, null, true);

    } catch (error) {
        console.error('Error downloading JSON:', error);
        addMessage('assistant', `❌ **Download failed**\n\nThere was an error downloading the file: ${error.message}. Please try again.`, false, null, true);
    }
}


// Handle voice input with Deepgram Nova-3 via WebSocket proxy
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

// Set recording state and update UI
function setRecordingState(recording, button, input) {
    isRecording = recording;

    const micIconSVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" fill="currentColor" class="mic-icon"><path d="M192 0C139 0 96 43 96 96V256c0 53 43 96 96 96s96-43 96-96V96c0-53-43-96-96-96zM64 216c0-13.3-10.7-24-24-24s-24 10.7-24 24v40c0 89.1 66.2 162.7 152 174.4V464H120c-13.3 0-24 10.7-24 24s10.7 24 24 24h72 72c13.3 0 24-10.7 24-24s-10.7-24-24-24H216V430.4c85.8-11.7 152-85.3 152-174.4V216c0-13.3-10.7-24-24-24s-24 10.7-24 24v40c0 70.7-57.3 128-128 128s-128-57.3-128-128V216z"/></svg>';

    if (recording) {
        button.classList.add('recording');
        button.title = "Recording... Click again to stop";

        // Find the button group and add recording indicator there
        const wrapper = input.parentElement;
        const buttonGroup = wrapper.querySelector('.button-group') || wrapper.querySelector('.chat-button-group');
        const existingIndicator = buttonGroup?.querySelector('.recording-indicator');

        if (!existingIndicator && buttonGroup) {
            const indicator = document.createElement('div');
            indicator.className = 'recording-indicator';
            indicator.innerHTML = `${micIconSVG}<span>Listening... Speak now!</span>`;

            // Insert at the beginning of button group (left-aligned)
            buttonGroup.insertBefore(indicator, buttonGroup.firstChild);

            console.log('✅ Badge added to button group:', buttonGroup);

            // Hide indicator when text starts appearing
            const handleInput = () => {
                if (input.value.trim().length > 0) {
                    indicator.classList.add('hidden');
                } else {
                    indicator.classList.remove('hidden');
                }
            };

            input.addEventListener('input', handleInput);
            // Store handler for cleanup
            input._recordingInputHandler = handleInput;
        }

        input.placeholder = "";
        input.style.borderColor = '#dc2626';
        input.style.backgroundColor = 'rgba(220, 38, 38, 0.05)';

        // Keep the same microphone icon (CSS will change appearance via .recording class)
        button.innerHTML = micIconSVG;
    } else {
        button.classList.remove('recording');
        button.title = "Click to start voice input";

        // Remove recording indicator and event listener
        const wrapper = input.parentElement;
        const buttonGroup = wrapper.querySelector('.button-group') || wrapper.querySelector('.chat-button-group');
        if (buttonGroup) {
            const existingIndicator = buttonGroup.querySelector('.recording-indicator');
            if (existingIndicator) {
                existingIndicator.remove();
                console.log('✅ Badge removed from button group');
            }
        }
        if (input._recordingInputHandler) {
            input.removeEventListener('input', input._recordingInputHandler);
            delete input._recordingInputHandler;
        }

        // Reset placeholder based on context
        if (input === userInput) {
            input.placeholder = "What are you trying to automate?";
        } else {
            input.placeholder = "Type your message...";
        }

        input.style.borderColor = '';
        input.style.backgroundColor = '';

        // Use the same microphone icon
        button.innerHTML = micIconSVG;
    }
}

// Get system prompt based on current stage
function getSystemPrompt() {
    const basePrompt = `You are an expert workflow automation consultant specializing in n8n workflows. Your goal is to help users plan and design automation workflows through collaborative dialogue. Always be friendly, encouraging, and educational.`;
    
    const designPrinciples = `
Key n8n design principles to follow:
- Use descriptive node names that explain their function
- Prefer Switch nodes over IF nodes for conditional logic
- Start with cheaper AI models before expensive ones
- Implement retry logic (3-5 retries with delays) for external APIs
- Use centralized configuration nodes early in workflows
- Group related fields using dot notation
- Build in human oversight for critical decisions`;
    
    if (currentStage === 'initial') {
        return `${basePrompt}

The user has just described what they want to automate.

**CRITICAL CONSTRAINTS:**
- DO NOT mention JSON workflow generation or n8n JSON exports
- DO NOT offer to build or generate workflow JSON files
- Focus ONLY on understanding requirements and asking clarifying questions
- JSON workflow generation happens ONLY after the diagram stage

You need to ask 2-3 clarifying questions to better understand their needs. Focus on:
1. What specific systems or tools they're currently using
2. Whether these systems have APIs or integration capabilities
3. The current manual process they follow
4. The expected volume and frequency of the workflow

Be conversational but concise. After the user provides this information, you'll help them create a detailed workflow diagram.

${designPrinciples}`;
    } else if (currentStage === 'clarifying') {
        return `${basePrompt}

Continue gathering information about the user's workflow needs. After this response, you should have enough information to provide a design proposal.

**CRITICAL CONSTRAINTS:**
- DO NOT mention JSON workflow generation or n8n JSON exports
- DO NOT offer to build or generate workflow JSON files
- Focus ONLY on gathering remaining requirements
- JSON workflow generation happens ONLY after the diagram stage

IMPORTANT: After this round, provide a clear, concise design proposal describing:
1. The overall workflow architecture
2. Key steps and decision points
3. Systems/integrations involved
4. Data flow between steps

DO NOT create a mermaid diagram yet - just describe the design in clear text. The system will show the user a "Diagram it" button after your response.

${designPrinciples}`;
    } else if (currentStage === 'design_proposed') {
        return `${basePrompt}

The user has requested changes to the workflow design. Listen carefully to their feedback and provide an updated design proposal in text.

**CRITICAL CONSTRAINTS:**
- DO NOT mention JSON workflow generation or n8n JSON exports
- DO NOT offer to build or generate workflow JSON files
- Focus ONLY on design improvements and clarifications
- JSON workflow generation happens ONLY after the diagram stage

Describe:
1. What changed based on their feedback
2. The updated workflow architecture
3. Key steps and decision points
4. Systems/integrations involved
5. Data flow between steps

DO NOT create a mermaid diagram - just describe the updated design. The system will show options to proceed.

${designPrinciples}`;
    } else if (currentStage === 'ready_for_diagram' || currentStage === 'diagram_generated') {
        return `${basePrompt}

Based on the conversation so far, create a detailed Mermaid diagram showing the workflow the user wants to automate.

CRITICAL MERMAID SYNTAX RULES - FOLLOW EXACTLY:
1. Node IDs: Use ONLY letters and numbers (A, B, Step1, Fetch2) - NO spaces, hyphens, or special characters
2. Node Labels: Use ONLY simple plain text - NO parentheses (), hyphens -, colons :, commas, ampersands &, or special characters
3. Node shapes: [text] for rectangles, {text} for diamonds
4. Arrows: Use ONLY --> for connections (avoid other arrow types)
5. Edge labels: Use |text| format for labels on arrows

FORBIDDEN IN LABELS (will cause parse errors):
- Parentheses: (retry) ❌
- Hyphens: HTTP-Request ❌
- Colons: 5s:10s ❌
- Commas: item1, item2 ❌
- Ampersands: save & notify ❌
- Quotes: "text" ❌

CORRECT EXAMPLES:
- A[Fetch Orders] ✅
- B[HTTP Request with Retry] ✅
- C{Has New Data} ✅
- D[Send Slack Message] ✅

WRONG EXAMPLES (NEVER DO THIS):
- A[HTTP Request - List Orders] ❌ (hyphen)
- B[Retry (3x)] ❌ (parentheses)
- C[Wait 5s, then continue] ❌ (comma)
- D[Save & Notify] ❌ (ampersand)

The diagram should:
1. Show all major steps in the process
2. Include decision points and branches
3. Indicate which systems/APIs are involved at each step
4. Use clear, descriptive labels
5. Follow n8n best practices

CORRECT EXAMPLE:
\`\`\`mermaid
graph TD
    Start[Daily Trigger] --> Fetch[Fetch YouTube Data]
    Fetch --> Check{New Videos?}
    Check -->|Yes| Process[Process Video Data]
    Check -->|No| End1[End Workflow]
    Process --> Save[Save to Database]
    Save --> Notify[Send Notification]
    Notify --> End2[End Workflow]
\`\`\`

AVOID THESE COMMON ERRORS:
- Don't use undefined node IDs
- Don't use spaces in node IDs (use Step1 not "Step 1")
- Don't forget to close brackets/braces
- Don't use special characters in IDs

${designPrinciples}`;
    }
    
    return basePrompt;
}

// State preservation for MCP toggle
function saveStateForToggle() {
    try {
        const state = {
            conversationHistory,
            currentStage,
            clarificationCount,
            diagramCount,
            // currentSessionId removed - not used in app-original.js
            chatHTML: document.getElementById('chatMessages')?.innerHTML || '',
            chatVisible: document.getElementById('chatInterface')?.style.display !== 'none',
            timestamp: Date.now()
        };
        localStorage.setItem('mcpToggleState', JSON.stringify(state));
        console.log('💾 State saved for toggle:', state.conversationHistory.length, 'messages');

        // Save input field values separately for persistence across reload
        // First, clear any old values
        localStorage.removeItem('workflowPlanner_mainInput');
        localStorage.removeItem('workflowPlanner_chatInput');
        localStorage.removeItem('workflowPlanner_restoreInputs');

        let hasInputToRestore = false;

        const mainInput = document.getElementById('userInput');
        if (mainInput && mainInput.value.trim()) {
            localStorage.setItem('workflowPlanner_mainInput', mainInput.value);
            console.log('💾 Saved main input:', mainInput.value.substring(0, 50) + '...');
            hasInputToRestore = true;
        }

        const chatInputEl = document.getElementById('chatInput');
        if (chatInputEl && chatInputEl.value.trim()) {
            localStorage.setItem('workflowPlanner_chatInput', chatInputEl.value);
            console.log('💾 Saved chat input:', chatInputEl.value.substring(0, 50) + '...');
            hasInputToRestore = true;
        }

        // Only set flag to restore inputs if there's something to restore
        if (hasInputToRestore) {
            localStorage.setItem('workflowPlanner_restoreInputs', 'true');
            console.log('✅ State saved for MCP toggle (with inputs)');
        } else {
            console.log('✅ State saved for MCP toggle (no inputs to restore)');
        }
    } catch (err) {
        console.error('❌ Failed to save state:', err);
    }
}

function restoreStateFromToggle() {
    let restoredConversation = false;

    // DEBUG: Log localStorage state on restore attempt
    console.log('🔍 DEBUG: Checking localStorage for input restoration...');
    console.log('  - workflowPlanner_restoreInputs:', localStorage.getItem('workflowPlanner_restoreInputs'));
    console.log('  - workflowPlanner_mainInput:', localStorage.getItem('workflowPlanner_mainInput'));
    console.log('  - workflowPlanner_chatInput:', localStorage.getItem('workflowPlanner_chatInput'));

    // First, always check for input restoration (independent of conversation state)
    const shouldRestoreInputs = localStorage.getItem('workflowPlanner_restoreInputs') === 'true';
    if (shouldRestoreInputs) {
        console.log('🔄 Restoring inputs after MCP toggle...');

        const mainInputValue = localStorage.getItem('workflowPlanner_mainInput') || '';
        const chatInputValue = localStorage.getItem('workflowPlanner_chatInput') || '';

        // Restore main input
        const mainInput = document.getElementById('userInput');
        if (mainInput && mainInputValue) {
            mainInput.value = mainInputValue;
            console.log('✅ Restored main input:', mainInputValue.substring(0, 50) + '...');
            mainInput.focus();
            mainInput.setSelectionRange(mainInput.value.length, mainInput.value.length);
        }

        // Restore chat input
        const chatInputEl = document.getElementById('chatInput');
        if (chatInputEl && chatInputValue) {
            chatInputEl.value = chatInputValue;
            console.log('✅ Restored chat input:', chatInputValue.substring(0, 50) + '...');
            if (!mainInputValue) {
                chatInputEl.focus();
                chatInputEl.setSelectionRange(chatInputEl.value.length, chatInputEl.value.length);
            }
        }

        // Clear input restoration data (self-cleaning)
        localStorage.removeItem('workflowPlanner_mainInput');
        localStorage.removeItem('workflowPlanner_chatInput');
        localStorage.removeItem('workflowPlanner_restoreInputs');
        console.log('✅ Input restoration complete');
    }

    // Now check for conversation state restoration
    const saved = localStorage.getItem('mcpToggleState');
    if (!saved) return shouldRestoreInputs; // Return true if we restored inputs

    try {
        const state = JSON.parse(saved);

        // Only restore if recent (within 5 seconds)
        if (Date.now() - state.timestamp > 5000) {
            localStorage.removeItem('mcpToggleState');
            return shouldRestoreInputs;
        }

        // Restore state
        conversationHistory = state.conversationHistory || [];
        currentStage = state.currentStage || 'initial';
        clarificationCount = state.clarificationCount || 0;
        diagramCount = state.diagramCount || 0;
        // currentSessionId removed - not used in app-original.js

        // Restore chat UI
        if (state.chatVisible && state.chatHTML) {
            const chatInterface = document.getElementById('chatInterface');
            const inputSection = document.querySelector('.input-section');
            const chatMessages = document.getElementById('chatMessages');

            if (chatInterface && inputSection && chatMessages) {
                chatInterface.style.display = 'flex';
                inputSection.style.display = 'none';
                chatMessages.innerHTML = state.chatHTML;
            }
        }

        // Clear saved state
        localStorage.removeItem('mcpToggleState');
        console.log('✅ State restored:', conversationHistory.length, 'messages');
        restoredConversation = true;
    } catch (e) {
        console.error('Failed to restore state:', e);
        localStorage.removeItem('mcpToggleState');
    }

    return restoredConversation || shouldRestoreInputs;
}

function reattachChatEventListeners() {
    // Re-attach diagram modal handlers
    document.querySelectorAll('.view-diagram-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const diagramCode = btn.dataset.diagram;
            if (diagramCode) openDiagramModal(decodeURIComponent(diagramCode));
        });
    });

    // Re-attach retry buttons
    document.querySelectorAll('.retry-diagram-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const encoded = btn.dataset.diagram;
            const container = btn.closest('.diagram-container');
            if (encoded && container) retryDiagramManually(encoded, container);
        });
    });

    // Re-attach "Explain Design" and "Build It" buttons
    document.querySelectorAll('.explain-design-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const diagramCode = btn.dataset.diagram;
            if (diagramCode) addEducationalExplanation(decodeURIComponent(diagramCode));
        });
    });

    document.querySelectorAll('.build-it-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            handleBuildItClick();
        });
    });

    // Re-attach "Request Changes" button
    document.querySelectorAll('#requestChangesBtn').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.disabled = true;
            const inputField = document.getElementById('chatInput');
            if (inputField) {
                inputField.placeholder = "Describe the changes you'd like to make...";
                inputField.focus();
            }
            const messageDiv = btn.closest('.message.assistant');
            if (messageDiv) messageDiv.remove();
        });
    });

    // Re-attach "Diagram it" button
    document.querySelectorAll('#diagramItBtn').forEach(btn => {
        btn.addEventListener('click', () => {
            const changesBtn = document.getElementById('requestChangesBtn');
            if (changesBtn) changesBtn.disabled = true;
            btn.disabled = true;
            btn.textContent = 'Creating diagram... 🎨';
            const messageDiv = btn.closest('.message.assistant');
            if (messageDiv) messageDiv.remove();
            handleDiagramItClick();
        });
    });

    // Re-attach download button if present
    document.querySelectorAll('.download-workflow-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const workflowData = btn.dataset.workflow;
            if (workflowData) {
                try {
                    const workflow = JSON.parse(decodeURIComponent(workflowData));
                    downloadWorkflowJSON(workflow);
                } catch (e) {
                    console.error('Failed to parse workflow data:', e);
                }
            }
        });
    });
}

// Expose for index.html toggle handler
window.saveStateForToggle = saveStateForToggle;

// App initialization function
function initializeApp() {
    console.log('🚀 Initializing app-original.js...');

    // Try to restore state from toggle
    const wasToggle = restoreStateFromToggle();

    if (wasToggle) {
        console.log('🔄 Restored from MCP toggle');
        // Re-attach event listeners to restored chat elements
        reattachChatEventListeners();
    } else {
        // Normal initialization
        userInput.focus();
    }

    // Set up marked options for better formatting
    marked.setOptions({
        breaks: true,
        gfm: true
    });

    // MCP toggle button handler - NOW HANDLED IN index.html
    // Button state and click handling consolidated in index.html to avoid conflicts
}

// Handle both cases: DOM already ready OR waiting for it
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    // DOM already ready, run immediately
    initializeApp();
}
