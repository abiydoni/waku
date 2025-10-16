# WA-KU Gateway - Panduan Troubleshooting Session Disconnect

## Masalah yang Diperbaiki

### 1. Session WhatsApp Terputus Sendiri
**Masalah**: Session WhatsApp terputus setelah beberapa jam meskipun tidak ada aktivitas manual disconnect.

**Solusi yang Diimplementasikan**:
- ✅ Enhanced heartbeat mechanism setiap 20 detik dengan multiple strategies
- ✅ Smart auto-recovery dengan exponential backoff
- ✅ Connection persistence dengan keep-alive settings
- ✅ Enhanced session monitoring setiap 60 detik

### 2. Database Connection Tidak Stabil
**Masalah**: Bot tidak bisa mengambil data dari database setelah reconnect.

**Solusi yang Diimplementasikan**:
- ✅ Database connection retry mechanism (3 attempts dengan exponential backoff)
- ✅ Connection health check sebelum setiap query
- ✅ Auto-reconnect database jika connection lost
- ✅ Enhanced error handling dengan user-friendly messages

### 3. Session Persistence Tidak Optimal
**Masalah**: Session tidak tersimpan dengan baik untuk recovery otomatis.

**Solusi yang Diimplementasikan**:
- ✅ Enhanced Baileys configuration dengan persistence settings
- ✅ Better session state management
- ✅ Improved auth state handling

## Cara Menggunakan

### 1. Restart Service
```bash
# Jika menggunakan systemd
sudo systemctl restart waku-gateway

# Jika menggunakan PM2
pm2 restart waku-gateway

# Jika manual
pkill -f "node.*index.js"
cd /path/to/waku
nohup node dist/index.js > /var/log/waku.log 2>&1 &
```

### 2. Monitor Health Status
```bash
# Check health endpoint
curl http://localhost:4005/health

# Response akan menampilkan:
# - Total sessions
# - Connected sessions
# - Database connection status
# - Detailed session information
```

### 3. Setup Monitoring Script (Linux/Mac)
```bash
# Buat script executable
chmod +x monitor-waku.sh

# Jalankan monitoring
./monitor-waku.sh

# Atau jalankan di background
nohup ./monitor-waku.sh > /var/log/waku-monitor.log 2>&1 &
```

### 4. Setup Monitoring Script (Windows)
```powershell
# Buat PowerShell script untuk Windows
# monitor-waku.ps1
$gatewayUrl = "http://localhost:4005"
while ($true) {
    try {
        $response = Invoke-RestMethod -Uri "$gatewayUrl/health" -Method Get
        Write-Host "[$(Get-Date)] ✅ WA-KU Gateway is healthy - Sessions: $($response.sessions.connected)/$($response.sessions.total)"
        
        if ($response.sessions.connected -eq 0 -and $response.sessions.total -gt 0) {
            Write-Host "[$(Get-Date)] ⚠️ WARNING: All sessions are disconnected!"
        }
        
        if (-not $response.database.connected) {
            Write-Host "[$(Get-Date)] ⚠️ WARNING: Database connection lost!"
        }
    }
    catch {
        Write-Host "[$(Get-Date)] ❌ WA-KU Gateway health check failed: $($_.Exception.Message)"
    }
    
    Start-Sleep -Seconds 300  # Wait 5 minutes
}
```

## Troubleshooting

### Session Tidak Connect
1. **Check logs**: `tail -f /var/log/waku.log`
2. **Check health**: `curl http://localhost:4005/health`
3. **Restart service**: `sudo systemctl restart waku-gateway`

### Database Error
1. **Check MySQL service**: `sudo systemctl status mysql`
2. **Check database config**: Edit `dist/databaseConfig.js`
3. **Test connection**: `mysql -u appsbeem_admin -p appsbeem_botwa`

### Session Terputus Terus
1. **Check network stability**
2. **Check server resources** (CPU, Memory)
3. **Check WhatsApp rate limits**
4. **Review logs untuk error patterns**

## Konfigurasi Optimal

### Environment Variables
```bash
# Database
export DB_HOST=localhost
export DB_USER=appsbeem_admin
export DB_PASS=A7by777__
export DB_NAME=appsbeem_botwa

# Server
export PORT=4005
export HOST=0.0.0.0
export NODE_ENV=production
```

### MySQL Configuration
```sql
-- Optimize MySQL untuk connection persistence
SET GLOBAL wait_timeout = 28800;
SET GLOBAL interactive_timeout = 28800;
SET GLOBAL max_connections = 200;
```

### Systemd Service (Linux)
```ini
[Unit]
Description=WA-KU Gateway
After=network.target mysql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/path/to/waku
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

## Monitoring dan Alerting

### Health Check Endpoint
- **URL**: `http://localhost:4005/health`
- **Method**: GET
- **Response**: JSON dengan status detail

### Log Monitoring
```bash
# Monitor logs real-time
tail -f /var/log/waku.log | grep -E "(connected|disconnected|error|heartbeat)"

# Check error patterns
grep -i error /var/log/waku.log | tail -20

# Monitor session status
grep -E "Session.*connected|Session.*disconnected" /var/log/waku.log | tail -10
```

### Performance Monitoring
```bash
# Check memory usage
ps aux | grep node

# Check network connections
netstat -an | grep :4005

# Check database connections
mysql -u root -p -e "SHOW PROCESSLIST;"
```

## Best Practices

1. **Regular Monitoring**: Setup monitoring script dan check logs secara berkala
2. **Resource Management**: Monitor CPU dan memory usage
3. **Database Maintenance**: Regular backup dan optimize database
4. **Network Stability**: Pastikan koneksi internet stabil
5. **Log Rotation**: Setup log rotation untuk mencegah disk penuh
6. **Security**: Update dependencies secara berkala
7. **Backup**: Backup session data dan database secara regular

## Support

Jika masih mengalami masalah:
1. Check logs untuk error messages
2. Verify semua dependencies terinstall
3. Test database connection manual
4. Check network connectivity
5. Review server resources

Untuk bantuan lebih lanjut, hubungi administrator sistem.
