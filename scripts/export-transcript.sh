#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Export Experiment Transcript
# =============================================================================
# Exports the message log to readable formats.
#
# Usage:
#   bash scripts/export-transcript.sh                    # Print to stdout
#   bash scripts/export-transcript.sh --format markdown  # Markdown format
#   bash scripts/export-transcript.sh --format html      # HTML page
#   bash scripts/export-transcript.sh --output file.md   # Write to file

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

FORMAT="text"
OUTPUT=""
LOG_FILE="data/logs/messages.jsonl"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --format) FORMAT="$2"; shift 2 ;;
    --output) OUTPUT="$2"; shift 2 ;;
    --log)    LOG_FILE="$2"; shift 2 ;;
    *) shift ;;
  esac
done

if [ ! -f "$LOG_FILE" ]; then
  echo "No message log found at $LOG_FILE"
  exit 1
fi

export_text() {
  echo "=== Agent Experiment Transcript ==="
  echo "Generated: $(date)"
  echo "Messages: $(wc -l < "$LOG_FILE")"
  echo "==================================="
  echo ""
  
  while IFS= read -r line; do
    TS=$(echo "$line" | jq -r '.timestamp' | cut -d'T' -f2 | cut -d'.' -f1)
    AGENT=$(echo "$line" | jq -r '.agent // "unknown"')
    CHANNEL=$(echo "$line" | jq -r '.channel // ""')
    LENGTH=$(echo "$line" | jq -r '.messageLength // 0')
    TYPE=$(echo "$line" | jq -r '.type // "message"')
    
    if [ -n "$CHANNEL" ]; then
      echo "[$TS] #$CHANNEL | $AGENT ($LENGTH chars) [$TYPE]"
    else
      echo "[$TS] $AGENT ($LENGTH chars) [$TYPE]"
    fi
  done < "$LOG_FILE"
}

export_markdown() {
  echo "# Agent Experiment Transcript"
  echo ""
  echo "**Generated:** $(date)"
  echo "**Messages:** $(wc -l < "$LOG_FILE")"
  echo ""
  echo "---"
  echo ""
  
  CURRENT_CHANNEL=""
  while IFS= read -r line; do
    TS=$(echo "$line" | jq -r '.timestamp' | cut -d'T' -f2 | cut -d'.' -f1)
    AGENT=$(echo "$line" | jq -r '.agent // "unknown"')
    CHANNEL=$(echo "$line" | jq -r '.channel // "general"')
    LENGTH=$(echo "$line" | jq -r '.messageLength // 0')
    
    if [ "$CHANNEL" != "$CURRENT_CHANNEL" ]; then
      echo ""
      echo "## #$CHANNEL"
      echo ""
      CURRENT_CHANNEL="$CHANNEL"
    fi
    
    echo "**$AGENT** [$TS] — *${LENGTH} chars*"
    echo ""
  done < "$LOG_FILE"
}

export_html() {
  cat << 'HEADER'
<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Agent Experiment Transcript</title>
<style>
body{font-family:system-ui;max-width:800px;margin:40px auto;padding:0 20px;background:#1a1a2e;color:#e0e0e0}
h1{color:#4ecca3}
.msg{padding:8px 12px;margin:4px 0;border-radius:6px;background:#16213e}
.msg .author{font-weight:bold;color:#4ecca3}
.msg .time{color:#666;font-size:12px;float:right}
.msg .channel{color:#e94560;font-size:12px}
.channel-header{color:#e94560;margin:20px 0 8px;border-bottom:1px solid #333;padding-bottom:4px}
</style>
</head><body>
HEADER
  
  echo "<h1>Agent Experiment Transcript</h1>"
  echo "<p>Generated: $(date) · Messages: $(wc -l < "$LOG_FILE")</p>"
  
  CURRENT_CHANNEL=""
  while IFS= read -r line; do
    TS=$(echo "$line" | jq -r '.timestamp' | cut -d'T' -f2 | cut -d'.' -f1)
    AGENT=$(echo "$line" | jq -r '.agent // "unknown"')
    CHANNEL=$(echo "$line" | jq -r '.channel // "general"')
    LENGTH=$(echo "$line" | jq -r '.messageLength // 0')
    
    if [ "$CHANNEL" != "$CURRENT_CHANNEL" ]; then
      echo "<h3 class=\"channel-header\">#$CHANNEL</h3>"
      CURRENT_CHANNEL="$CHANNEL"
    fi
    
    echo "<div class=\"msg\"><span class=\"time\">$TS</span><span class=\"author\">$AGENT</span> <span class=\"channel\">#$CHANNEL</span> — ${LENGTH} chars</div>"
  done < "$LOG_FILE"
  
  echo "</body></html>"
}

# Run export
case "$FORMAT" in
  text)     result=$(export_text) ;;
  markdown) result=$(export_markdown) ;;
  md)       result=$(export_markdown) ;;
  html)     result=$(export_html) ;;
  *)        echo "Unknown format: $FORMAT (use: text, markdown, html)"; exit 1 ;;
esac

if [ -n "$OUTPUT" ]; then
  echo "$result" > "$OUTPUT"
  echo "Transcript exported to $OUTPUT"
else
  echo "$result"
fi
