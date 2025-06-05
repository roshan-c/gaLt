# Use official Bun image - using latest to ensure tsc support
FROM oven/bun:latest

# Set working directory
WORKDIR /usr/src/app

# Copy package.json and bun.lockb
COPY package.json ./
COPY bun.lockb ./

# Install all dependencies (including devDependencies for build)
# Using --frozen-lockfile to ensure consistent installs based on lock file
RUN bun install --frozen-lockfile

# Copy source code and tsconfig
COPY src ./src
COPY tsconfig.json ./

# Build TypeScript
# This will compile src/index.ts to dist/index.js as per tsconfig.json
RUN bun run build

# Environment variables expected at runtime
# These should be provided when running the container, e.g., using 'docker run -e VAR_NAME=value'
# Or via a .env file loaded by the application at runtime if not set in the container's env.
# The application uses dotenv, so it will load a .env file if present.
# For production, it's best to pass these as environment variables to the container.
ENV DISCORD_TOKEN=your_discord_token_env_var_name
ENV GEMINI_API_KEY=your_gemini_api_key_env_var_name
ENV OPENAI_API_KEY=your_openai_api_key_env_var_name
ENV GUILD_ID=your_guild_id_env_var_name
# Note: The actual values are NOT set here. These are placeholders/documentation.
# The application will use these environment variables if set, or load them from a .env file.

# Expose Port (if necessary) - Not typically needed for a Discord bot
# EXPOSE 3000

# Command to run the compiled JavaScript output
CMD ["bun", "dist/index.js"]
