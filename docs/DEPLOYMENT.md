# Deployment Guide - GaLt Discord Bot

## Table of Contents
- [Deployment Options](#deployment-options)
- [Local Development](#local-development)
- [VPS Deployment](#vps-deployment)
- [Docker Deployment](#docker-deployment)
- [Cloud Platform Deployment](#cloud-platform-deployment)
- [Environment Configuration](#environment-configuration)
- [Security Best Practices](#security-best-practices)
- [Monitoring and Maintenance](#monitoring-and-maintenance)
- [Scaling Considerations](#scaling-considerations)
- [Troubleshooting](#troubleshooting)

## Deployment Options

### Quick Comparison

| Option | Cost | Complexity | Scalability | Maintenance |
|--------|------|------------|-------------|-------------|
| **Local Dev** | Free | Low | None | Manual |
| **VPS** | Low | Medium | Limited | Manual |
| **Docker** | Low-Medium | Medium | Medium | Semi-Auto |
| **Railway** | Free-Low | Low | High | Automatic |
| **Render** | Free-Medium | Low | High | Automatic |
| **DigitalOcean** | Medium | Medium | High | Manual |
| **AWS/GCP** | Variable | High | Very High | Complex |

## Local Development

### Prerequisites
- Bun v1.2.19+
- Discord Bot Token
- API Keys (Google, OpenAI, Tavily)

### Setup
```bash
# Clone repository
git clone https://github.com/roshan-c/gaLt.git
cd gaLt

# Install dependencies
bun install

# Configure environment
cp .env.example .env
# Edit .env with your API keys

# Run development server
bun run dev
```

### Development Features
- **Hot Reload**: Automatic restart on file changes
- **Debug Logging**: Comprehensive console output
- **Metrics Dashboard**: Available at http://localhost:8787
- **Memory Persistence**: State maintained across reloads

## VPS Deployment

### Recommended VPS Providers
- **DigitalOcean**: $6-12/month droplets
- **Vultr**: $6-12/month instances  
- **Linode**: $5-10/month nanode plans
- **Hetzner**: €4-8/month cloud servers

### Ubuntu 22.04 LTS Setup

#### 1. Initial Server Setup
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install dependencies
sudo apt install -y curl unzip git build-essential

# Create bot user
sudo useradd -m -s /bin/bash galt
sudo usermod -aG sudo galt
su - galt
```

#### 2. Install Bun
```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

# Verify installation
bun --version
```

#### 3. Deploy Application
```bash
# Clone repository
git clone https://github.com/roshan-c/gaLt.git
cd gaLt

# Install dependencies
bun install

# Configure environment
cp .env.example .env
nano .env  # Add your API keys

# Build for production
bun run build
```

#### 4. Process Management with PM2
```bash
# Install PM2
sudo npm install -g pm2

# Create PM2 ecosystem file
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'galt-bot',
    script: 'bun',
    args: 'run start',
    cwd: '/home/galt/gaLt',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
};
EOF

# Create logs directory
mkdir -p logs

# Start with PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

#### 5. Nginx Reverse Proxy (for metrics dashboard)
```bash
# Install Nginx
sudo apt install -y nginx

# Configure Nginx
sudo tee /etc/nginx/sites-available/galt-metrics << 'EOF'
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

# Enable site
sudo ln -s /etc/nginx/sites-available/galt-metrics /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

#### 6. SSL with Let's Encrypt
```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Obtain SSL certificate
sudo certbot --nginx -d your-domain.com

# Auto-renewal
sudo crontab -e
# Add: 0 12 * * * /usr/bin/certbot renew --quiet
```

### System Service Alternative

Create systemd service instead of PM2:

```bash
# Create service file
sudo tee /etc/systemd/system/galt-bot.service << 'EOF'
[Unit]
Description=GaLt Discord Bot
After=network.target

[Service]
Type=simple
User=galt
WorkingDirectory=/home/galt/gaLt
Environment=NODE_ENV=production
ExecStart=/home/galt/.bun/bin/bun run start
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service
sudo systemctl enable galt-bot
sudo systemctl start galt-bot
sudo systemctl status galt-bot
```

## Docker Deployment

### Dockerfile
```dockerfile
# Use Bun's official image
FROM oven/bun:1 as base

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json bun.lockb ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Build application
RUN bun run build

# Expose metrics port
EXPOSE 8787

# Create non-root user
RUN addgroup --system --gid 1001 galt
RUN adduser --system --uid 1001 galt
USER galt

# Start application
CMD ["bun", "run", "start"]
```

### Docker Compose
```yaml
version: '3.8'

services:
  galt-bot:
    build: .
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - DISCORD_TOKEN=${DISCORD_TOKEN}
      - GOOGLE_API_KEY=${GOOGLE_API_KEY}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - TAVILY_API_KEY=${TAVILY_API_KEY}
      - CHROMA_URL=http://chroma:8000
    ports:
      - "8787:8787"
    depends_on:
      - chroma
    volumes:
      - ./logs:/app/logs

  chroma:
    image: chromadb/chroma:latest
    restart: unless-stopped
    ports:
      - "8000:8000"
    volumes:
      - chroma_data:/chroma/chroma
    environment:
      - IS_PERSISTENT=TRUE
      - PERSIST_DIRECTORY=/chroma/chroma

  nginx:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - galt-bot

volumes:
  chroma_data:
```

### Docker Commands
```bash
# Build and run
docker-compose up -d

# View logs
docker-compose logs -f galt-bot

# Update deployment
git pull
docker-compose build
docker-compose up -d

# Stop deployment
docker-compose down
```

## Cloud Platform Deployment

### Railway Deployment

1. **Create Railway Account** at [railway.app](https://railway.app)

2. **Deploy from GitHub:**
   - Connect your repository
   - Railway will auto-detect Bun/Node.js

3. **Configure Environment Variables:**
   ```
   DISCORD_TOKEN=your_token_here
   GOOGLE_API_KEY=your_key_here
   OPENAI_API_KEY=your_key_here
   TAVILY_API_KEY=your_key_here
   METRICS_PORT=8787
   ```

4. **Deploy Command:**
   ```json
   {
     "build": "bun install && bun run build",
     "start": "bun run start"
   }
   ```

### Render Deployment

1. **Create Render Account** at [render.com](https://render.com)

2. **Create Web Service:**
   - Connect repository
   - Runtime: Node.js
   - Build Command: `bun install && bun run build`
   - Start Command: `bun run start`

3. **Environment Variables:** Same as Railway

4. **Health Check:** Configure health check on `/api/metrics`

### Heroku Deployment

```bash
# Install Heroku CLI
curl https://cli-assets.heroku.com/install.sh | sh

# Login and create app
heroku login
heroku create your-galt-bot

# Configure buildpack
heroku buildpacks:add https://github.com/oven-sh/heroku-buildpack-bun

# Set environment variables
heroku config:set DISCORD_TOKEN=your_token_here
heroku config:set GOOGLE_API_KEY=your_key_here
# ... other variables

# Deploy
git push heroku main

# View logs
heroku logs --tail
```

### AWS Deployment

#### EC2 with Auto Scaling
```bash
# Create launch template
aws ec2 create-launch-template \
  --launch-template-name galt-bot-template \
  --launch-template-data '{
    "ImageId": "ami-0c94855ba95b798c7",
    "InstanceType": "t3.micro",
    "SecurityGroupIds": ["sg-12345"],
    "UserData": "base64-encoded-startup-script"
  }'

# Create auto scaling group
aws autoscaling create-auto-scaling-group \
  --auto-scaling-group-name galt-bot-asg \
  --launch-template LaunchTemplateName=galt-bot-template \
  --min-size 1 \
  --max-size 3 \
  --desired-capacity 1
```

#### ECS Fargate
```json
{
  "family": "galt-bot",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::account:role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "galt-bot",
      "image": "your-account.dkr.ecr.region.amazonaws.com/galt-bot:latest",
      "portMappings": [
        {
          "containerPort": 8787,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "NODE_ENV",
          "value": "production"
        }
      ],
      "secrets": [
        {
          "name": "DISCORD_TOKEN",
          "valueFrom": "arn:aws:secretsmanager:region:account:secret:discord-token"
        }
      ]
    }
  ]
}
```

## Environment Configuration

### Production Environment Variables

```bash
# Core Configuration
NODE_ENV=production
DISCORD_TOKEN=your_bot_token_here

# AI Model Configuration
GOOGLE_API_KEY=your_google_api_key_here
GOOGLE_MODEL=gemini-2.0-flash
OPENAI_API_KEY=your_openai_api_key_here

# External Services
TAVILY_API_KEY=your_tavily_api_key_here
CHROMA_URL=http://localhost:8000

# Monitoring (Optional)
LANGSMITH_API_KEY=your_langsmith_key_here
LANGSMITH_TRACING=false

# System Configuration
METRICS_PORT=8787
IMAGE_COST_1024_LOW_USD=0.04
```

### Environment-Specific Configurations

#### Development
```bash
NODE_ENV=development
LANGSMITH_TRACING=true
# More verbose logging
# Hot reload enabled
```

#### Staging
```bash
NODE_ENV=staging
# Test API keys
# Limited rate limits
```

#### Production
```bash
NODE_ENV=production
LANGSMITH_TRACING=false
# Production API keys
# Full rate limits
```

### Secrets Management

#### AWS Secrets Manager
```bash
# Store Discord token
aws secretsmanager create-secret \
  --name "galt-bot/discord-token" \
  --secret-string "your-discord-token"

# Store API keys
aws secretsmanager create-secret \
  --name "galt-bot/api-keys" \
  --secret-string '{
    "google_api_key": "your-key",
    "openai_api_key": "your-key",
    "tavily_api_key": "your-key"
  }'
```

#### Docker Secrets
```yaml
version: '3.8'
services:
  galt-bot:
    build: .
    secrets:
      - discord_token
      - api_keys
    environment:
      - DISCORD_TOKEN_FILE=/run/secrets/discord_token

secrets:
  discord_token:
    file: ./secrets/discord_token.txt
  api_keys:
    file: ./secrets/api_keys.json
```

## Security Best Practices

### 1. **Server Security**

```bash
# Update system regularly
sudo apt update && sudo apt upgrade -y

# Configure firewall
sudo ufw enable
sudo ufw allow ssh
sudo ufw allow 80
sudo ufw allow 443

# Disable root login
sudo nano /etc/ssh/sshd_config
# Set: PermitRootLogin no
sudo systemctl restart ssh

# Install fail2ban
sudo apt install -y fail2ban
```

### 2. **Application Security**

- **Never commit secrets** to version control
- **Use environment variables** for all sensitive data
- **Validate all inputs** with Zod schemas
- **Implement rate limiting** for API endpoints
- **Use HTTPS** for all external communications

### 3. **API Security**

```typescript
// Input validation
const schema = z.object({
  prompt: z.string().min(1).max(2000),
  options: z.object({}).optional()
});

// Rate limiting (if implementing custom API)
const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
```

### 4. **Database Security**

- **Use connection encryption** for ChromaDB
- **Implement backup strategies**
- **Monitor access patterns**
- **Regular security audits**

### 5. **Container Security**

```dockerfile
# Use non-root user
RUN addgroup --system --gid 1001 galt
RUN adduser --system --uid 1001 galt
USER galt

# Minimal base image
FROM oven/bun:1-alpine

# Health checks
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8787/api/metrics || exit 1
```

## Monitoring and Maintenance

### 1. **Application Monitoring**

#### Built-in Metrics Dashboard
- Access at `http://your-domain:8787`
- Tracks requests, tokens, tool usage, costs
- Daily aggregated statistics

#### Custom Monitoring Setup
```typescript
// Add custom metrics
metrics.recordCustomEvent('user_interaction', {
  userId: message.author.id,
  toolsUsed: toolsUsed.length,
  responseTime: Date.now() - startTime
});
```

### 2. **Log Management**

#### Structured Logging
```typescript
// Implement structured logging
const logger = {
  info: (message: string, meta?: object) => {
    console.log(JSON.stringify({
      level: 'info',
      timestamp: new Date().toISOString(),
      message,
      ...meta
    }));
  },
  error: (message: string, error?: Error, meta?: object) => {
    console.error(JSON.stringify({
      level: 'error',
      timestamp: new Date().toISOString(),
      message,
      error: error?.stack,
      ...meta
    }));
  }
};
```

#### Log Aggregation
```bash
# Using journalctl for systemd services
sudo journalctl -u galt-bot -f

# Using PM2 logs
pm2 logs galt-bot --raw | bunyan

# Docker logs
docker-compose logs -f galt-bot
```

### 3. **Health Checks**

```typescript
// Health check endpoint
app.get('/health', (req, res) => {
  const health = {
    uptime: process.uptime(),
    timestamp: Date.now(),
    status: 'OK',
    services: {
      discord: client.readyAt ? 'connected' : 'disconnected',
      memory: memoryManager.isHealthy(),
      tools: toolRegistry.getToolCount(),
      circuit_breaker: cb.tripped ? 'tripped' : 'normal'
    }
  };
  
  res.json(health);
});
```

### 4. **Alerting Setup**

#### Uptime Monitoring
- **UptimeRobot**: Free tier for basic monitoring
- **StatusCake**: Comprehensive monitoring
- **Pingdom**: Enterprise monitoring

#### Custom Alerts
```bash
# Simple email alerts for critical errors
#!/bin/bash
if ! curl -f http://localhost:8787/health; then
  echo "GaLt bot is down!" | mail -s "Alert: Bot Down" admin@yourdomain.com
fi
```

### 5. **Backup Strategies**

#### Database Backups
```bash
# ChromaDB backup
docker exec chroma-container tar czf - /chroma/chroma > backup-$(date +%Y%m%d).tar.gz

# Automated backup script
#!/bin/bash
BACKUP_DIR="/backups"
DATE=$(date +%Y%m%d_%H%M%S)

# Create backup
docker exec chroma tar czf - /chroma/chroma > $BACKUP_DIR/chroma_$DATE.tar.gz

# Cleanup old backups (keep last 7 days)
find $BACKUP_DIR -name "chroma_*.tar.gz" -mtime +7 -delete
```

#### Application State Backup
```bash
# Backup configuration and logs
tar czf galt-backup-$(date +%Y%m%d).tar.gz \
  /home/galt/gaLt/.env \
  /home/galt/gaLt/logs/ \
  /home/galt/gaLt/data/
```

## Scaling Considerations

### 1. **Horizontal Scaling**

For high-traffic servers, consider multiple bot instances:

#### Load Balancing Strategy
```typescript
// Shard-based scaling
const client = new Client({
  shards: 'auto',
  shardCount: 'auto',
  intents: [/* intents */]
});

// Process-based scaling with cluster
import cluster from 'cluster';
import os from 'os';

if (cluster.isPrimary) {
  const numCPUs = os.cpus().length;
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
} else {
  // Worker process runs bot
  startBot();
}
```

#### Message Deduplication
```typescript
// Redis-based deduplication for multi-instance
import Redis from 'ioredis';
const redis = new Redis(process.env.REDIS_URL);

async function isMessageProcessed(messageId: string): Promise<boolean> {
  const key = `processed:${messageId}`;
  const exists = await redis.exists(key);
  if (!exists) {
    await redis.setex(key, 300, '1'); // 5 minute TTL
    return false;
  }
  return true;
}
```

### 2. **Database Scaling**

#### ChromaDB Scaling
- **Distributed ChromaDB**: Run multiple instances
- **Read Replicas**: For improved read performance
- **Caching Layer**: Redis for frequently accessed data

#### Alternative Storage
```typescript
// PostgreSQL for conversation history
import { Client } from 'pg';

const pgClient = new Client({
  connectionString: process.env.DATABASE_URL
});

class PostgreSQLMemoryManager {
  async addMessage(userId: string, channelId: string, role: string, content: string) {
    await pgClient.query(
      'INSERT INTO messages (user_id, channel_id, role, content, timestamp) VALUES ($1, $2, $3, $4, NOW())',
      [userId, channelId, role, content]
    );
  }
  
  async getHistory(userId: string, channelId: string, limit = 50) {
    const result = await pgClient.query(
      'SELECT * FROM messages WHERE user_id = $1 AND channel_id = $2 ORDER BY timestamp DESC LIMIT $3',
      [userId, channelId, limit]
    );
    return result.rows;
  }
}
```

### 3. **Performance Optimization**

#### Caching Strategies
```typescript
// In-memory caching for tool results
const cache = new Map<string, { result: any; timestamp: number }>();

async function getCachedToolResult(key: string, ttlMs: number = 300000) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < ttlMs) {
    return cached.result;
  }
  return null;
}
```

#### Database Connection Pooling
```typescript
// Connection pooling for database
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

### 4. **Cost Optimization**

#### Token Usage Optimization
```typescript
// Implement token budgets per user
const tokenBudgets = new Map<string, number>();

function checkTokenBudget(userId: string, estimatedTokens: number): boolean {
  const used = tokenBudgets.get(userId) || 0;
  const limit = 10000; // tokens per day
  
  if (used + estimatedTokens > limit) {
    return false;
  }
  
  tokenBudgets.set(userId, used + estimatedTokens);
  return true;
}
```

#### Image Generation Limits
```typescript
// Rate limiting for expensive operations
const imageLimits = new Map<string, number>();

function canGenerateImage(userId: string): boolean {
  const today = new Date().toDateString();
  const key = `${userId}:${today}`;
  const count = imageLimits.get(key) || 0;
  
  if (count >= 5) { // 5 images per day per user
    return false;
  }
  
  imageLimits.set(key, count + 1);
  return true;
}
```

## Troubleshooting

### Common Deployment Issues

#### 1. **Port Binding Issues**
```bash
# Check port availability
netstat -tulpn | grep :8787
sudo lsof -i :8787

# Kill process using port
sudo kill -9 $(sudo lsof -t -i:8787)
```

#### 2. **Memory Issues**
```bash
# Monitor memory usage
top -p $(pidof bun)
htop

# Check available memory
free -h

# Restart service if memory usage is high
sudo systemctl restart galt-bot
```

#### 3. **API Key Issues**
```bash
# Verify environment variables
printenv | grep -E "(DISCORD|GOOGLE|OPENAI|TAVILY)"

# Test API connectivity
curl -H "Authorization: Bearer $OPENAI_API_KEY" \
  https://api.openai.com/v1/models
```

#### 4. **Database Connection Issues**
```bash
# Check ChromaDB status
curl http://localhost:8000/api/v1/heartbeat

# Restart ChromaDB
docker restart chromadb

# Check logs
docker logs chromadb
```

#### 5. **Discord Connection Issues**
```bash
# Check bot token validity
# Test in Discord Developer Portal

# Verify bot permissions
# Ensure MESSAGE_CONTENT intent is enabled

# Check rate limits
# Monitor Discord API responses
```

### Performance Troubleshooting

#### 1. **High Response Times**
- Check tool execution times
- Monitor external API latency
- Optimize database queries
- Implement caching

#### 2. **Memory Leaks**
```typescript
// Monitor memory usage
setInterval(() => {
  const usage = process.memoryUsage();
  console.log('Memory usage:', {
    rss: Math.round(usage.rss / 1024 / 1024) + ' MB',
    heapUsed: Math.round(usage.heapUsed / 1024 / 1024) + ' MB',
    external: Math.round(usage.external / 1024 / 1024) + ' MB'
  });
}, 60000);
```

#### 3. **Token Usage Spikes**
- Implement context trimming
- Monitor conversation length
- Add user rate limiting
- Optimize system prompts

### Recovery Procedures

#### 1. **Service Recovery**
```bash
# Automatic restart with PM2
pm2 restart galt-bot

# System service restart
sudo systemctl restart galt-bot

# Docker container restart
docker-compose restart galt-bot
```

#### 2. **Database Recovery**
```bash
# Restore from backup
docker exec -i chroma tar xzf - -C /chroma < backup-20231201.tar.gz
docker restart chroma
```

#### 3. **Configuration Recovery**
```bash
# Restore environment configuration
cp .env.backup .env

# Validate configuration
bun run start --dry-run
```

This deployment guide covers all major deployment scenarios and provides the foundation for running GaLt in production environments with proper monitoring, security, and scalability considerations.