FROM node:20-slim AS base

# Install xray-core
RUN apt-get update && apt-get install -y --no-install-recommends curl unzip ca-certificates && \
    curl -fSL -o /tmp/xray.zip "https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-64.zip" && \
    unzip /tmp/xray.zip -d /usr/local/bin/ && \
    chmod +x /usr/local/bin/xray && \
    rm /tmp/xray.zip && \
    apt-get remove -y curl unzip && apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p /data/limoo

ENV NODE_ENV=production
ENV PORT=3000
ENV LIMOO_USER=admin
ENV LIMOO_PASS=changeme

EXPOSE 3000

CMD ["node", "server.js"]
