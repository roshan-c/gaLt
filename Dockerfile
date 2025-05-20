# Use official Bun image
FROM oven/bun:1

# Set working directory
WORKDIR /usr/src/app

# Install dependencies
COPY package*.json ./
# If you have a bun.lockb file, you should also copy it:
# COPY bun.lockb ./
RUN bun install --production

# Copy source code
COPY . .

# Start the bot
CMD ["bun", "start"] 