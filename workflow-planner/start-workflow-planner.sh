#!/bin/bash

# Change to the workflow-planner directory
cd "$(dirname "$0")"

# Start the Node.js server in the background
node proxy-server.js &
SERVER_PID=$!

# Wait a moment for the server to start
sleep 2

# Open Chrome to the app URL
open -a "Google Chrome" http://localhost:8099

# Print server info
echo "Workflow Planner server started (PID: $SERVER_PID)"
echo "Running on http://localhost:8099"
echo "Press Ctrl+C to stop the server"

# Wait for the server process
wait $SERVER_PID
