const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');

// Load environment variables
function loadEnv() {
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
        const envFile = fs.readFileSync(envPath, 'utf8');
        const envVars = {};
        envFile.split('\n').forEach(line => {
            if (line.trim() && !line.startsWith('#')) {
                const [key, ...values] = line.split('=');
                envVars[key.trim()] = values.join('=').trim().replace(/^['"]|['"]$/g, '');
            }
        });
        return envVars;
    }
    return {};
}

const env = loadEnv();
const PORT = process.env.PORT || 8099;

// Initialize Supabase client (optional)
let supabase = null;
if ((env.SUPABASE_URL || process.env.SUPABASE_URL) && 
    (env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY)) {
    supabase = createClient(
        env.SUPABASE_URL || process.env.SUPABASE_URL,
        env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
    );
    console.log('✅ Supabase client initialized');
} else {
    console.log('⚠️  Supabase not configured - database features disabled');
}

// ============================================================================
// OpenAI Tool Calling Helper Functions
// ============================================================================

/**
 * Build OpenAI tools schema from MCP tools
 */
async function buildOpenAIToolsSchema() {
    try {
        // Fetch from our own /api/mcp/tools endpoint
        const response = await fetch('http://localhost:8099/api/mcp/tools');
        const mcpResult = await response.json();

        if (mcpResult.error) {
            console.error('⚠️  Failed to fetch MCP tools:', mcpResult.error);
            return [];
        }

        // Convert to OpenAI tool format
        return mcpResult.tools.map(tool => ({
            type: "function",
            function: {
                name: tool.name,
                description: tool.description || "",
                parameters: tool.inputSchema || {
                    type: "object",
                    properties: {},
                    required: []
                }
            }
        }));
    } catch (error) {
        console.error('⚠️  Error building OpenAI tools schema:', error.message);
        return [];
    }
}

/**
 * Extract tool calls from OpenAI response
 */
function extractToolCalls(openaiResponse) {
    const toolCalls = [];

    try {
        if (!openaiResponse.output || !Array.isArray(openaiResponse.output)) {
            return toolCalls;
        }

        for (const item of openaiResponse.output) {
            // Look for tool_call items in the output array
            if (item.type === 'tool_call') {
                toolCalls.push({
                    id: item.id,
                    name: item.name,
                    arguments: typeof item.arguments === 'string'
                        ? JSON.parse(item.arguments)
                        : item.arguments
                });
            }
        }
    } catch (error) {
        console.error('⚠️  Error extracting tool calls:', error.message);
    }

    return toolCalls;
}

/**
 * Execute MCP tool calls
 */
async function executeMcpToolCalls(toolCalls, phase = 'chat') {
    const results = [];

    for (const toolCall of toolCalls) {
        try {
            console.log(`🔧 Executing tool: ${toolCall.name}`);

            const response = await fetch('http://localhost:8099/api/mcp/call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tool: toolCall.name,
                    arguments: toolCall.arguments,
                    phase: phase
                })
            });

            const result = await response.json();

            if (result.error) {
                console.error(`❌ Tool execution failed: ${result.error}`);
                results.push({
                    id: toolCall.id,
                    name: toolCall.name,
                    arguments: toolCall.arguments,
                    error: result.error,
                    result: null
                });
            } else {
                console.log(`✅ Tool executed successfully: ${toolCall.name}`);
                results.push({
                    id: toolCall.id,
                    name: toolCall.name,
                    arguments: toolCall.arguments,
                    result: result,
                    error: null
                });
            }
        } catch (error) {
            console.error(`❌ Tool execution error: ${error.message}`);
            results.push({
                id: toolCall.id,
                name: toolCall.name,
                arguments: toolCall.arguments,
                error: error.message,
                result: null
            });
        }
    }

    return results;
}

/**
 * Format search_nodes tool result for AI consumption
 * Converts raw JSON to plain text list of nodes
 */
