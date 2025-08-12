import fs from 'fs';
import path from 'path';

export interface DayStats {
  date: string; // YYYY-MM-DD
  requests: number;
  tokens: { input: number; output: number; total: number; costUsd: number };
  toolCalls: {
    total: number;
    success: number;
    failure: number;
    byTool: Record<string, { total: number; success: number; failure: number }>;
  };
  image: { count: number; estimatedCostUsd: number };
}

export class MetricsManager {
  private static instance: MetricsManager | undefined;
  private dataFile: string;
  private byDay: Map<string, DayStats> = new Map();
  private saveScheduled = false;

  static getInstance(): MetricsManager {
    if (!this.instance) this.instance = new MetricsManager();
    return this.instance;
  }

  private constructor() {
    const dataDir = path.resolve(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    this.dataFile = path.join(dataDir, 'metrics.json');
    this.loadFromDisk();
    process.on('exit', () => this.flush());
    process.on('SIGINT', () => { this.flush(); process.exit(0); });
  }

  private loadFromDisk() {
    try {
      if (fs.existsSync(this.dataFile)) {
        const raw = fs.readFileSync(this.dataFile, 'utf-8');
        const parsed: DayStats[] = JSON.parse(raw || '[]');
        this.byDay.clear();
        for (const d of parsed) this.byDay.set(d.date, d);
      }
    } catch (err) {
      console.warn('Metrics: Failed to load metrics.json:', err);
    }
  }

  private scheduleSave() {
    if (this.saveScheduled) return;
    this.saveScheduled = true;
    setTimeout(() => {
      try {
        const all = Array.from(this.byDay.values());
        fs.writeFileSync(this.dataFile, JSON.stringify(all, null, 2));
      } catch (err) {
        console.warn('Metrics: Failed to persist metrics:', err);
      } finally {
        this.saveScheduled = false;
      }
    }, 1000).unref?.();
  }

  private getDayKey(date: Date = new Date()): string {
    // Ensure a valid YYYY-MM-DD string even if date is invalid/undefined
    const d = (date instanceof Date && !Number.isNaN(date.getTime())) ? date : new Date();
    const iso = d.toISOString();
    const parts = iso.split('T');
    return parts[0] ?? iso.slice(0, 10);
  }

  private ensureDay(dateKey: string): DayStats {
    let day = this.byDay.get(dateKey);
    if (!day) {
      day = {
        date: dateKey,
        requests: 0,
        tokens: { input: 0, output: 0, total: 0, costUsd: 0 },
        toolCalls: { total: 0, success: 0, failure: 0, byTool: {} },
        image: { count: 0, estimatedCostUsd: 0 },
      };
      this.byDay.set(dateKey, day);
    }
    return day;
  }

  recordRequest() {
    const day = this.ensureDay(this.getDayKey());
    day.requests += 1;
    this.scheduleSave();
  }

  recordTokens(inputTokens: number, outputTokens: number, totalTokens: number, costUsd: number = 0) {
    const day = this.ensureDay(this.getDayKey());
    day.tokens.input += inputTokens;
    day.tokens.output += outputTokens;
    day.tokens.total += totalTokens;
    day.tokens.costUsd += costUsd;
    this.scheduleSave();
  }

  recordToolCall(toolName: string, success: boolean) {
    const day = this.ensureDay(this.getDayKey());
    day.toolCalls.total += 1;
    if (success) day.toolCalls.success += 1; else day.toolCalls.failure += 1;
    if (!day.toolCalls.byTool[toolName]) {
      day.toolCalls.byTool[toolName] = { total: 0, success: 0, failure: 0 };
    }
    const rec = day.toolCalls.byTool[toolName];
    rec.total += 1;
    if (success) rec.success += 1; else rec.failure += 1;
    this.scheduleSave();
  }

  recordImageGeneration(estimatedCostUsd: number) {
    const day = this.ensureDay(this.getDayKey());
    day.image.count += 1;
    day.image.estimatedCostUsd += estimatedCostUsd;
    this.scheduleSave();
  }

  getAllDays(): DayStats[] {
    return Array.from(this.byDay.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  flush() {
    try {
      const all = Array.from(this.byDay.values());
      fs.writeFileSync(this.dataFile, JSON.stringify(all, null, 2));
    } catch {}
  }
}

export const metrics = MetricsManager.getInstance();


