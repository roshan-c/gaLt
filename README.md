# gaLt - Discord AI Assistant Bot

A Discord bot powered by Google's Gemini AI with intelligent tool calling, conversation memory, and specialized features including McDonald's UK survey code generation.

## Features

### 🤖 **AI-Powered Responses**
- Uses Google's Gemini 2.0 Flash model for intelligent conversations
- Automatic tool detection and function calling
- Maintains chat history for contextual responses
- Can process and analyze images shared in Discord
- Google Search integration for real-time information

### 🍟 **McDonald's Survey Code Generator**
- Generates valid McDonald's UK "Food for Thoughts" survey codes
- Automatically triggered when users mention McDonald's, surveys, or codes
- Uses proven strategy: Store 1553 (Northampton Kettering Road), Register 20, Order ID 1-20
- Provides complete instructions for using codes at mcdfoodforthoughts.com

### 🎨 **Image Generation**
- Uses OpenAI's GPT-Image-1 model for high-quality image generation
- Available via `/generateimage` slash command
- Supports 1024x1024 resolution images

### 📝 **Conversation Management**
- Per-channel chat history storage (up to 1000 messages)
- Conversation summarization with configurable message count
- Smart context retention across conversations

## Setup

1. **Clone and Install**:
   ```bash
   git clone https://github.com/yourusername/gaLt.git
   cd gaLt
   bun install
   ```

2. **Environment Configuration**:
   Create a `.env` file with your API keys:
   ```env
   DISCORD_TOKEN=your_discord_bot_token_here
   GEMINI_API_KEY=your_gemini_api_key_here
   OPENAI_API_KEY=your_openai_api_key_here
   GUILD_ID=your_discord_server_id_here
   ```

3. **Run the Bot**:
   ```bash
   bun run index.js
   ```

## Commands

### Slash Commands
- **/hello**: Test command - replies with "Hello there!"
- **/generateimage [prompt]**: Generate an image using OpenAI's GPT-Image-1
  - **Required**: `prompt` (string) - Description of the image you want
- **/summarize [count]**: Summarize recent channel messages
  - **Optional**: `count` (5-50) - Number of messages to summarize (default: 15)

### Chat Commands
- **@gaLt [message]**: Mention the bot for AI-powered responses with full context
- **McDonald's keywords**: Say "McDonald's", "survey", "code", or "free food" to automatically generate survey codes

## Channel Configuration

The bot is currently configured to respond to mentions only in channel ID: `1368705925808132136`. 

To change this, modify line 534 in `index.js`:
```javascript
if (message.channel.id !== 'YOUR_CHANNEL_ID_HERE') {
```

## McDonald's Survey Code Feature

When users mention McDonald's-related keywords, the bot automatically:
1. Generates a valid UK survey code using store 1553 (Northampton Kettering Road)
2. Provides the generated code in format: `XXXX-XXXX-XXXX`
3. Includes store details, order info, and timestamp
4. Gives complete instructions for using the code at mcdfoodforthoughts.com

**Code Strategy** (proven 100% success rate):
- Store: Always 1553 (Northampton Kettering Road)
- Register: Always 20
- Order ID: Random 1-20
- Timestamp: Current time when requested

## API Requirements

- **Discord Bot Token**: Create at [Discord Developer Portal](https://discord.com/developers/applications)
- **Google Gemini API Key**: Get from [Google AI Studio](https://ai.google.dev/)
- **OpenAI API Key**: Get from [OpenAI Platform](https://platform.openai.com/)

## Bot Permissions

Required Discord permissions:
- View Channels
- Send Messages
- Read Message History
- Use Slash Commands
- Embed Links
- Attach Files

Required OAuth2 Scopes:
- `bot`
- `applications.commands`

## Technical Details

- **Bun**: Latest version required (faster than Node.js)
- **Dependencies**: discord.js, @google/genai, openai, node-fetch, dotenv
- **Storage**: File-based chat history (`chat_history/` directory)
- **Function Calling**: Uses OpenAI-compatible Gemini endpoint for tool integration

## File Structure

```
gaLt/
├── index.js              # Main bot file
├── package.json          # Dependencies
├── .env                  # Environment variables (create this)
├── chat_history/         # Per-channel chat logs (auto-created)
├── test_*.js            # Test files for McDonald's generator
└── README.md            # This file
```

---

**Created by Gart** - A helpful Discord bot that sleeps when you do! 🤖
