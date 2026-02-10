/**
 * Experiment Observer
 * 
 * Collects and analyzes data from the agent experiment.
 * Tracks message patterns, conversation dynamics, and agent behavior.
 */

import { appendFileSync, mkdirSync, existsSync, writeFileSync } from 'fs';
import { dirname } from 'path';

export class Observer {
  constructor(config = {}) {
    this.logPath = config.logPath || '/data/logs/messages.jsonl';
    this.snapshotDir = config.snapshotDir || '/data/logs/snapshots';
    this.metrics = {
      messageCount: {},        // agent -> count
      messageLengths: {},      // agent -> [lengths]
      responseLatencies: {},   // agent -> [ms values]
      hourlyActivity: {},      // hour -> count
      channelActivity: {},     // channel -> count
      interactions: {},        // "agent1->agent2" -> count (reply/mention tracking)
      recentMessages: [],      // last 50 messages for context
      conversationThreads: 0,
      startTime: Date.now(),
    };
    
    // Ensure directories exist
    mkdirSync(dirname(this.logPath), { recursive: true });
    mkdirSync(this.snapshotDir, { recursive: true });
  }
  
  // Log a message event
  logMessage(event) {
    const entry = {
      timestamp: new Date().toISOString(),
      agent: event.agent,
      channel: event.channel,
      messageLength: event.content?.length || 0,
      type: event.type || 'message',
      ...(event.replyTo && { replyTo: event.replyTo }),
    };
    
    // Write to JSONL
    try {
      appendFileSync(this.logPath, JSON.stringify(entry) + '\n');
    } catch (e) {
      console.error('Failed to log message:', e.message);
    }
    
    // Update metrics
    const agent = event.agent || 'unknown';
    this.metrics.messageCount[agent] = (this.metrics.messageCount[agent] || 0) + 1;
    
    if (!this.metrics.messageLengths[agent]) this.metrics.messageLengths[agent] = [];
    this.metrics.messageLengths[agent].push(entry.messageLength);
    // Keep only last 100 per agent
    if (this.metrics.messageLengths[agent].length > 100) {
      this.metrics.messageLengths[agent] = this.metrics.messageLengths[agent].slice(-100);
    }
    
    const hour = new Date().getHours();
    this.metrics.hourlyActivity[hour] = (this.metrics.hourlyActivity[hour] || 0) + 1;
    
    if (event.channel) {
      this.metrics.channelActivity[event.channel] = (this.metrics.channelActivity[event.channel] || 0) + 1;
    }
    
    // Track interactions (who replies to whom)
    if (event.replyTo) {
      const key = `${agent}->${event.replyTo}`;
      this.metrics.interactions[key] = (this.metrics.interactions[key] || 0) + 1;
    }
    
    // Track mentions
    if (event.mentions && Array.isArray(event.mentions)) {
      for (const mentioned of event.mentions) {
        const key = `${agent}->${mentioned}`;
        this.metrics.interactions[key] = (this.metrics.interactions[key] || 0) + 1;
      }
    }
    
    // Keep recent messages for context
    this.metrics.recentMessages.push({
      agent,
      channel: event.channel,
      length: entry.messageLength,
      timestamp: entry.timestamp,
    });
    if (this.metrics.recentMessages.length > 50) this.metrics.recentMessages.shift();
  }
  
  // Take a snapshot of the current experiment state
  takeSnapshot(agents, tokenPool) {
    const snapshot = {
      timestamp: new Date().toISOString(),
      uptimeMinutes: Math.round((Date.now() - this.metrics.startTime) / 60000),
      agents: agents.map(a => ({
        name: a.name,
        role: a.role,
        model: a.model,
        uptime: Math.round((Date.now() - new Date(a.createdAt).getTime()) / 60000),
        messageCount: this.metrics.messageCount[a.name] || 0,
      })),
      totalMessages: Object.values(this.metrics.messageCount).reduce((a, b) => a + b, 0),
      tokensAvailable: tokenPool.filter(t => !t.assignedTo).length,
      tokensTotal: tokenPool.length,
      channelActivity: { ...this.metrics.channelActivity },
    };
    
    const filename = `snapshot-${Date.now()}.json`;
    try {
      writeFileSync(`${this.snapshotDir}/${filename}`, JSON.stringify(snapshot, null, 2));
    } catch (e) {
      console.error('Failed to write snapshot:', e.message);
    }
    
    return snapshot;
  }
  
  // Get current metrics summary
  getSummary() {
    const totalMessages = Object.values(this.metrics.messageCount).reduce((a, b) => a + b, 0);
    const uptimeMin = Math.round((Date.now() - this.metrics.startTime) / 60000);
    
    // Calculate per-agent stats
    const agentStats = {};
    for (const [agent, count] of Object.entries(this.metrics.messageCount)) {
      const lengths = this.metrics.messageLengths[agent] || [];
      const avgLength = lengths.length > 0 ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : 0;
      agentStats[agent] = {
        messages: count,
        avgMessageLength: avgLength,
        messagesPerMinute: uptimeMin > 0 ? (count / uptimeMin).toFixed(2) : 0,
      };
    }
    
    // Find most/least active
    const sorted = Object.entries(this.metrics.messageCount).sort((a, b) => b[1] - a[1]);
    
    // Build interaction graph
    const interactionGraph = {};
    for (const [key, count] of Object.entries(this.metrics.interactions)) {
      const [from, to] = key.split('->');
      if (!interactionGraph[from]) interactionGraph[from] = {};
      interactionGraph[from][to] = count;
    }
    
    // Find strongest connections
    const connections = Object.entries(this.metrics.interactions)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([key, count]) => ({ pair: key, count }));
    
    return {
      uptimeMinutes: uptimeMin,
      totalMessages,
      messagesPerMinute: uptimeMin > 0 ? (totalMessages / uptimeMin).toFixed(2) : 0,
      agentStats,
      mostActive: sorted[0] ? sorted[0][0] : null,
      leastActive: sorted.length > 1 ? sorted[sorted.length - 1][0] : null,
      channelActivity: this.metrics.channelActivity,
      hourlyActivity: this.metrics.hourlyActivity,
      interactionGraph,
      topConnections: connections,
      recentMessages: this.metrics.recentMessages.slice(-20),
    };
  }
}
