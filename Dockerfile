FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/

# Install dependencies
RUN cd server && npm install --omit=dev
RUN cd client && npm install

# Copy source
COPY server/ ./server/
COPY client/ ./client/

# Build client
RUN cd client && npm run build

EXPOSE 3000

CMD ["node", "server/index.js"]
