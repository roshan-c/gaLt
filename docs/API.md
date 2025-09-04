# Aegis API Documentation

## Table of Contents
- [Tool System API](#tool-system-api)
- [Memory Manager API](#memory-manager-api)
- [Metrics API](#metrics-api)
- [Circuit Breaker API](#circuit-breaker-api)
- [Embed Response API](#embed-response-api)

## Tool System API

### BotTool Interface

The `BotTool` interface defines the structure for all bot tools:

```typescript
interface BotTool {
  name: string;                    // Unique tool identifier
  description: string;             // Tool description for AI model
  schema: ZodSchema;               // Zod schema for parameter validation
  execute: (args: any) => Promise<any>; // Tool execution function
}
```

### ToolRegistry Class

The `ToolRegistry` manages all available tools and handles execution.

#### Methods

##### `registerTool(tool: BotTool): void`

Registers a new tool with the registry.

```typescript
import { z } from 'zod';
import type { BotTool } from '../ToolRegistry';

const myTool: BotTool = {
  name: 'my_custom_tool',
  description: 'Performs a custom operation',
  schema: z.object({
    input: z.string().describe('The input string to process'),
    options: z.object({
      uppercase: z.boolean().optional().describe('Convert to uppercase')
    }).optional()
  }),
  execute: async (args: { input: string; options?: { uppercase?: boolean } }) => {
    const { input, options } = args;
    const result = options?.uppercase ? input.toUpperCase() : input;
    return { result, processed: true };
  }
};

toolRegistry.registerTool(myTool);
```

##### `getToolDefinitions(): ToolDefinition[]`

Returns tool definitions formatted for LangChain integration.

##### `executeTools(toolCalls: ToolCall[]): Promise<ToolResult[]>`

Executes multiple tools and returns results with proper error handling.

```typescript
const toolCalls = [
  {
    name: 'calculator',
    args: { operation: 'add', a: 5, b: 3 }
  }
];

const results = await toolRegistry.executeTools(toolCalls);
// Returns: [{ success: true, result: { result: 8, operation: "5 + 3" }, message: ToolMessage }]
```

### Built-in Tools

#### Calculator Tool

**Name:** `calculator`
**Description:** Performs basic arithmetic operations

**Schema:**
```typescript
{
  operation: 'add' | 'subtract' | 'multiply' | 'divide',
  a: number,
  b: number
}
```

**Returns:**
```typescript
{
  result: number,
  operation: string
}
```

#### Time Tool

**Name:** `get_time`
**Description:** Gets current time information

**Schema:**
```typescript
{
  timezone?: string,        // Default: 'UTC'
  format?: 'iso' | 'human' | 'unix'  // Default: 'human'
}
```

**Returns:**
```typescript
{
  time: string,
  timezone: string,
  format: string,
  timestamp: number
}
```

#### Weather Tool

**Name:** `get_weather`
**Description:** Returns mock weather information

**Schema:**
```typescript
{
  location: string,
  units?: 'metric' | 'imperial'  // Default: 'metric'
}
```

#### Random Facts Tool

**Name:** `random_fact`
**Description:** Generates random facts by category

**Schema:**
```typescript
{
  category?: 'science' | 'history' | 'nature' | 'technology' | 'general'
}
```

#### Image Generation Tool

**Name:** `generate_image`
**Description:** Generates images using GPT-Image-1

**Schema:**
```typescript
{
  prompt: string,
  size?: '256x256' | '512x512' | '1024x1024',  // Default: '1024x1024'
  quality?: 'standard' | 'hd'                   // Default: 'standard'
}
```

**Returns:**
```typescript
{
  success: boolean,
  imageBuffer?: Buffer,
  prompt: string,
  filename: string,
  moderationBlocked?: boolean
}
```

#### Web Search Tool

**Name:** `web_search`
**Description:** Performs live web search via Tavily

**Schema:**
```typescript
{
  query: string,
  maxResults?: number,      // Default: 5
  includeImages?: boolean   // Default: false
}
```

**Returns:**
```typescript
{
  summary: string,
  keyPoints: string[],
  sources: Array<{
    title: string,
    url: string,
    content: string
  }>
}
```

#### Summarize Context Tool

**Name:** `summarize_context`
**Description:** Summarizes channel conversation history

**Schema:**
```typescript
{
  userId: string,
  channelId: string,
  minMessages?: number,              // Default: 15
  maxMessages?: number,              // Default: 50
  useWeb?: boolean,                  // Default: true
  appendDateToWebQueries?: boolean   // Default: true
}
```

**Returns:**
```typescript
{
  summary: string,
  keyPoints: string[],
  actionItems: string[],
  openQuestions: string[],
  webResults?: Array<{
    query: string,
    summary: string,
    sources: Array<{ title: string, url: string }>
  }>,
  usedWebSearch: boolean
}
```

## Memory Manager API

### MemoryManager Class

Handles conversation memory using RAG (Retrieval-Augmented Generation).

#### Methods

##### `addMessage(userId: string, channelId: string, role: string, content: string): Promise<void>`

Adds a message to conversation memory.

```typescript
await memoryManager.addMessage(
  'user123',
  'channel456', 
  'user',
  'Hello, how are you?'
);
```

##### `getEnhancedHistory(userId: string, channelId: string, query: string): Promise<ConversationMessage[]>`

Retrieves conversation history enhanced with RAG context.

```typescript
const history = await memoryManager.getEnhancedHistory(
  'user123',
  'channel456',
  'What did we discuss about weather?'
);
```

#### ConversationMessage Interface

```typescript
interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: Date;
}
```

## Metrics API

### Metrics Class

Tracks bot usage statistics and costs.

#### Methods

##### `recordRequest(): void`

Records an API request.

##### `recordTokens(input: number, output: number, total: number, cost?: number): void`

Records token usage and optional cost.

##### `recordToolCall(toolName: string, success: boolean): void`

Records tool execution.

##### `recordImageGeneration(cost: number): void`

Records image generation with cost.

##### `getDailyMetrics(): DailyMetrics`

Returns current day's metrics.

```typescript
interface DailyMetrics {
  date: string;
  requests: number;
  tokens: {
    input: number;
    output: number;
    total: number;
    cost: number;
  };
  tools: Record<string, { calls: number; successes: number }>;
  images: {
    count: number;
    cost: number;
  };
}
```

### Metrics Dashboard

The metrics dashboard runs on `http://localhost:8787` (configurable via `METRICS_PORT`).

#### Endpoints

- `GET /` - Web dashboard UI
- `GET /api/metrics` - JSON metrics data

## Circuit Breaker API

### Circuit Breaker State

The circuit breaker automatically switches between Gemini and OpenAI based on error conditions.

#### Error Codes That Trip the Breaker
- 400 (Bad Request)
- 403 (Forbidden) 
- 404 (Not Found)
- 429 (Rate Limited)
- 500 (Internal Server Error)
- 503 (Service Unavailable)
- 504 (Gateway Timeout)

#### Functions

##### `getActiveLlm(): ChatGoogleGenerativeAI | ChatOpenAI`

Returns the currently active language model.

##### `getActiveModelName(): string`

Returns the name of the active model.

##### `tripCircuitBreakerFor(durationMs: number): void`

Manually trips the circuit breaker for specified duration.

## Embed Response API

### EmbedResponse Class

Handles Discord embed formatting and long message chunking.

#### Static Methods

##### `sendLongResponse(message: Message, content: string, options?: ResponseOptions): Promise<void>`

Sends a response with automatic chunking and embed formatting.

```typescript
interface ResponseOptions {
  title?: string;
  includeContext?: boolean;
  toolsUsed?: string[];
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  attachments?: any[];
  imagePrompt?: string;
  imageFilename?: string;
}
```

##### `sendError(message: Message, errorText: string): Promise<void>`

Sends an error message with consistent formatting.

##### `sendInfo(message: Message, title: string, description: string): Promise<void>`

Sends an informational message.

##### `sendPatienceReply(message: Message): Promise<Message>`

Sends a "please wait" message with cat GIF for long-running operations.

##### `chunkContent(content: string, maxLength?: number): string[]`

Splits long content into Discord-compatible chunks.

##### `getResponseStats(content: string): ResponseStats`

Analyzes content and returns statistics.

```typescript
interface ResponseStats {
  length: number;
  chunks: number;
  willUseEmbeds: boolean;
}
```

## Error Handling

All API methods include comprehensive error handling:

1. **Tool Execution Errors** - Caught and wrapped in `ToolResult` with error details
2. **Validation Errors** - Zod schema validation errors are captured
3. **API Errors** - External API failures are handled gracefully
4. **Circuit Breaker** - Automatic failover for model API errors
5. **Memory Errors** - Conversation memory failures don't break responses

## Environment Variables

| Variable | Type | Description | Default |
|----------|------|-------------|---------|
| `DISCORD_TOKEN` | string | Discord bot token | Required |
| `GOOGLE_API_KEY` | string | Google Gemini API key | Required |
| `GOOGLE_MODEL` | string | Gemini model name | `gemini-2.0-flash` |
| `OPENAI_API_KEY` | string | OpenAI API key | Required |
| `TAVILY_API_KEY` | string | Tavily search API key | Required |
| `CHROMA_URL` | string | ChromaDB URL | `http://localhost:8000` |
| `METRICS_PORT` | number | Metrics dashboard port | `8787` |
| `LANGSMITH_API_KEY` | string | LangSmith tracing key | Optional |
| `LANGSMITH_TRACING` | boolean | Enable tracing | `false` |

## Rate Limits

- **Discord**: 2000 requests per 10 seconds per bot
- **OpenAI**: Varies by plan and model
- **Gemini**: Varies by plan
- **Tavily**: Varies by plan

The bot includes automatic retry and backoff mechanisms for rate-limited requests.