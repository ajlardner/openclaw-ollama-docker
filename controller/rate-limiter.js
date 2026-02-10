/**
 * Per-Agent Message Rate Limiter
 * 
 * Tracks message rates per agent and can trigger warnings/kills
 * when agents spam or go haywire.
 */

export class RateLimiter {
  constructor(config = {}) {
    this.maxPerMinute = config.maxPerMinute || 10;
    this.maxPerHour = config.maxPerHour || 200;
    this.maxMessageLength = config.maxMessageLength || 2000;
    this.warningThreshold = config.warningThreshold || 0.8; // warn at 80% of limit
    
    // agent -> [timestamps]
    this.minuteWindows = {};
    this.hourWindows = {};
    
    // agent -> { warnings, violations }
    this.agentRecords = {};
    
    // Callbacks
    this.onWarning = config.onWarning || (() => {});
    this.onViolation = config.onViolation || (() => {});
  }
  
  /**
   * Check if a message should be allowed.
   * Returns { allowed, reason, warning }
   */
  check(agentName, messageLength = 0) {
    const now = Date.now();
    const oneMinAgo = now - 60000;
    const oneHourAgo = now - 3600000;
    
    // Initialize windows
    if (!this.minuteWindows[agentName]) this.minuteWindows[agentName] = [];
    if (!this.hourWindows[agentName]) this.hourWindows[agentName] = [];
    if (!this.agentRecords[agentName]) this.agentRecords[agentName] = { warnings: 0, violations: 0 };
    
    // Clean old entries
    this.minuteWindows[agentName] = this.minuteWindows[agentName].filter(t => t > oneMinAgo);
    this.hourWindows[agentName] = this.hourWindows[agentName].filter(t => t > oneHourAgo);
    
    const minuteCount = this.minuteWindows[agentName].length;
    const hourCount = this.hourWindows[agentName].length;
    
    // Check message length
    if (messageLength > this.maxMessageLength) {
      this.agentRecords[agentName].violations++;
      this.onViolation(agentName, `Message too long: ${messageLength}/${this.maxMessageLength} chars`);
      return { allowed: false, reason: `Message exceeds max length (${this.maxMessageLength} chars)` };
    }
    
    // Check per-minute rate
    if (minuteCount >= this.maxPerMinute) {
      this.agentRecords[agentName].violations++;
      this.onViolation(agentName, `Rate limit: ${minuteCount}/${this.maxPerMinute} per minute`);
      return { allowed: false, reason: `Rate limit exceeded (${this.maxPerMinute}/min)` };
    }
    
    // Check per-hour rate
    if (hourCount >= this.maxPerHour) {
      this.agentRecords[agentName].violations++;
      this.onViolation(agentName, `Hourly limit: ${hourCount}/${this.maxPerHour} per hour`);
      return { allowed: false, reason: `Hourly limit exceeded (${this.maxPerHour}/hr)` };
    }
    
    // Warning check
    let warning = null;
    if (minuteCount >= this.maxPerMinute * this.warningThreshold) {
      warning = `Approaching rate limit: ${minuteCount}/${this.maxPerMinute} per minute`;
      this.agentRecords[agentName].warnings++;
      this.onWarning(agentName, warning);
    }
    
    // Record this message
    this.minuteWindows[agentName].push(now);
    this.hourWindows[agentName].push(now);
    
    return { allowed: true, warning };
  }
  
  /**
   * Get rate stats for an agent
   */
  getStats(agentName) {
    const now = Date.now();
    const minuteCount = (this.minuteWindows[agentName] || []).filter(t => t > now - 60000).length;
    const hourCount = (this.hourWindows[agentName] || []).filter(t => t > now - 3600000).length;
    const record = this.agentRecords[agentName] || { warnings: 0, violations: 0 };
    
    return {
      messagesLastMinute: minuteCount,
      messagesLastHour: hourCount,
      minuteLimit: this.maxPerMinute,
      hourLimit: this.maxPerHour,
      warnings: record.warnings,
      violations: record.violations,
      minuteUtilization: (minuteCount / this.maxPerMinute * 100).toFixed(1) + '%',
    };
  }
  
  /**
   * Get all agent stats
   */
  getAllStats() {
    const agents = new Set([
      ...Object.keys(this.minuteWindows),
      ...Object.keys(this.hourWindows),
    ]);
    
    const stats = {};
    for (const agent of agents) {
      stats[agent] = this.getStats(agent);
    }
    return stats;
  }
}
