# Use official Node.js 18 image
FROM node:18-slim

# Set working directory
WORKDIR /usr/src/app

# Install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source code
COPY . .

# Start the bot
CMD ["npm", "start"] 