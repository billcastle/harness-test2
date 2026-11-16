# API server. Runs TypeScript through tsx (the PDF worker thread also loads tsx), so all dependencies are installed.
FROM node:24-slim
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
ENV NODE_ENV=production
USER node
# node directly (not npm) so SIGTERM reaches the server and it shuts down cleanly
CMD ["node", "--import", "tsx", "src/index.ts"]
