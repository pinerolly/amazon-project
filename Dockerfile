FROM node:18-bullseye-slim

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies (production)
COPY package.json .
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gconf-service libasound2 libatk1.0-0 libc6 libcairo2 libcap2 libdbus-1-3 libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 fonts-liberation \
    && npm install --production --silent \
    && npx playwright install --with-deps \
    && apt-get remove -y --purge curl \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# Copy app source
COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
