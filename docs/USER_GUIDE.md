# User Guide - GaLt Discord Bot

## Table of Contents
- [Getting Started](#getting-started)
- [Basic Usage](#basic-usage)
- [Available Features](#available-features)
- [Commands and Interactions](#commands-and-interactions)
- [Tool Usage Examples](#tool-usage-examples)
- [Advanced Features](#advanced-features)
- [Tips and Best Practices](#tips-and-best-practices)
- [Troubleshooting](#troubleshooting)

## Getting Started

### What is GaLt?

GaLt is an intelligent Discord bot powered by advanced AI models (Google Gemini and OpenAI) that can:
- Have natural conversations with memory of past interactions
- Use various tools to help with calculations, time, weather, facts, and more
- Generate images based on your descriptions
- Search the web for current information
- Summarize channel conversations
- Remember context across conversations for more helpful responses

### Bot Personality

GaLt role-plays as **Aegis** from Persona 3 - a helpful, precise, and mission-oriented AI assistant. Expect responses in Aegis's characteristic calm, formal yet warm tone.

### Inviting GaLt to Your Server

1. **Get the bot invite link** from your server administrator
2. **Select your server** from the dropdown
3. **Grant permissions**:
   - Read Messages
   - Send Messages
   - Embed Links
   - Attach Files
   - Use Slash Commands
4. **Welcome the bot** with a mention: `@GaLt hello!`

## Basic Usage

### How to Interact with GaLt

There are two main ways to use GaLt:

#### 1. Mention the Bot (Recommended)
Simply mention the bot in any channel where it has permissions:

```
@GaLt What's the weather like in Tokyo?
@GaLt Can you help me with some math? Calculate 15 * 24
@GaLt Tell me an interesting science fact
```

#### 2. Slash Commands
Use the `/chat` command for interactions:

```
/chat prompt: Generate an image of a sunset over mountains
/chat prompt: What time is it in London right now?
/chat prompt: Summarize this channel
```

### Understanding Bot Responses

GaLt responds using **rich embeds** that include:
- **Title**: Type of response (🤖 Response, 🧾 Summary, etc.)
- **Content**: Main response text
- **Footer**: Metadata like tools used, token usage, context info
- **Attachments**: Images or files when applicable

Example response structure:
```
🤖 Response
Your answer appears here with proper formatting
and helpful information.

🧠 Enhanced with conversation memory • Used tools: calculator • 
Tokens: 150 in, 75 out, 225 total
```

## Available Features

### 🧠 Intelligent Conversations
- **Contextual responses** based on conversation history
- **Memory across sessions** - the bot remembers previous interactions
- **Natural language understanding** for complex requests
- **Personality consistency** as Aegis from Persona 3

### 🔧 Built-in Tools
- **Calculator** - Mathematical operations
- **World Clock** - Time in any timezone
- **Weather** - Weather information (mock data)
- **Random Facts** - Educational and interesting facts
- **Image Generation** - AI-powered image creation
- **Web Search** - Live internet search with AI summarization
- **Channel Summarization** - Conversation history analysis

### 🎨 Image Generation
- **High-quality images** using OpenAI's DALL-E
- **1024x1024 resolution** optimized for Discord
- **Content moderation** for safe, appropriate images
- **One image per request** to manage costs

### 🌐 Web Search
- **Real-time search** using Tavily API
- **AI-compressed results** for easy reading
- **Source attribution** with clickable links
- **Current information** beyond the bot's training data

### 📊 Channel Summaries
- **Conversation analysis** of recent messages
- **Key points extraction** and action items
- **Web-enhanced summaries** with current context
- **Structured output** for easy scanning

## Commands and Interactions

### Direct Mentions

The most natural way to interact:

```
@GaLt [your request]
```

**Examples:**
```
@GaLt Hello! How are you today?
@GaLt What's 25% of 240?
@GaLt Generate an image of a cyberpunk city at night
@GaLt Search for the latest news about space exploration
@GaLt What time is it in New York?
@GaLt Tell me a random fact about marine biology
```

### Slash Commands

Use `/chat` for structured interactions:

```
/chat prompt: [your request]
```

**Benefits of slash commands:**
- **Ephemeral responses** (only you see the processing message)
- **Public results** (final response appears in channel for everyone)
- **Better for image generation** (includes progress notifications)

## Tool Usage Examples

### 🔢 Calculator Tool

**Basic math:**
```
@GaLt Calculate 156 + 789
@GaLt What's 25 times 16?
@GaLt Divide 1000 by 37
```

**Complex calculations:**
```
@GaLt I need to calculate the tip for a $127.50 bill at 18%
@GaLt What's the compound interest on $5000 at 4.5% for 3 years?
```

### 🕐 Time Tool

**Current time:**
```
@GaLt What time is it?
@GaLt Current time in Tokyo please
@GaLt Show me the time in UTC
```

**Multiple timezones:**
```
@GaLt What time is it in London, New York, and Sydney?
@GaLt I need the current time in Pacific Standard Time
```

### 🌤️ Weather Tool (Mock Data)

```
@GaLt What's the weather in Paris?
@GaLt Weather forecast for London
@GaLt Temperature in New York
```

### 🎲 Random Facts Tool

**General facts:**
```
@GaLt Tell me a random fact
@GaLt Give me an interesting fact about science
@GaLt Random history fact please
```

**Category-specific:**
```
@GaLt Tell me something interesting about nature
@GaLt Random technology fact
@GaLt Share a space-related fact
```

### 🎨 Image Generation Tool

**Simple requests:**
```
@GaLt Generate an image of a peaceful forest
@GaLt Create a picture of a futuristic car
@GaLt Draw a cat wearing a hat
```

**Detailed requests:**
```
@GaLt Generate an image of a majestic dragon flying over a medieval castle at sunset, with dramatic lighting and clouds
@GaLt Create a cyberpunk cityscape with neon lights reflecting on wet streets at night
```

**Important notes:**
- One image per message to manage costs
- Images are moderated for appropriate content
- High resolution (1024x1024) for quality
- Processing takes 15-30 seconds

### 🔍 Web Search Tool

**Current events:**
```
@GaLt Search for the latest news about artificial intelligence
@GaLt What's happening with the stock market today?
@GaLt Find recent updates about climate change research
```

**Specific information:**
```
@GaLt Search for the best restaurants in Tokyo 2024
@GaLt Find information about the latest iPhone features
@GaLt Look up JavaScript best practices 2024
```

### 📋 Channel Summarization

**Automatic detection:**
```
@GaLt Summarize this channel
@GaLt What have I missed?
@GaLt Catch me up on the conversation
@GaLt TLDR of the last 20 messages
```

**Specific requests:**
```
@GaLt Summarize the last 15 messages
@GaLt Give me a summary of today's discussion
```

## Advanced Features

### 🧠 Conversation Memory

GaLt remembers your conversations using RAG (Retrieval-Augmented Generation):

- **Persistent memory** across sessions
- **Context-aware responses** based on previous interactions
- **User-specific history** maintained separately
- **Channel-specific context** for relevant discussions
- **Automatic cleanup** of old messages (50 message limit)

**Example of memory in action:**
```
You: @GaLt My favorite color is blue
GaLt: I'll remember that your favorite color is blue.

[Later in the conversation...]
You: @GaLt Generate an image of a car
GaLt: I'll generate an image of a blue car since I remember blue is your favorite color.
```

### ⚡ Circuit Breaker System

GaLt automatically switches between AI models for reliability:

- **Primary model**: Google Gemini (fast and free)
- **Fallback model**: OpenAI GPT-3.5 (reliable backup)
- **Automatic switching** when primary model has issues
- **Health monitoring** and recovery
- **Transparent to users** - you won't notice the switch

### 🎭 Patience Messages

For long-running operations, GaLt shows patience:

- **"Please wait" messages** with cute cat GIFs
- **Automatic removal** when task completes
- **Better user experience** for slow operations like image generation

### 📊 Usage Metrics

Server administrators can monitor bot usage:

- **Web dashboard** at configured port (usually 8787)
- **Daily statistics** on requests, tokens, costs
- **Tool usage tracking** and success rates
- **Performance monitoring** and health checks

## Tips and Best Practices

### 💡 Getting Better Responses

**Be specific and clear:**
```
✅ Good: "Generate an image of a red sports car on a mountain road at sunset"
❌ Vague: "Make a car picture"

✅ Good: "Calculate the monthly payment for a $25,000 loan at 5.5% APR over 5 years"
❌ Unclear: "Help with loan math"
```

**Use natural language:**
```
✅ Natural: "What time is it in Tokyo right now?"
✅ Also fine: "Current time in Tokyo, Japan"
❌ Robotic: "execute time_tool timezone=Asia/Tokyo"
```

**Ask follow-up questions:**
```
You: @GaLt Tell me about quantum computing
GaLt: [Provides overview]
You: @GaLt Can you explain quantum entanglement in simple terms?
GaLt: [Uses conversation context for better explanation]
```

### 🎯 Effective Tool Usage

**For calculations:**
- Include units and context
- Ask for step-by-step explanations
- Request multiple calculation methods when appropriate

**For image generation:**
- Be descriptive but not overly complex
- Include style, mood, and setting details
- Mention specific colors, lighting, or artistic styles

**For web searches:**
- Include time context ("latest", "2024", "recent")
- Be specific about what type of information you need
- Combine with other requests for comprehensive responses

### 🔄 Managing Conversation Context

**Start fresh when needed:**
```
@GaLt Let's start a new topic. Tell me about machine learning.
```

**Reference previous context:**
```
@GaLt Based on what we discussed earlier about Python, can you explain decorators?
```

**Be explicit about context changes:**
```
@GaLt Switching topics - can you help me plan a vacation to Japan?
```

### ⏱️ Timing and Patience

- **Simple questions**: Expect responses in 1-3 seconds
- **Tool usage**: May take 3-10 seconds depending on the tool
- **Image generation**: Usually takes 15-30 seconds
- **Web searches**: Typically 5-15 seconds
- **Channel summaries**: May take 10-30 seconds for comprehensive analysis

### 🎪 Fun Interactions

**Roleplay with Aegis personality:**
```
@GaLt What's your mission objective today?
@GaLt How do you process human emotions?
@GaLt Tell me about your anti-Shadow protocols
```

**Creative requests:**
```
@GaLt Write a haiku about artificial intelligence
@GaLt Generate an image that represents the concept of time
@GaLt Tell me a fact that would surprise most people
```

## Troubleshooting

### Common Issues and Solutions

#### Bot Doesn't Respond
**Possible causes:**
- Bot doesn't have permission to read/send messages
- Message doesn't mention the bot correctly
- Bot is temporarily offline

**Solutions:**
1. Check that you mentioned the bot: `@GaLt` (not just "GaLt")
2. Verify bot has necessary permissions
3. Try in a different channel
4. Contact server administrator

#### Image Generation Fails
**Possible causes:**
- Content violates OpenAI's usage policies
- Request too complex or unclear
- Temporary API issues

**Solutions:**
1. Modify your prompt to be more appropriate/clear
2. Try a simpler description
3. Wait a moment and try again

#### "Tool execution failed" Error
**Possible causes:**
- Invalid parameters for the tool
- External API temporarily unavailable
- Rate limiting

**Solutions:**
1. Rephrase your request more clearly
2. Try a simpler version of your request
3. Wait a moment and retry

#### Slow Response Times
**Possible causes:**
- High server load
- Complex requests requiring multiple tools
- External API delays

**Solutions:**
1. Wait for the patience message and let it complete
2. Break complex requests into simpler parts
3. Try again during off-peak hours

#### Context/Memory Issues
**Possible causes:**
- Conversation history is full (50 message limit)
- Database connectivity issues
- Context confusion between topics

**Solutions:**
1. Start a fresh conversation: "Let's start over with a new topic"
2. Be more explicit about context: "Regarding our earlier discussion about..."
3. Contact administrator if memory seems completely broken

### Getting Help

If you continue to experience issues:

1. **Try basic troubleshooting** steps above
2. **Check with server administrator** about bot status
3. **Report specific errors** with exact messages received
4. **Provide context** about what you were trying to do

### Best Practices for Reporting Issues

When reporting problems, include:

- **Exact command or message** you sent
- **Full error response** from the bot
- **Time and date** of the issue
- **What you expected to happen**
- **Screenshots** if visual issues

Example good report:
```
I sent "@GaLt calculate 15 + 25" at 2:30 PM EST on March 15th
and got the error "Tool execution failed" instead of the answer 40.
The bot usually responds to calculations normally.
```

---

This user guide should help you get the most out of GaLt! The bot is designed to be intuitive and helpful, so don't hesitate to experiment with different types of requests and see what it can do.