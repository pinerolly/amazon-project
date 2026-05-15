FROM node:18-bullseye-slim

# 1. Pin pnpm to version 9 to avoid the Node 18 dynamic import bug
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /usr/src/app

# 2. Copy dependency files
COPY package.json pnpm-lock.yaml* ./

# 3. Install System Dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    libasound2 libatk1.0-0 libc6 libcairo2 libcap2 libdbus-1-3 libexpat1 \
    libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 \
    libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libstdc++6 libx11-6 \
    libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 \
    libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# 4. Use --no-frozen-lockfile just for this first build 
# to let pnpm adjust to the pinned version
RUN pnpm install --prod --no-frozen-lockfile

# 5. Install Playwright browsers
RUN npx playwright install --with-deps

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]