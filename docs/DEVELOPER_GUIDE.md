# Developer Guide - GaLt Discord Bot

## Table of Contents
- [Development Setup](#development-setup)
- [Project Architecture](#project-architecture)
- [Code Organization](#code-organization)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Debugging](#debugging)
- [Performance Optimization](#performance-optimization)
- [Security Considerations](#security-considerations)
- [Contributing Guidelines](#contributing-guidelines)

## Development Setup

### Prerequisites

- **Bun** v1.2.19+ (primary runtime)
- **Node.js** v18+ (fallback)
- **TypeScript** v5+
- **Git** for version control
- **Discord Developer Portal** access
- **API Keys**: Google (Gemini), OpenAI, Tavily

### Local Development Environment

1. **Clone and setup:**
   ```bash
   git clone https://github.com/roshan-c/gaLt.git
   cd gaLt
   bun install
   cp .env.example .env
   ```

2. **Configure environment variables:**
   Edit `.env` with your actual API keys and configuration.

3. **Development server with hot reload:**
   ```bash
   bun run dev
   ```

4. **TypeScript compilation check:**
   ```bash
   bun build index.ts --outdir ./dist --target bun
   ```

### IDE Setup

#### VS Code Extensions (Recommended)
- **TypeScript Importer** - Auto import management
- **Bun for Visual Studio Code** - Bun runtime support
- **Discord.js** - Discord API IntelliSense
- **Zod** - Schema validation support

#### TypeScript Configuration
The project uses `tsconfig.json` with strict type checking:

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "composite": false,
    "skipLibCheck": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

## Project Architecture

### High-Level Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Discord.js    │    │   LangChain     │    │   External APIs │
│   (Events)      │───▶│   (AI Models)   │───▶│   (Tools)       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ Memory Manager  │    │ Circuit Breaker │    │ Metrics System  │
│ (RAG/History)   │    │ (Failover)      │    │ (Monitoring)    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Core Components

#### 1. **Event Handler System** (`index.ts:298-673`)
- Message processing with deduplication
- Slash command handling
- Error recovery and resilience
- Hot-reload protection with global state

#### 2. **Tool Registry System** (`src/tools/ToolRegistry.ts`)
- Dynamic tool registration
- Schema validation with Zod
- Execution context management
- Error handling and result formatting

#### 3. **Memory Management** (`src/memory/MemoryManager.ts`)
- RAG-based conversation context
- Message history with ChromaDB integration
- Context-aware retrieval
- Memory pruning and optimization

#### 4. **Circuit Breaker** (`index.ts:128-194`)
- Automatic model failover (Gemini ↔ OpenAI)
- Health monitoring and recovery
- Error-based tripping logic
- Exponential backoff

#### 5. **Response System** (`src/utils/EmbedResponse.ts`)
- Discord embed formatting
- Long message chunking
- Attachment handling
- Consistent styling

### Design Patterns

#### 1. **Singleton Pattern**
Used for Discord client and global state management:

```typescript
const g: any = globalThis as any;
let client: Client = g.__GA_LT_CLIENT as Client;
if (!client) {
  client = new Client({ /* config */ });
  g.__GA_LT_CLIENT = client;
}
```

#### 2. **Strategy Pattern**
Circuit breaker for model selection:

```typescript
function getActiveLlm() {
  return cb.tripped ? openaiLlm : geminiLlm;
}
```

#### 3. **Observer Pattern**
Discord event handling:

```typescript
client.on(Events.MessageCreate, async (message: Message) => {
  // Handle message events
});
```

#### 4. **Factory Pattern**
Tool creation and registration:

```typescript
export const calculatorTool: BotTool = {
  name: 'calculator',
  description: '...',
  schema: z.object({...}),
  execute: async (args) => {...}
};
```

## Code Organization

### Directory Structure

```
gaLt/
├── src/
│   ├── memory/
│   │   └── MemoryManager.ts         # RAG conversation memory
│   ├── metrics/
│   │   └── DashboardServer.ts       # Metrics web interface
│   ├── tools/
│   │   ├── ToolRegistry.ts          # Tool management core
│   │   ├── ImageGenerationTool.ts   # GPT-Image-1 integration
│   │   ├── WebSearchTool.ts         # Tavily search integration
│   │   ├── SummarizeContextTool.ts  # Channel summarization
│   │   └── examples/
│   │       ├── ExampleTool.ts       # Calculator & time tools
│   │       └── WeatherTool.ts       # Weather & facts tools
│   ├── types/
│   │   └── BotConfig.ts             # TypeScript interfaces
│   └── utils/
│       ├── EmbedResponse.ts         # Discord response formatting
│       ├── Metrics.ts               # Usage tracking
│       └── Pricing.ts               # Cost calculation
├── docs/                            # Documentation
├── index.ts                         # Main bot entry point
├── SYSTEM.md                        # AI system prompt
├── package.json                     # Dependencies & scripts
└── tsconfig.json                    # TypeScript config
```

### Naming Conventions

#### Files and Directories
- **PascalCase** for classes: `MemoryManager.ts`
- **camelCase** for utilities: `embedResponse.ts`
- **UPPERCASE** for constants: `SYSTEM.md`

#### Variables and Functions
- **camelCase** for variables: `conversationHistory`
- **PascalCase** for classes: `MemoryManager`
- **UPPER_SNAKE_CASE** for constants: `CB_ERROR_CODES`

#### Types and Interfaces
- **PascalCase** for interfaces: `BotTool`, `ConversationMessage`
- **PascalCase** for types: `CircuitState`

### Import Organization

Follow this order for imports:

```typescript
// 1. Node.js built-ins
import fs from 'fs';
import path from 'path';

// 2. External packages
import { Client, GatewayIntentBits } from 'discord.js';
import { z } from 'zod';

// 3. Internal modules (absolute paths)
import { MemoryManager } from './src/memory/MemoryManager';
import type { BotTool } from './src/types/BotConfig';

// 4. Relative imports
import { calculatorTool } from './examples/ExampleTool';
```

## Development Workflow

### 1. **Feature Development**

1. **Create feature branch:**
   ```bash
   git checkout -b feature/new-tool-name
   ```

2. **Implement the feature:**
   - Add types to `src/types/BotConfig.ts`
   - Create implementation files
   - Write tests
   - Update documentation

3. **Test locally:**
   ```bash
   bun run dev
   # Test in Discord
   ```

4. **Submit PR:**
   - Write clear commit messages
   - Include tests and documentation
   - Follow code style guidelines

### 2. **Hot Reload Development**

The bot supports hot reload for rapid development:

```typescript
// Global state preservation across reloads
const g: any = globalThis as any;
let client: Client = g.__GA_LT_CLIENT as Client;
```

**Important considerations:**
- State persists across reloads
- Event listeners are deduplicated
- Memory managers maintain data

### 3. **Tool Development Lifecycle**

1. **Define the tool interface:**
   ```typescript
   export const myTool: BotTool = {
     name: 'my_tool',
     description: 'What this tool does',
     schema: z.object({
       // Parameter validation
     }),
     execute: async (args) => {
       // Implementation
     }
   };
   ```

2. **Register the tool:**
   ```typescript
   toolRegistry.registerTool(myTool);
   ```

3. **Test execution:**
   - Use slash commands: `/chat prompt: use my_tool`
   - Mention bot: `@Bot please use my_tool`

### 4. **Memory System Development**

When working with conversation memory:

```typescript
// Add messages to memory
await memoryManager.addMessage(userId, channelId, 'user', content);

// Retrieve enhanced history with RAG
const history = await memoryManager.getEnhancedHistory(
  userId, 
  channelId, 
  query
);
```

**Best practices:**
- Always add both user and assistant messages
- Use consistent userId and channelId format
- Handle memory failures gracefully

## Testing

### Test Structure

```bash
src/
├── __tests__/
│   ├── tools/
│   │   ├── ToolRegistry.test.ts
│   │   └── ExampleTool.test.ts
│   ├── memory/
│   │   └── MemoryManager.test.ts
│   └── utils/
│       └── EmbedResponse.test.ts
```

### Unit Testing

Use Bun's built-in test runner:

```typescript
import { test, expect } from 'bun:test';
import { calculatorTool } from '../tools/examples/ExampleTool';

test('calculator tool adds numbers correctly', async () => {
  const result = await calculatorTool.execute({
    operation: 'add',
    a: 5,
    b: 3
  });
  
  expect(result.result).toBe(8);
  expect(result.operation).toBe('5 + 3');
});
```

### Integration Testing

Test Discord integration with mock clients:

```typescript
import { test, expect, mock } from 'bun:test';

test('bot responds to mentions', async () => {
  const mockMessage = createMockMessage();
  const response = await handleMessage(mockMessage);
  
  expect(response).toBeDefined();
});
```

### Running Tests

```bash
# Run all tests
bun test

# Run specific test file
bun test src/__tests__/tools/ToolRegistry.test.ts

# Run tests with coverage
bun test --coverage
```

## Debugging

### 1. **Console Logging**

The bot includes comprehensive logging:

```typescript
console.log(`🧠 Using ${conversationHistory.length} messages as context`);
console.log(`🔧 Tools used: ${toolsUsed.join(', ')}`);
console.log(`📊 Token usage: ${tokenUsage.inputTokens} input, ${tokenUsage.outputTokens} output`);
```

### 2. **LangSmith Integration**

Enable tracing for AI model debugging:

```bash
LANGSMITH_API_KEY=your_key_here
LANGSMITH_TRACING=true
```

### 3. **Error Handling**

All major functions include error handling:

```typescript
try {
  const result = await toolRegistry.executeTools(toolCalls);
} catch (error) {
  console.error('Tool execution failed:', error);
  await EmbedResponse.sendError(message, 'Tool execution failed');
}
```

### 4. **Circuit Breaker Debugging**

Monitor circuit breaker state:

```typescript
console.log('Circuit breaker status:', {
  tripped: cb.tripped,
  until: cb.untilTs,
  activeModel: getActiveModelName()
});
```

### 5. **Memory Debugging**

Debug conversation memory:

```typescript
const history = await memoryManager.getEnhancedHistory(userId, channelId, query);
console.log('Memory context:', history.length, 'messages');
```

## Performance Optimization

### 1. **Memory Management**

- **Context Limiting**: Keep last 50 messages maximum
- **Automatic Pruning**: Old messages are removed automatically
- **Efficient Retrieval**: RAG system optimizes context selection

### 2. **Token Optimization**

```typescript
// Limit context for second LLM call to reduce tokens
const recentContext = messages
  .filter((m: any) => !(m instanceof SystemMessage))
  .slice(-6);
```

### 3. **Caching Strategies**

- **Message Deduplication**: 5-minute TTL for processed messages
- **Tool Result Caching**: Consider implementing for expensive operations
- **Embed Caching**: Static embeds can be cached

### 4. **Async Optimization**

Use Promise.all for parallel operations:

```typescript
const [tokenUsage, toolResults] = await Promise.all([
  tokenTracker.getUsage(),
  toolRegistry.executeTools(toolCalls)
]);
```

### 5. **Resource Monitoring**

Monitor via metrics dashboard:
- Token usage and costs
- Tool execution times
- Error rates
- Memory usage

## Security Considerations

### 1. **Environment Variables**

Never commit sensitive data:

```typescript
// ✅ Good
const apiKey = process.env.OPENAI_API_KEY;

// ❌ Bad
const apiKey = 'sk-abc123...';
```

### 2. **Input Validation**

All tool inputs are validated with Zod schemas:

```typescript
const schema = z.object({
  prompt: z.string().min(1).max(1000),
  options: z.object({...}).optional()
});
```

### 3. **Content Filtering**

- OpenAI moderation for image generation
- Discord's built-in content filtering
- Custom content validation in tools

### 4. **Rate Limiting**

Implement backoff strategies:

```typescript
// Built into Discord.js and external API clients
// Consider additional application-level rate limiting
```

### 5. **Error Information**

Don't expose sensitive information in errors:

```typescript
// ✅ Good
console.error('API call failed:', error.message);
await EmbedResponse.sendError(message, 'Service temporarily unavailable');

// ❌ Bad
await EmbedResponse.sendError(message, error.stack);
```

## Contributing Guidelines

### 1. **Code Style**

- Use **TypeScript** strictly
- Follow **ESLint** configuration
- Use **Prettier** for formatting
- Include **JSDoc** comments for public APIs

### 2. **Commit Messages**

Use conventional commits:

```
feat: add web search tool with Tavily integration
fix: resolve memory leak in conversation history
docs: update API documentation for tool system
test: add unit tests for calculator tool
```

### 3. **Pull Request Process**

1. **Fork** the repository
2. **Create** feature branch
3. **Implement** changes with tests
4. **Update** documentation
5. **Submit** PR with clear description

### 4. **Code Review Checklist**

- [ ] TypeScript types are correct
- [ ] Error handling is comprehensive
- [ ] Tests cover new functionality
- [ ] Documentation is updated
- [ ] Performance impact is considered
- [ ] Security implications are reviewed

### 5. **Release Process**

1. **Version bump** in `package.json`
2. **Update** CHANGELOG.md
3. **Tag** release: `git tag v1.2.3`
4. **Deploy** to production environment
5. **Monitor** for issues

## Troubleshooting Common Issues

### 1. **Hot Reload Issues**

If experiencing duplicate events:

```bash
# Kill all node processes and restart
pkill -f node
pkill -f bun
bun run dev
```

### 2. **Memory Leaks**

Monitor memory usage:

```typescript
console.log('Memory usage:', process.memoryUsage());
```

### 3. **API Rate Limits**

Implement exponential backoff:

```typescript
const delay = Math.pow(2, retryCount) * 1000;
await new Promise(resolve => setTimeout(resolve, delay));
```

### 4. **Database Connection Issues**

ChromaDB connection problems:

```bash
# Check ChromaDB status
curl http://localhost:8000/api/v1/heartbeat

# Restart ChromaDB
docker restart chromadb
```

### 5. **TypeScript Compilation Errors**

Common fixes:

```bash
# Clear Bun cache
rm -rf node_modules/.cache

# Reinstall dependencies
rm -rf node_modules
bun install

# Check TypeScript version
bun --version
```

This developer guide provides the technical foundation for contributing to and extending the GaLt Discord bot. For specific implementation details, refer to the source code and API documentation.