# Discord Gemini Bot

A Discord bot that responds with unhelpful fake messages 90% of the time, and 10% of the time queries Google Gemini (via REST API) for a real answer.

## Setup

1. Clone this repo and install dependencies:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in your credentials:

   ```sh
   cp .env.example .env
   # Edit .env and set DISCORD_TOKEN and GEMINI_API_KEY
   ```

3. Run the bot:

   ```sh
   npm start
   ```

## Configuration
- The fake responses are in `index.js` and can be edited.
- The Gemini integration uses the Google Gemini API directly.

## Requirements
- Node.js 18+
- Discord bot token ([guide](https://discord.com/developers/applications))
- Gemini API key ([Google AI Studio](https://aistudio.google.com/app/apikey))

---

Enjoy your mostly unhelpful, sometimes insightful Discord bot!
