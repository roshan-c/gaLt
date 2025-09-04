# GaLt Documentation

Welcome to the comprehensive documentation for GaLt, an advanced Discord bot with AI capabilities, tool system, and persistent memory.

## 📚 Documentation Overview

This documentation suite provides complete coverage for developers, administrators, and users working with GaLt.

### Quick Navigation

| Document | Description | Audience |
|----------|-------------|----------|
| **[Main README](../README.md)** | Project overview, quick start, and basic usage | Everyone |
| **[API Documentation](./API.md)** | Complete API reference for all components | Developers |
| **[Developer Guide](./DEVELOPER_GUIDE.md)** | Technical development information and workflows | Developers |
| **[Deployment Guide](./DEPLOYMENT.md)** | Production deployment and infrastructure setup | DevOps/Admins |
| **[Architecture Documentation](./ARCHITECTURE.md)** | System design and technical architecture | Architects/Senior Devs |

## 🚀 Getting Started

### For Users
1. Start with the **[Main README](../README.md)** for basic setup and usage
2. Check the **[Usage section](../README.md#usage)** for commands and features

### For Developers
1. Read the **[Main README](../README.md)** for project overview
2. Follow the **[Developer Guide](./DEVELOPER_GUIDE.md)** for development setup
3. Reference the **[API Documentation](./API.md)** for implementation details
4. Study the **[Architecture Documentation](./ARCHITECTURE.md)** for system design

### For Administrators
1. Review the **[Main README](../README.md)** for feature overview
2. Follow the **[Deployment Guide](./DEPLOYMENT.md)** for production setup
3. Check the **[Security Best Practices](./DEPLOYMENT.md#security-best-practices)** section

## 📖 Documentation Structure

```
docs/
├── README.md              # This file - documentation index
├── API.md                 # Complete API reference
├── DEVELOPER_GUIDE.md     # Development workflows and best practices  
├── DEPLOYMENT.md          # Production deployment guide
└── ARCHITECTURE.md        # System architecture and design
```

## 🔧 Key Components

GaLt consists of several key components documented across these guides:

### Core System
- **Discord Bot Client** - Event handling and Discord integration
- **Circuit Breaker** - Automatic failover between AI models (Gemini ↔ OpenAI)
- **Memory Manager** - RAG-based conversation context and history
- **Tool Registry** - Extensible tool system for bot functionality
- **Metrics System** - Usage tracking and performance monitoring

### AI Integration  
- **Google Gemini** (Primary model)
- **OpenAI GPT** (Fallback model)
- **LangChain** orchestration
- **Tool calling** capabilities

### Built-in Tools
- **Calculator** - Mathematical operations
- **Time Tool** - World time and timezone support  
- **Weather Tool** - Mock weather data
- **Random Facts** - Educational content generation
- **Image Generation** - DALL-E integration with moderation
- **Web Search** - Live search via Tavily with AI summarization
- **Context Summarization** - Channel conversation analysis

### Infrastructure
- **ChromaDB** - Vector database for memory storage
- **Bun Runtime** - High-performance JavaScript runtime
- **TypeScript** - Type-safe development
- **Docker** - Containerized deployment support

## 📋 Common Tasks

### Development Tasks
- **[Setting up development environment](./DEVELOPER_GUIDE.md#development-setup)**
- **[Creating custom tools](./DEVELOPER_GUIDE.md#tool-development-lifecycle)**
- **[Testing and debugging](./DEVELOPER_GUIDE.md#testing)**
- **[Contributing code](./DEVELOPER_GUIDE.md#contributing-guidelines)**

### Deployment Tasks
- **[Local development setup](./DEPLOYMENT.md#local-development)**
- **[VPS deployment](./DEPLOYMENT.md#vps-deployment)**
- **[Docker deployment](./DEPLOYMENT.md#docker-deployment)**
- **[Cloud platform deployment](./DEPLOYMENT.md#cloud-platform-deployment)**
- **[Production monitoring](./DEPLOYMENT.md#monitoring-and-maintenance)**

### API Integration Tasks
- **[Tool system integration](./API.md#tool-system-api)**
- **[Memory system usage](./API.md#memory-manager-api)**
- **[Metrics collection](./API.md#metrics-api)**
- **[Response formatting](./API.md#embed-response-api)**

## 🛠️ Configuration Reference

### Environment Variables
Complete reference available in [API Documentation - Environment Variables](./API.md#environment-variables)

### Core Configuration
```bash
# Required
DISCORD_TOKEN=your_discord_bot_token
GOOGLE_API_KEY=your_google_api_key  
OPENAI_API_KEY=your_openai_api_key
TAVILY_API_KEY=your_tavily_api_key

# Optional
GOOGLE_MODEL=gemini-2.0-flash
CHROMA_URL=http://localhost:8000
METRICS_PORT=8787
```

### Tool Configuration
Tools are configured programmatically in TypeScript. See [API Documentation - Tool System](./API.md#tool-system-api) for details.

## 🚨 Troubleshooting

### Common Issues

| Issue | Quick Fix | Documentation |
|-------|-----------|---------------|
| Bot not responding | Check Discord token and permissions | [Deployment Troubleshooting](./DEPLOYMENT.md#troubleshooting) |
| High memory usage | Restart service, check conversation limits | [Performance Guide](./DEVELOPER_GUIDE.md#performance-optimization) |
| API errors | Verify API keys and rate limits | [API Documentation](./API.md#error-handling) |
| Tool failures | Check tool logs and validation | [Developer Guide](./DEVELOPER_GUIDE.md#debugging) |

### Getting Help

1. **Check the relevant documentation** section first
2. **Search existing issues** on GitHub
3. **Create a new issue** with detailed reproduction steps
4. **Join the community** for real-time support

## 📊 Metrics and Monitoring

GaLt includes a comprehensive metrics system:

- **Built-in Dashboard**: Available at `http://localhost:8787`
- **API Endpoint**: `GET /api/metrics` for programmatic access  
- **Tracked Metrics**: Requests, tokens, tool usage, costs, errors
- **Daily Aggregation**: Automatic daily statistics

See [API Documentation - Metrics API](./API.md#metrics-api) for complete details.

## 🔒 Security Considerations

Key security features and recommendations:

- **Input Validation**: Zod schema validation for all inputs
- **API Key Management**: Environment variable based configuration
- **Content Filtering**: OpenAI moderation for generated content
- **Rate Limiting**: Built-in protection against abuse
- **Secure Deployment**: HTTPS, proper firewall configuration

Detailed security information in [Deployment Guide - Security](./DEPLOYMENT.md#security-best-practices).

## 📈 Performance Optimization

GaLt is optimized for performance:

- **Token Management**: Smart context limiting and RAG optimization
- **Circuit Breaker**: Automatic failover to prevent cascading failures
- **Caching**: Multiple levels of caching for improved response times
- **Resource Monitoring**: Built-in metrics for performance tracking

See [Developer Guide - Performance](./DEVELOPER_GUIDE.md#performance-optimization) for optimization strategies.

## 🔄 Updates and Maintenance

### Updating GaLt
1. **Pull latest changes**: `git pull origin main`
2. **Update dependencies**: `bun install`  
3. **Run tests**: `bun test`
4. **Deploy**: Follow deployment guide for your environment

### Maintenance Tasks
- **Log rotation**: Configure log management
- **Database cleanup**: Regular ChromaDB maintenance
- **Metric analysis**: Review usage patterns and costs
- **Security updates**: Keep dependencies current

## 🤝 Contributing

We welcome contributions! Please see:

- **[Contributing Guidelines](./DEVELOPER_GUIDE.md#contributing-guidelines)** for code contributions
- **[Development Workflow](./DEVELOPER_GUIDE.md#development-workflow)** for development process
- **[Code Style](./DEVELOPER_GUIDE.md#code-style)** for coding standards

## 📝 License

This project is licensed under the MIT License. See the [LICENSE](../LICENSE) file for details.

## 📞 Support

- **Documentation Issues**: Create an issue for documentation improvements
- **Bug Reports**: Use GitHub issues with detailed reproduction steps  
- **Feature Requests**: Submit enhancement requests via GitHub issues
- **Community Support**: Join our Discord server for real-time help

---

**Note**: This documentation is continuously updated. If you find any outdated information or have suggestions for improvement, please create an issue or submit a pull request.