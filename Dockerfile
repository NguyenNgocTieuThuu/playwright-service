FROM mcr.microsoft.com/playwright:v1.40.0-focal

# Set working directory
WORKDIR /app

# Copy npm config
COPY .npmrc ./

# Copy package files first (for better caching)
COPY package*.json ./

# Clear npm cache and install dependencies
RUN npm cache clean --force && \
    npm ci --only=production --no-audit --no-fund

# Copy source code
COPY . .

# Install browsers
RUN npx playwright install chromium --with-deps

# Create non-root user
RUN groupadd -r playwright && \
    useradd -r -g playwright -G audio,video playwright && \
    chown -R playwright:playwright /app && \
    chown -R playwright:playwright /ms-playwright

USER playwright

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start server
CMD ["npm", "start"]