function formatSearchNodesResult(result) {
    if (!result) {
        return 'No results found.';
    }

    let nodes;

    // Handle MCP response format: result.content[0].text contains JSON string
    if (result.content && Array.isArray(result.content) && result.content[0]?.text) {
        try {
            const parsedText = JSON.parse(result.content[0].text);
            nodes = parsedText.results || parsedText.data;
        } catch (e) {
            // If parsing fails, try direct data access
            nodes = result.data;
        }
    } else {
        // Direct data access
        nodes = result.data;
    }

    if (!nodes) {
        return 'No results found.';
    }

    if (!Array.isArray(nodes)) {
        return `Search returned: ${JSON.stringify(nodes).substring(0, 200)}...`;
    }

    if (nodes.length === 0) {
        return 'No results found.';
    }

    // Convert to plain text summary
    const summary = nodes.slice(0, 10).map((node, index) => {
        return `${index + 1}. ${node.displayName || node.name} (${node.nodeType})
Description: ${node.description || 'No description'}
${node.category ? `Category: ${node.category}` : ''}`;
    }).join('\n\n');

    const totalCount = nodes.length;
    const displayCount = Math.min(nodes.length, 10);

    return `Found ${totalCount} node(s). Showing ${displayCount}:\n\n${summary}${totalCount > 10 ? `\n...and ${totalCount - 10} more.` : ''}`;
}

/**
 * Format get_node tool result for AI consumption
 * Converts raw JSON to plain text node summary
 */
function formatGetNodeResult(result) {
    if (!result) {
        return 'Node not found.';
    }

    let node;

    // Handle MCP response format: result.content[0].text contains JSON string
    if (result.content && Array.isArray(result.content) && result.content[0]?.text) {
        try {
            const parsedText = JSON.parse(result.content[0].text);
            node = parsedText.node || parsedText.data;
        } catch (e) {
            // If parsing fails, try direct data access
            node = result.data;
        }
    } else {
        // Direct data access
        node = result.data;
    }

    if (!node) {
        return 'Node not found.';
    }

    // Extract key information as plain text
    const summary = [
        `Node: ${node.displayName || node.name}`,
        `Type: ${node.nodeType}`,
        `Description: ${node.description || 'No description'}`,
    ];

    if (node.category) {
        summary.push(`Category: ${node.category}`);
    }

    if (node.operations && node.operations.length > 0) {
        summary.push(`Operations: ${node.operations.slice(0, 5).join(', ')}${node.operations.length > 5 ? '...' : ''}`);
    }

    if (node.package) {
        summary.push(`Package: ${node.package}`);
    }

    return summary.join('\n');
}

/**
 * Format Context7 tool results for AI consumption
 * Converts documentation/library results to plain text summary
 */
function formatContext7Result(result, toolName) {
    if (!result) {
        return 'No information found.';
    }

    let data;

    // Handle MCP response format: result.content[0].text contains JSON string
    if (result.content && Array.isArray(result.content) && result.content[0]?.text) {
        try {
            const parsedText = JSON.parse(result.content[0].text);
            data = parsedText.data || parsedText;
        } catch (e) {
            // If parsing fails, try direct data access
            data = result.data;
        }
    } else {
        // Direct data access
        data = result.data;
    }

    if (!data) {
        return 'No information found.';
    }

    // Handle different Context7 response formats
    if (toolName === 'resolve-library-id') {
        if (data.id) {
            return `Library resolved to: ${data.id}${data.description ? `\nDescription: ${data.description}` : ''}`;
        }
        return `Library found: ${JSON.stringify(data).substring(0, 200)}...`;
    }

    if (toolName === 'query-docs') {
        if (data.content || data.answer) {
            const content = data.content || data.answer;
            // Truncate very long responses
            return typeof content === 'string'
                ? content.substring(0, 1000) + (content.length > 1000 ? '...' : '')
                : JSON.stringify(content).substring(0, 500) + '...';
        }
        return `Documentation: ${JSON.stringify(data).substring(0, 300)}...`;
    }

    // Generic fallback
    return `Information found: ${JSON.stringify(data).substring(0, 300)}...`;
}

