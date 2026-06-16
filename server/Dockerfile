# Tiny WebSocket relay/rooms server.
FROM node:20-alpine

WORKDIR /app

# Install dependencies first to leverage Docker layer caching.
COPY package.json package-lock.json* ./
RUN npm install

# Build the TypeScript sources to dist/.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Hosting platforms inject PORT; default to 8080 for local runs.
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/index.js"]
