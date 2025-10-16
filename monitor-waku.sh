#!/bin/bash
# Script monitoring untuk WA-KU Gateway
# Jalankan dengan: ./monitor-waku.sh

# Konfigurasi
GATEWAY_URL="http://localhost:4005"
LOG_FILE="/var/log/waku-monitor.log"
ALERT_EMAIL="admin@example.com" # Ganti dengan email Anda

# Function untuk log dengan timestamp
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Function untuk check health
check_health() {
    local response=$(curl -s -w "%{http_code}" "$GATEWAY_URL/health" -o /tmp/waku-health.json)
    local http_code="${response: -3}"
    
    if [ "$http_code" = "200" ]; then
        local connected_sessions=$(jq -r '.sessions.connected' /tmp/waku-health.json 2>/dev/null || echo "0")
        local total_sessions=$(jq -r '.sessions.total' /tmp/waku-health.json 2>/dev/null || echo "0")
        local db_connected=$(jq -r '.database.connected' /tmp/waku-health.json 2>/dev/null || echo "false")
        
        log_message "✅ WA-KU Gateway is healthy - Sessions: $connected_sessions/$total_sessions, DB: $db_connected"
        
        # Check if all sessions are disconnected
        if [ "$connected_sessions" = "0" ] && [ "$total_sessions" -gt "0" ]; then
            log_message "⚠️ WARNING: All sessions are disconnected!"
            send_alert "WA-KU Alert: All sessions disconnected"
        fi
        
        # Check database connection
        if [ "$db_connected" = "false" ]; then
            log_message "⚠️ WARNING: Database connection lost!"
            send_alert "WA-KU Alert: Database connection lost"
        fi
        
        return 0
    else
        log_message "❌ WA-KU Gateway health check failed (HTTP $http_code)"
        send_alert "WA-KU Alert: Gateway health check failed (HTTP $http_code)"
        return 1
    fi
}

# Function untuk send alert (implementasi sederhana)
send_alert() {
    local message="$1"
    log_message "🚨 ALERT: $message"
    
    # Implementasi email alert (perlu setup mail server)
    # echo "$message" | mail -s "WA-KU Alert" "$ALERT_EMAIL" 2>/dev/null
    
    # Implementasi webhook alert (opsional)
    # curl -X POST -H "Content-Type: application/json" \
    #      -d "{\"text\":\"$message\"}" \
    #      "https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK" 2>/dev/null
}

# Function untuk restart service (opsional)
restart_service() {
    log_message "🔄 Attempting to restart WA-KU service..."
    
    # Implementasi restart service (sesuaikan dengan setup Anda)
    # systemctl restart waku-gateway
    # atau
    # pm2 restart waku-gateway
    # atau
    # pkill -f "node.*index.js" && cd /path/to/waku && nohup node dist/index.js > /var/log/waku.log 2>&1 &
    
    log_message "🔄 Service restart attempted"
}

# Main monitoring loop
main() {
    log_message "🚀 Starting WA-KU monitoring..."
    
    local consecutive_failures=0
    local max_failures=3
    
    while true; do
        if check_health; then
            consecutive_failures=0
        else
            consecutive_failures=$((consecutive_failures + 1))
            
            if [ "$consecutive_failures" -ge "$max_failures" ]; then
                log_message "💥 Multiple consecutive failures detected, attempting restart..."
                restart_service
                consecutive_failures=0
            fi
        fi
        
        # Wait 5 minutes before next check
        sleep 300
    done
}

# Handle script termination
cleanup() {
    log_message "🛑 Monitoring stopped"
    exit 0
}

trap cleanup SIGINT SIGTERM

# Check dependencies
if ! command -v curl &> /dev/null; then
    echo "❌ curl is required but not installed"
    exit 1
fi

if ! command -v jq &> /dev/null; then
    echo "❌ jq is required but not installed"
    exit 1
fi

# Create log directory if it doesn't exist
mkdir -p "$(dirname "$LOG_FILE")"

# Start monitoring
main