/**
 * Format tool result for AI consumption
 * Routes to appropriate formatter based on tool name
 */
function formatToolResultForAI(toolName, toolResult) {
    // Handle errors
    if (toolResult.error) {
        return `Error calling ${toolName}: ${toolResult.error}`;
    }

    // Handle empty results
    if (!toolResult.result) {
        return `No result from ${toolName}`;
    }

    const result = toolResult.result;

    // Route to appropriate formatter
    if (toolName === 'search_nodes') {
        return formatSearchNodesResult(result);
    }

    if (toolName === 'get_node') {
        return formatGetNodeResult(result);
    }

    if (toolName.includes('resolve-library-id') || toolName.includes('query-docs')) {
        return formatContext7Result(result, toolName);
    }

    // Generic fallback for unknown tools
    try {
        const jsonStr = JSON.stringify(result);
        if (jsonStr.length < 500) {
            return `Tool result: ${jsonStr}`;
        }
        return `Tool result received (data too large to display)`;
    } catch (e) {
        return `Tool result received (could not format)`;
    }
}

/**
 * Continue conversation with tool results
 */
async function continueConversationWithToolResults(
    originalRequest,
    toolResults,
    openaiApiKey,
    systemPrompt,
    conversationHistory
) {
    return new Promise((resolve, reject) => {
        const https = require('https');

        // Build messages array with tool calls and tool responses
        const messages = [
            { role: 'system', content: systemPrompt },
            ...conversationHistory,
            // Add assistant message with tool calls
            {
                role: 'assistant',
                content: null,
                tool_calls: toolResults.map(tr => ({
                    id: tr.id,
                    type: 'function',
                    function: {
                        name: tr.name,
                        arguments: JSON.stringify(tr.arguments)
                    }
                }))
            }
        ];

        // Add tool response messages
        toolResults.forEach(tr => {
            // Format tool result as plain text instead of raw JSON
            const content = formatToolResultForAI(tr.name, tr);

            messages.push({
                role: 'tool',
                tool_call_id: tr.id,
                content: content
            });
        });

        // Build request body with tool results
        const requestBody = {
            model: 'gpt-5-nano-2025-08-07',
            messages: messages,
            max_completion_tokens: 4000,
            tools: originalRequest.tools
        };

        const requestBodyStr = JSON.stringify(requestBody);

        const options = {
            hostname: 'api.openai.com',
            port: 443,
            path: '/v1/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openaiApiKey}`,
                'Content-Length': Buffer.byteLength(requestBodyStr)
            }
        };

        console.log('📤 Sending tool results back to OpenAI...');

        const openaiReq = https.request(options, (openaiRes) => {
            let responseData = '';
            openaiRes.on('data', chunk => responseData += chunk);
            openaiRes.on('end', () => {
                console.log('📡 OpenAI follow-up response status:', openaiRes.statusCode);
                try {
                    resolve(JSON.parse(responseData));
                } catch (e) {
                    reject(new Error('Failed to parse OpenAI response'));
                }
            });
        });

        openaiReq.on('error', reject);
        openaiReq.write(requestBodyStr);
        openaiReq.end();
    });
}

// ============================================================================
// HTTP Server
// ============================================================================

