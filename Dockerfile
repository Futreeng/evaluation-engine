FROM node:20-alpine

WORKDIR /app

# Copy root package files
COPY package*.json ./

# Copy server directory
COPY server/ ./server/

# Install production dependencies in server directory
RUN cd server && npm ci --omit=dev

# Expose port
EXPOSE 3005

# Start the server (frontend served by Vercel, not here)
CMD ["node", "server/server.js"]
