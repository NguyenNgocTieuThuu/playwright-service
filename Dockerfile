FROM mcr.microsoft.com/playwright:v1.40.0-focal

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Install browsers (Railway has good caching)
RUN npx playwright install chromium

# Create non-root user for security
RUN groupadd -r playwright && useradd -r -g playwright -G audio,video playwright
RUN chown -R playwright:playwright /app
USER playwright

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start server
CMD ["npm", "start"]