const server = http.createServer((req, res) => {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // SECURITY: Block access to .env file - API keys are server-side only
    if (req.url === '/.env' || req.url.includes('.env')) {
        console.log('🔒 Blocked attempt to access .env file');
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden - API keys are managed server-side');
        return;
    }

    // Handle MCP list tools
    if (req.url === '/api/mcp/tools' && req.method === 'GET') {
        return (async () => {
            try {
const mod = await import('./api/mcp-client.mjs');
                const result = await mod.listTools({ budgetMs: 5000 });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'mcp_list_failed', details: String(e && e.message ? e.message : e) }));
            }
        })();
    }

    // Handle MCP call tool
    if (req.url === '/api/mcp/call' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const { tool, arguments: args, phase } = JSON.parse(body || '{}');
                if (!tool) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'missing_tool' }));
                    return;
                }
                const mod = await import('./api/mcp-client.mjs');
                const result = await mod.callTool({ fqName: tool, args: args || {}, phase: phase || 'chat' });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'mcp_call_failed', details: String(e && e.message ? e.message : e) }));
            }
        });
        return;
    }

    // Handle Deepgram token generation
    if (req.url === '/api/deepgram/token' && req.method === 'POST') {
        const deepgramApiKey = env.DEEPGRAM_API_KEY || process.env.DEEPGRAM_API_KEY;

        if (!deepgramApiKey) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'DEEPGRAM_API_KEY not configured' }));
            return;
        }

        const tokenRequest = JSON.stringify({ ttl_seconds: 60 });
        const options = {
            hostname: 'api.deepgram.com',
            port: 443,
            path: '/v1/auth/grant',
            method: 'POST',
            headers: {
                'Authorization': `Token ${deepgramApiKey}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(tokenRequest)
            }
        };

        const deepgramReq = https.request(options, (deepgramRes) => {
            let responseData = '';
            deepgramRes.on('data', chunk => responseData += chunk);
            deepgramRes.on('end', () => {
                res.writeHead(deepgramRes.statusCode, { 'Content-Type': 'application/json' });
                res.end(responseData);
            });
        });

        deepgramReq.on('error', (error) => {
            console.error('Deepgram token error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to generate Deepgram token', details: error.message }));
        });

        deepgramReq.write(tokenRequest);
        deepgramReq.end();
        return;
    }

    // Handle database API endpoints
    if (req.url.startsWith('/api/db/') && req.method === 'POST') {
        handleDatabaseAPI(req, res);
        return;
    }

    // Handle Claude proxy
    if (req.url === '/api/claude-proxy' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            try {
                const requestData = JSON.parse(body);
                const { system, userPrompt } = requestData;

                // SECURITY: Use server-side API key instead of client-provided key
                const anthropicApiKey = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;

                console.log('🔥 Proxy received Claude API request:', {
                    systemLength: system?.length || 0,
                    userPromptLength: userPrompt?.length || 0,
                    hasServerKey: !!anthropicApiKey
                });

                // Validate server-side API key exists
                if (!anthropicApiKey) {
                    console.log('❌ ANTHROPIC_API_KEY not configured on server');
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        error: 'ANTHROPIC_API_KEY not configured on server'
                    }));
                    return;
                }

                // Validate required request fields
                if (!system || !userPrompt) {
                    console.log('❌ Missing required fields in Claude request');
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        error: 'Missing required fields: system, userPrompt'
                    }));
                    return;
                }

                // Prepare Claude API request
                const claudeRequest = JSON.stringify({
                    model: 'claude-sonnet-4-5',
                    max_tokens: 64000,
                    system: system,
                    messages: [{
                        role: 'user',
                        content: userPrompt
                    }],
                    temperature: 0.1
                });

                const options = {
                    hostname: 'api.anthropic.com',
                    port: 443,
                    path: '/v1/messages',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': anthropicApiKey,
                        'anthropic-version': '2023-06-01',
                        'Content-Length': Buffer.byteLength(claudeRequest)
                    }
                };

                const claudeReq = https.request(options, (claudeRes) => {
                    let responseData = '';
                    claudeRes.on('data', chunk => {
                        responseData += chunk;
                    });

                    claudeRes.on('end', () => {
                        console.log('📡 Claude API response status:', claudeRes.statusCode);
                        if (claudeRes.statusCode === 200) {
                            try {
                                const parsedResponse = JSON.parse(responseData);
                                console.log('📋 Claude API response data:', {
                                    contentItems: parsedResponse.content?.length || 0,
                                    responseLength: parsedResponse.content?.[0]?.text?.length || 0
                                });
                            } catch (e) {
                                console.log('📋 Claude API response (unparseable):', responseData.substring(0, 200));
                            }
                        } else {
                            console.log('❌ Claude API error response:', responseData.substring(0, 500));
                        }
                        res.writeHead(claudeRes.statusCode, { 'Content-Type': 'application/json' });
                        res.end(responseData);
                    });
                });

                claudeReq.on('error', (error) => {
                    console.error('Claude API error:', error);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        error: 'Failed to call Claude API',
                        details: error.message
                    }));
                });

                claudeReq.write(claudeRequest);
                claudeReq.end();

            } catch (error) {
                console.error('Proxy error:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: 'Internal server error',
                    details: error.message
                }));
            }
        });
        return;
    }

    // OpenAI API Proxy (GPT-5 Nano)
    if (req.url === '/api/openai-proxy' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
            const { systemPrompt, conversationHistory, stage, useMcpTools } = JSON.parse(body);

                // SECURITY: Use server-side API key instead of client-provided key
                const openaiApiKey = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY;

                // Validate server-side API key exists
                if (!openaiApiKey) {
                    console.log('❌ OPENAI_API_KEY not configured on server');
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        error: 'OPENAI_API_KEY not configured on server'
                    }));
                    return;
                }

                // Validate required request fields
                if (!systemPrompt || !conversationHistory) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        error: 'Missing required fields: systemPrompt or conversationHistory'
                    }));
                    return;
                }

                // Check if MCP tools should be used (default true for backward compatibility)
                const shouldUseMcp = useMcpTools !== false;

                // Log request (without key)
                console.log('🔥 Proxy received OpenAI API request:', {
                    systemPromptLength: systemPrompt?.length || 0,
                    conversationLength: conversationHistory?.length || 0,
                    hasServerKey: !!openaiApiKey,
                    stage: stage || 'unknown',
                    useMcpTools: shouldUseMcp
                });

                // Build tools schema only if MCP is enabled
                let tools = [];
                if (shouldUseMcp) {
                    console.log('🔧 Building OpenAI tools schema from MCP...');
                    tools = await buildOpenAIToolsSchema();
                    console.log(`✅ Loaded ${tools.length} tools for OpenAI`);
                } else {
                    console.log('⚠️ MCP tools disabled by client request');
                }

                // Debug: Log first tool structure
                if (tools.length > 0) {
                    console.log('🔍 First tool structure:', JSON.stringify(tools[0], null, 2).substring(0, 300));
                }

                // Determine tool_choice based on stage
                // - "required": Forces tool call (initial/clarifying stages where verification matters)
                // - "auto": Model decides (other stages, or when no tools available)
                const requireToolStages = ['initial', 'clarifying'];
                const shouldRequireTools = tools.length > 0 && requireToolStages.includes(stage);
                const toolChoice = tools.length > 0
                    ? (shouldRequireTools ? "required" : "auto")
                    : undefined;

                console.log(`🎯 Stage: ${stage || 'unknown'}, tool_choice: ${toolChoice || 'none'}`);

                // Build OpenAI request body WITH tools
                // Convert conversation history to messages format
                const messages = [
                    { role: 'system', content: systemPrompt },
                    ...conversationHistory
                ];

                const requestBody = {
                    model: 'gpt-5-nano-2025-08-07',
                    messages: messages,
                    max_completion_tokens: 8000,
                    tools: tools.length > 0 ? tools : undefined,
                    tool_choice: toolChoice
                };

                // Make HTTPS request to OpenAI
                const https = require('https');
                const requestBodyStr = JSON.stringify(requestBody);

                const options = {
                    hostname: 'api.openai.com',
                    port: 443,
                    path: '/v1/chat/completions',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${openaiApiKey}`,
                        'Content-Length': Buffer.byteLength(requestBodyStr)
                    }
                };

                const openaiReq = https.request(options, async (openaiRes) => {
                    let responseData = '';
                    openaiRes.on('data', chunk => responseData += chunk);
                    openaiRes.on('end', async () => {
                        console.log('📡 OpenAI API response status:', openaiRes.statusCode);

                        try {
                            const parsedResponse = JSON.parse(responseData);

                            // Log error if present
                            if (parsedResponse.error) {
                                console.error('❌ OpenAI API Error:', parsedResponse.error);
                            }

                            // Check for tool calls in chat completions format
                            const toolCalls = [];
                            if (parsedResponse.choices && parsedResponse.choices[0]?.message?.tool_calls) {
                                const openaiToolCalls = parsedResponse.choices[0].message.tool_calls;
                                openaiToolCalls.forEach(tc => {
                                    toolCalls.push({
                                        id: tc.id,
                                        name: tc.function.name,
                                        arguments: JSON.parse(tc.function.arguments)
                                    });
                                });
                            }

                            console.log('📋 OpenAI API response data:', {
                                toolCallsFound: toolCalls.length,
                                contentLength: parsedResponse.choices?.[0]?.message?.content?.length || 0
                            });

                            if (toolCalls.length > 0) {
                                console.log(`🔧 OpenAI requested ${toolCalls.length} tool call(s)`);

                                // Execute the tools
                                const toolResults = await executeMcpToolCalls(toolCalls, 'chat');

                                // Continue conversation with tool results
                                try {
                                    const followUpResponse = await continueConversationWithToolResults(
                                        requestBody,
                                        toolResults,
                                        openaiApiKey,
                                        systemPrompt,
                                        conversationHistory
                                    );

                                    console.log('✅ Tool results sent, final response received');

                                    // Add tool call metadata to response for frontend display
                                    const responseWithMetadata = {
                                        ...followUpResponse,
                                        _toolCallsMade: toolResults.map(tr => ({
                                            name: tr.name,
                                            success: !tr.error,
                                            arguments: tr.arguments
                                        }))
                                    };

                                    // Return final response to client with metadata
                                    res.writeHead(200, { 'Content-Type': 'application/json' });
                                    res.end(JSON.stringify(responseWithMetadata));
                                } catch (error) {
                                    console.error('❌ Error in follow-up request:', error.message);
                                    res.writeHead(500, { 'Content-Type': 'application/json' });
                                    res.end(JSON.stringify({
                                        error: 'Tool execution failed',
                                        details: error.message
                                    }));
                                }
                            } else {
                                // No tool calls, return normal response
                                res.writeHead(openaiRes.statusCode, { 'Content-Type': 'application/json' });
                                res.end(responseData);
                            }
                        } catch (e) {
                            console.log('📋 OpenAI response (raw):', responseData.substring(0, 200));
                            // Return raw response if parsing fails
                            res.writeHead(openaiRes.statusCode, { 'Content-Type': 'application/json' });
                            res.end(responseData);
                        }
                    });
                });

                openaiReq.on('error', (error) => {
                    console.error('❌ OpenAI API request failed:', error.message);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        error: 'Failed to call OpenAI API',
                        details: error.message
                    }));
                });

                openaiReq.write(requestBodyStr);
                openaiReq.end();

            } catch (error) {
                console.error('❌ OpenAI proxy error:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: 'Internal proxy error',
                    details: error.message
                }));
            }
        });
        return;
    }

    // Serve static files for other requests (strip query strings)
    const parsed = new URL(req.url, 'http://localhost');
    const pathname = parsed.pathname === '/' ? '/index.html' : parsed.pathname;
    const filePath = path.join(__dirname, pathname);

    // Check if file exists
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath);
        const contentTypes = {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml'
        };

        res.writeHead(200, {
            'Content-Type': contentTypes[ext] || 'text/plain',
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
        fs.createReadStream(filePath).pipe(res);
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
});

