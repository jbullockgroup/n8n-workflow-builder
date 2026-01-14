# Deployment Guide

This application uses:
- **GPT-5 Nano (2025-08-07)** for workflow planning conversations
- **Claude Sonnet 4** via local proxy server for JSON generation

## Local Development Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   Create a `.env` file in the `workflow-planner` directory with your API keys:
   ```env
   OPENAI_API_KEY=your-openai-api-key
   ANTHROPIC_API_KEY=your-anthropic-api-key
   SUPABASE_URL=your-supabase-url (optional)
   SUPABASE_ANON_KEY=your-supabase-key (optional)
   ```

3. **Start the proxy server:**
   ```bash
   node proxy-server.js
   ```

   This will start the server on port 8099 (default) and provide:
   - Claude API proxy at: `http://localhost:8099/api/claude-proxy`
   - OpenAI API proxy at: `http://localhost:8099/api/openai-proxy`
   - MCP tools at: `http://localhost:8099/api/mcp/call`
   - Database API at: `http://localhost:8099/api/db/`

4. **Open the application:**
   Open `index.html` in your browser or serve it with a simple HTTP server:
   ```bash
   python3 -m http.server 8085
   ```
   Then visit `http://localhost:8085`

## API Models Used

- **GPT-5 Nano**: `gpt-5-nano-2025-08-07`
- **Claude Sonnet 4.5**: `claude-sonnet-4.5-20250514`

## Architecture

The application uses a local Node.js proxy server (`proxy-server.js`) to:
- Securely handle API keys without exposing them to the browser
- Bypass CORS issues when calling external APIs
- Provide a unified interface for MCP tools and database operations
- Support Supabase integration for user analytics (optional)

## Security Notes

- API keys are stored in `.env` and never exposed in the browser
- All API calls go through the secure local proxy server
- CORS is properly configured for browser access
