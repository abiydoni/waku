# WA-KU Gateway - SQLite Database Setup

## ✅ **Migrasi ke SQLite Berhasil!**

WA-KU Gateway sekarang menggunakan **SQLite** sebagai database, yang lebih mudah dan tidak memerlukan setup MySQL server.

## 🎯 **Keuntungan SQLite:**

1. **✅ Tidak perlu MySQL server** - Database file-based
2. **✅ Lebih ringan** - Tidak ada overhead server
3. **✅ Portable** - Database file bisa dipindah-pindah
4. **✅ Backup mudah** - Cukup copy file database.sqlite
5. **✅ Performance baik** - Untuk aplikasi single-user

## 📁 **File Database:**

- **Database file**: `./database.sqlite`
- **Size**: ~4KB (dengan sample data)
- **Location**: Di folder root WA-KU Gateway

## 🗃️ **Struktur Database:**

### **Tabel `tb_menu`:**

```sql
CREATE TABLE tb_menu (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  remark TEXT,
  time_stamp DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### **Tabel `tb_botmenu`:**

```sql
CREATE TABLE tb_botmenu (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_id INTEGER,
  parent_id INTEGER,
  keyword TEXT NOT NULL,
  description TEXT NOT NULL,
  url TEXT,
  FOREIGN KEY (menu_id) REFERENCES tb_menu(id),
  FOREIGN KEY (parent_id) REFERENCES tb_botmenu(id)
);
```

## 📊 **Data Sample yang Sudah Ada:**

### **Menu Utama:**

- **1** - Menu Utama
- **2** - Informasi
- **3** - Layanan

### **Sub Menu:**

- **21** - Tentang Kami
- **22** - Kontak
- **31** - Jadwal
- **32** - Booking

## 🔧 **Cara Menggunakan:**

### **1. Test Database:**

```bash
# Check health
curl http://localhost:4005/health

# Get menus
curl http://localhost:4005/api/menus

# Get bot menus
curl http://localhost:4005/api/botmenus
```

### **2. Test Bot:**

```bash
# Send test message
curl -X POST http://localhost:4005/api/sendMessage \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "session1", "to": "6281234567890", "message": "menu", "isGroup": false}'
```

### **3. Access Dashboard:**

```
http://localhost:4005/dashboard
```

## 📝 **Menambah Data Baru:**

### **Via API:**

```bash
# Add new menu
curl -X POST http://localhost:4005/api/menus \
  -H "Content-Type: application/json" \
  -d '{"name": "Layanan Baru", "remark": "Menu layanan tambahan"}'

# Add new bot menu
curl -X POST http://localhost:4005/api/botmenus \
  -H "Content-Type: application/json" \
  -d '{"menu_id": 1, "keyword": "4", "description": "Layanan Baru", "url": "https://example.com"}'
```

### **Via SQLite Command Line:**

```bash
# Install sqlite3 command line tool
# Windows: Download from https://sqlite.org/download.html
# Linux: sudo apt install sqlite3
# Mac: brew install sqlite3

# Open database
sqlite3 database.sqlite

# Add data
INSERT INTO tb_menu (name, remark) VALUES ('Menu Baru', 'Deskripsi menu');
INSERT INTO tb_botmenu (menu_id, keyword, description, url) VALUES (1, '5', 'Menu Baru', 'https://example.com');

# Exit
.quit
```

## 🔄 **Migrasi dari MySQL (Opsional):**

Jika Anda punya data di MySQL yang ingin dipindah ke SQLite:

```bash
# Jalankan script migrasi
node migrate-to-sqlite.js
```

**Script akan:**

1. Connect ke MySQL database
2. Export semua data dari `tb_menu` dan `tb_botmenu`
3. Import ke SQLite database
4. Verify data integrity

## 🛠️ **Troubleshooting:**

### **Database tidak bisa dibuka:**

```bash
# Check file permissions
ls -la database.sqlite

# Check file integrity
sqlite3 database.sqlite "PRAGMA integrity_check;"
```

### **Data tidak muncul:**

```bash
# Check tables
sqlite3 database.sqlite ".tables"

# Check data
sqlite3 database.sqlite "SELECT * FROM tb_menu;"
sqlite3 database.sqlite "SELECT * FROM tb_botmenu;"
```

### **Bot tidak merespon:**

```bash
# Check database connection in logs
tail -f /var/log/waku.log | grep -i sqlite

# Test database handler
curl http://localhost:4005/api/menus
```

## 📈 **Performance Tips:**

1. **WAL Mode**: Sudah diaktifkan untuk better concurrency
2. **Cache Size**: Set ke 1000 pages untuk better performance
3. **Synchronous**: Set ke NORMAL untuk balance speed/safety
4. **Backup**: Regular backup file database.sqlite

## 🔒 **Security:**

1. **File Permissions**: Set proper permissions untuk database.sqlite
2. **Backup**: Regular backup ke lokasi aman
3. **Access Control**: Limit access ke file database

## 📋 **Monitoring:**

### **Database Size:**

```bash
ls -lh database.sqlite
```

### **Table Stats:**

```bash
sqlite3 database.sqlite "SELECT COUNT(*) as menu_count FROM tb_menu;"
sqlite3 database.sqlite "SELECT COUNT(*) as botmenu_count FROM tb_botmenu;"
```

### **Health Check:**

```bash
curl http://localhost:4005/health | jq '.database'
```

## 🎉 **Status Saat Ini:**

- ✅ **SQLite Database**: Berjalan dengan baik
- ✅ **Sample Data**: Sudah terisi
- ✅ **Bot Functionality**: Sudah bisa merespon
- ✅ **API Endpoints**: Semua berfungsi
- ✅ **Session Management**: Tetap stabil
- ✅ **Auto-reconnect**: Tetap aktif

**WA-KU Gateway dengan SQLite sudah siap digunakan!** 🚀