// Database API handler
async function handleDatabaseAPI(req, res) {
    // If Supabase is not configured, return success without doing anything
    if (!supabase) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Database disabled' }));
        return;
    }
    
    let body = '';
    req.on('data', chunk => {
        body += chunk.toString();
    });

    req.on('end', async () => {
        try {
            const data = JSON.parse(body);
            const endpoint = req.url.split('/api/db/')[1];
            
            console.log(`📊 Database API request: ${endpoint}`, {
                dataKeys: Object.keys(data),
                timestamp: new Date().toISOString()
            });

            let result;
            switch (endpoint) {
                case 'sessions':
                    result = await createSession(data);
                    break;
                case 'initial-prompts':
                    result = await createInitialPrompt(data);
                    break;
                case 'voice-inputs':
                    result = await createVoiceInput(data);
                    break;
                case 'conversations':
                    result = await createConversation(data);
                    break;
                case 'mermaid-diagrams':
                    result = await createMermaidDiagram(data);
                    break;
                case 'user-actions':
                    result = await createUserAction(data);
                    break;
                case 'get-session-history':
                    result = await getSessionHistory(data.sessionId);
                    break;
                default:
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Endpoint not found' }));
                    return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
        } catch (error) {
            console.error('Database API error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
    });
}

// Database functions
async function createSession(data) {
    const { data: session, error } = await supabase
        .from('sessions')
        .insert({
            user_agent: data.userAgent,
            ip_address: data.ipAddress,
            session_data: data.sessionData || {}
        })
        .select()
        .single();
    
    if (error) throw error;
    return { session };
}

async function createInitialPrompt(data) {
    const { data: prompt, error } = await supabase
        .from('initial_prompts')
        .insert({
            session_id: data.sessionId,
            prompt_text: data.promptText,
            input_method: data.inputMethod,
            suggestion_button_clicked: data.suggestionButtonClicked
        })
        .select()
        .single();
    
    if (error) throw error;
    return { prompt };
}

async function createVoiceInput(data) {
    const { data: voiceInput, error } = await supabase
        .from('voice_inputs')
        .insert({
            session_id: data.sessionId,
            transcribed_text: data.transcribedText,
            confidence_score: data.confidenceScore,
            language: data.language || 'en-US'
        })
        .select()
        .single();
    
    if (error) throw error;
    return { voiceInput };
}

async function createConversation(data) {
    const { data: conversation, error } = await supabase
        .from('conversations')
        .insert({
            session_id: data.sessionId,
            message_role: data.messageRole,
            message_content: data.messageContent,
            message_order: data.messageOrder
        })
        .select()
        .single();
    
    if (error) throw error;
    return { conversation };
}

async function createMermaidDiagram(data) {
    const { data: diagram, error } = await supabase
        .from('mermaid_diagrams')
        .insert({
            conversation_id: data.conversationId,
            session_id: data.sessionId,
            diagram_code: data.diagramCode,
            diagram_type: data.diagramType || 'flowchart',
            render_status: data.renderStatus || 'pending',
            error_message: data.errorMessage,
            retry_count: data.retryCount || 0
        })
        .select()
        .single();
    
    if (error) throw error;
    return { diagram };
}

async function createUserAction(data) {
    const { data: action, error } = await supabase
        .from('user_actions')
        .insert({
            session_id: data.sessionId,
            action_type: data.actionType,
            action_value: data.actionValue,
            element_id: data.elementId,
            page_location: data.pageLocation || 'main'
        })
        .select()
        .single();
    
    if (error) throw error;
    return { action };
}

async function getSessionHistory(sessionId) {
    const { data: conversations, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('session_id', sessionId)
        .order('message_order', { ascending: true });
    
    if (error) throw error;
    return { conversations };
}

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

server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📡 Claude proxy available at: http://localhost:${PORT}/api/claude-proxy`);
    console.log(`📊 Database API available at: http://localhost:${PORT}/api/db/*`);
    console.log(`🎤 Deepgram WebSocket proxy at: ws://localhost:${PORT}/api/deepgram/ws`);
});
