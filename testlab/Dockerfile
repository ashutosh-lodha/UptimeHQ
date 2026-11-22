# Standalone test lab: no dependencies, no build step, no access to UptimeHQ's data or secrets.
FROM node:22-bookworm-slim
LABEL org.opencontainers.image.source="https://github.com/ashutosh-lodha/UptimeHQ"
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=8090
RUN mkdir /data && chown node:node /data
COPY package.json ./
COPY src ./src
COPY public ./public
USER node
VOLUME /data
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=5s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8090/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "src/server.js"]
