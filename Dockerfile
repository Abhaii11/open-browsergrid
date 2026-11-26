# Production Dockerfile for OpenBrowserGrid
# Lightweight, containerized headless Chromium with stealth mode and web dashboard

FROM node:22-bullseye-slim

# Install system dependencies required for Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    ca-certificates \
    dumb-init \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Set Chrome binary environment variable
ENV CHROME_PATH=/usr/bin/chromium
ENV PORT=3000
ENV HOST=0.0.0.0
ENV NODE_ENV=production

WORKDIR /app

# Install dependencies and build
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .
RUN npm run build || true

EXPOSE 3000

# Use dumb-init to properly handle PID 1 signals and avoid zombie processes
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/index.js"]
