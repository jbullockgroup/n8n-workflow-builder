# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY workflow-planner/package*.json ./workflow-planner/

# Install dependencies
WORKDIR /app/workflow-planner
RUN npm ci --only=production

# Production stage
FROM node:22-alpine

WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy built dependencies from builder stage
COPY --from=builder /app/workflow-planner/node_modules ./workflow-planner/node_modules

# Copy application files
COPY workflow-planner/ ./workflow-planner/

# Set working directory to workflow-planner
WORKDIR /app/workflow-planner

# Change ownership to non-root user
RUN chown -R nodejs:nodejs /app

USER nodejs

# Expose the default port
EXPOSE 8099

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8099/ || exit 1

# Start the server
CMD ["node", "proxy-server.js"]
