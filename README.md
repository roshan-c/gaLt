# gaLt - Discord AI Assistant Bot

A Discord bot that uses Google's Gemini API to provide helpful responses, summarize conversations, and process images.

## Features

- **AI-Powered Responses**: Uses Google's Gemini 2.0 Flash model to generate helpful replies
- **Message Logging**: Records all messages in channels for context and history
- **Conversation Summarization**: Summarizes recent conversations with the `/summarize` command
- **Image Processing**: Can analyze and respond to images shared in Discord
- **Full Message History**: Maintains a comprehensive log of all channel messages

## Setup

1. Clone this repository and install dependencies:

   ```sh
   git clone https://github.com/yourusername/gaLt.git
   cd gaLt
   npm install
   ```

2. Create a `.env` file with your credentials:

   ```
   DISCORD_TOKEN=your_discord_bot_token_here
   GEMINI_API_KEY=your_gemini_api_key_here
   GUILD_ID=your_discord_server_id_here
   ```

3. Run the bot:

   ```sh
   node index.js
   ```

## Commands

- **@gaLt [message]**: Mention the bot with any message to get an AI-powered response
- **/summarize**: Generates a summary of the last 15 messages in the current channel
- **/ping**: Simple test command to check if the bot is responding correctly
- **/generateimage**: Generates an image based on a text prompt using Gemini.
  - **Required Option**: `prompt` (string) - The text you want to use to generate the image.
- **!summarize**: Alternative text command for summarization (fallback if slash commands aren't working)

## Configuration Options

- **DISCORD_TOKEN**: Your Discord bot token (required)
- **GEMINI_API_KEY**: Your Google Gemini API key (required)
- **GUILD_ID**: Your Discord server ID for faster slash command registration (optional)

## Requirements

- Node.js 16.6.0 or higher
- Discord bot with message content intent enabled
- Google Gemini API key

## Permissions

Your bot needs the following permissions:
- Read Messages/View Channels
- Send Messages
- Read Message History
- Use Slash Commands
- Embed Links

## OAuth2 Scopes

When inviting your bot, make sure to include these scopes:
- bot
- applications.commands

---

Created by Gart
