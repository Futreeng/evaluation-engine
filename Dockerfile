FROM node:20-alpine

WORKDIR /app

# Copy root package files
COPY package*.json ./

# Copy server directory
COPY server/ ./server/

# Copy public folder (frontend static files)
COPY public/ ./public/

# Install production dependencies in server directory
RUN cd server && npm ci --omit=dev

# Expose port
EXPOSE 3005

# Start the server
CMD ["node", "server/server.js"]
