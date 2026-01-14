import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// MCP server configurations from mcp.config.json
const CONTEXT7_URL = 'http://localhost:32001/mcp';
const N8N_MCP_COMMAND = 'npx';
const N8N_MCP_ARGS = ['-y', 'n8n-mcp'];

// Create clients for both servers
let context7Client = null;
let n8nMcpClient = null;

// Initialize Context7 HTTP client
async function initContext7Client() {
    const transport = new StreamableHTTPClientTransport(
        new URL(CONTEXT7_URL)
    );
    context7Client = new Client({
        name: 'workflow-planner-client',
        version: '1.0.0'
    }, {
        capabilities: {}
    });
    await context7Client.connect(transport);
}

// Initialize n8n-mcp stdio client
async function initN8nMcpClient() {
    const transport = new StdioClientTransport({
        command: N8N_MCP_COMMAND,
        args: N8N_MCP_ARGS,
        env: {
            MCP_MODE: 'stdio',
            LOG_LEVEL: 'error',
            DISABLE_CONSOLE_OUTPUT: 'true'
        }
    });
    n8nMcpClient = new Client({
        name: 'workflow-planner-client',
        version: '1.0.0'
    }, {
        capabilities: {}
    });
    await n8nMcpClient.connect(transport);
}

// List all tools from both servers
export async function listTools(options = {}) {
    const { budgetMs = 5000 } = options;
    const startTime = Date.now();
    const allTools = [];

    try {
        // Try to initialize n8n-mcp client (stdio)
        // Always attempt to connect - don't reuse stale connections
        try {
            await initN8nMcpClient();
            const n8nTools = await n8nMcpClient.listTools();
            allTools.push(...n8nTools.tools.map(t => ({
                ...t,
                server: 'n8n-mcp'
            })));
            console.log(`✅ Loaded ${n8nTools.tools.length} tools from n8n-mcp`);
        } catch (error) {
            console.error('⚠️  Failed to connect to n8n-mcp:', error.message);
        }

        // Try to initialize Context7 client (HTTP) with timeout
        // Only try Context7 if we have at least some tools from n8n-mcp
        // This prevents total failure if Context7 is down
        if (allTools.length > 0) {
            const timeRemaining = budgetMs - (Date.now() - startTime);
            if (timeRemaining > 1000) {
                try {
                    await Promise.race([
                        initContext7Client(),
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('Context7 connection timeout')), Math.min(3000, timeRemaining))
                        )
                    ]);
                    const context7Tools = await context7Client.listTools();
                    allTools.push(...context7Tools.tools.map(t => ({
                        ...t,
                        server: 'Context7'
                    })));
                    console.log(`✅ Loaded ${context7Tools.tools.length} tools from Context7`);
                } catch (error) {
                    console.error('⚠️  Failed to connect to Context7:', error.message);
                    console.error('   Context7 may not be running on port 32001');
                }
            }
        }

        if (allTools.length === 0) {
            throw new Error('No tools available from any MCP server');
        }

        return { tools: allTools };

    } catch (error) {
        console.error('Error listing tools:', error);
        throw error;
    }
}

// Call a specific tool
export async function callTool(options = {}) {
    const { fqName, tool, args, arguments: toolArgs, phase = 'chat', budgetMs } = options;

    // Support both fqName and tool parameter names
    const toolName = fqName || tool;
    const toolArgsFinal = args || toolArgs || {};

    // Default timeouts based on phase
    const timeout = budgetMs || (phase === 'chat' ? 1500 : 3000);
    const startTime = Date.now();

    try {
        // Determine which server to use based on tool name prefix
        let serverName = 'n8n-mcp'; // default
        if (toolName.includes('.')) {
            serverName = toolName.split('.')[0];
        }

        // Get or initialize the appropriate client
        let client = null;
        if (serverName === 'Context7') {
            if (!context7Client) {
                await initContext7Client();
            }
            client = context7Client;
        } else {
            if (!n8nMcpClient) {
                await initN8nMcpClient();
            }
            client = n8nMcpClient;
        }

        if (!client) {
            throw new Error(`Could not initialize client for ${serverName}`);
        }

        // Extract actual tool name (remove server prefix if present)
        const actualToolName = toolName.includes('.') ? toolName.split('.')[1] : toolName;

        // Call the tool
        const result = await Promise.race([
            client.callTool({
                name: actualToolName,
                arguments: toolArgsFinal
            }),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Tool call timeout')), timeout)
            )
        ]);

        return result;

    } catch (error) {
        console.error(`Error calling tool ${toolName}:`, error);
        throw error;
    }
}
