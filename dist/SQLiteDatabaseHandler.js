// Database Configuration untuk SQLite (Built-in)
import Database from "better-sqlite3";

class SQLiteDatabaseHandler {
  constructor() {
    this.db = null;
    this.dbPath = "./database.sqlite";
  }

  async connect(maxRetries = 3, retryDelay = 2000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🔄 SQLite connection attempt ${attempt}/${maxRetries}`);

        this.db = new Database(this.dbPath);

        // Enable WAL mode for better performance
        this.db.pragma("journal_mode = WAL");
        this.db.pragma("synchronous = NORMAL");
        this.db.pragma("cache_size = 1000");
        this.db.pragma("temp_store = memory");

        // Test connection
        this.db.prepare("SELECT 1").get();

        console.log("✅ SQLite database connected successfully");
        return true;
      } catch (error) {
        console.error(
          `❌ SQLite connection attempt ${attempt} failed:`,
          error.message
        );

        // Jika ini bukan attempt terakhir, tunggu sebelum retry
        if (attempt < maxRetries) {
          console.log(`⏳ Waiting ${retryDelay}ms before retry...`);
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          retryDelay *= 2; // Exponential backoff
        }
      }
    }

    console.error("❌ All SQLite connection attempts failed");
    return false;
  }

  // Method untuk check connection health
  checkConnectionHealth() {
    try {
      if (!this.db) return false;
      this.db.prepare("SELECT 1").get();
      return true;
    } catch (error) {
      console.error("❌ SQLite health check failed:", error.message);
      return false;
    }
  }

  // Method untuk reconnect jika diperlukan
  async ensureConnection() {
    if (!this.checkConnectionHealth()) {
      console.log("🔄 SQLite connection lost, attempting to reconnect...");
      return await this.connect();
    }
    return true;
  }

  // Method untuk mendapatkan pesan error yang user-friendly
  getErrorMessage(error) {
    return (
      "❌ *Terjadi Kesalahan Database*\n\n" +
      "Mohon maaf, terjadi kesalahan saat mengakses database.\n" +
      "Silakan coba lagi atau hubungi administrator.\n\n" +
      "🔙 Ketik 'menu' untuk kembali ke menu utama"
    );
  }

  // Method untuk mendapatkan semua menu utama (parent_id = NULL)
  async getMainMenus() {
    try {
      // Pastikan koneksi database sehat
      await this.ensureConnection();

      if (!this.db) {
        throw new Error("Database not connected");
      }

      const stmt = this.db.prepare(`
        SELECT id, parent_id, keyword, description, url 
        FROM tb_botmenu 
        WHERE parent_id IS NULL 
        ORDER BY keyword ASC
      `);

      return stmt.all();
    } catch (error) {
      console.error("Error getting main menus:", error.message);
      return [];
    }
  }

  // Method untuk mendapatkan sub menu berdasarkan parent_id
  async getSubMenus(parentId) {
    try {
      const stmt = this.db.prepare(`
        SELECT id, parent_id, keyword, description, url 
        FROM tb_botmenu 
        WHERE parent_id = ? 
        ORDER BY keyword ASC
      `);

      return stmt.all(parentId);
    } catch (error) {
      console.error("Error getting sub menus:", error.message);
      return [];
    }
  }

  // Method untuk mendapatkan menu berdasarkan ID
  async getMenuById(id) {
    try {
      const stmt = this.db.prepare(`
        SELECT id, parent_id, keyword, description, url 
        FROM tb_botmenu 
        WHERE id = ?
      `);

      return stmt.get(id) || null;
    } catch (error) {
      console.error("Error getting menu by ID:", error.message);
      return null;
    }
  }

  // Method untuk mendapatkan menu berdasarkan keyword (semua menu)
  async getMenuByKeyword(keyword) {
    try {
      // Pastikan koneksi database sehat
      await this.ensureConnection();

      if (!this.db) {
        throw new Error("Database not connected");
      }

      const stmt = this.db.prepare(`
        SELECT id, parent_id, keyword, description, url 
        FROM tb_botmenu 
        WHERE keyword = ?
      `);

      const result = stmt.get(keyword);
      return result || null;
    } catch (error) {
      console.error("Error getting menu by keyword:", error.message);
      return null;
    }
  }

  // Method untuk mencari menu berdasarkan deskripsi
  async searchMenuByDescription(searchTerm) {
    try {
      if (!this.db) {
        throw new Error("Database not connected");
      }

      const stmt = this.db.prepare(`
        SELECT id, parent_id, keyword, description, url 
        FROM tb_botmenu 
        WHERE description LIKE ? AND parent_id IS NULL
        ORDER BY keyword ASC
      `);

      return stmt.all(`%${searchTerm}%`);
    } catch (error) {
      console.error("Error searching menu:", error.message);
      return [];
    }
  }

  // Method untuk memanggil API eksternal
  async callExternalAPI(url) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": "BotWA/1.0",
        },
        timeout: 10000,
      });

      if (!response.ok) {
        if (response.status === 404) {
          return (
            "🔍 *Data Tidak Ditemukan*\n\n" +
            "Data yang diminta tidak tersedia di server.\n" +
            "Silakan hubungi administrator untuk memperbarui data.\n\n" +
            "🔙 Ketik 'menu' untuk kembali ke menu utama"
          );
        } else if (response.status === 500) {
          return (
            "⚠️ *Server Sedang Bermasalah*\n\n" +
            "Server sedang mengalami gangguan internal.\n" +
            "Silakan coba lagi dalam beberapa saat.\n\n" +
            "🔙 Ketik 'menu' untuk kembali ke menu utama"
          );
        } else {
          return (
            `❌ *Error Server (${response.status})*\n\n` +
            "Terjadi kesalahan saat mengambil data dari server.\n" +
            "Silakan coba lagi nanti.\n\n" +
            "🔙 Ketik 'menu' untuk kembali ke menu utama"
          );
        }
      }

      const text = await response.text();

      // Check if response is HTML error page
      if (
        text.includes("<!DOCTYPE html>") ||
        text.includes("<html") ||
        text.includes("404 Not Found") ||
        text.includes("500 Internal Server Error")
      ) {
        return (
          "🌐 *Server Mengembalikan Halaman Error*\n\n" +
          "Server sedang mengalami masalah atau URL tidak valid.\n" +
          "Silakan hubungi administrator untuk memperbaiki masalah ini.\n\n" +
          "🔙 Ketik 'menu' untuk kembali ke menu utama"
        );
      }

      // Try to parse as JSON
      try {
        const jsonData = JSON.parse(text);
        return this.formatJSONResponse(jsonData);
      } catch {
        // If not JSON, return as text
        return text;
      }
    } catch (error) {
      console.error("Error calling external API:", error.message);

      if (error.name === "TypeError" && error.message.includes("fetch")) {
        return (
          "🌐 *Server Tidak Dapat Diakses*\n\n" +
          "Server eksternal tidak dapat dijangkau.\n" +
          "Kemungkinan server sedang down atau URL tidak valid.\n\n" +
          "🔙 Ketik 'menu' untuk kembali ke menu utama"
        );
      } else if (error.name === "AbortError") {
        return (
          "⏰ *Request Timeout*\n\n" +
          "Server tidak merespon dalam waktu yang ditentukan.\n" +
          "Silakan coba lagi nanti.\n\n" +
          "🔙 Ketik 'menu' untuk kembali ke menu utama"
        );
      } else {
        return (
          "❌ *Gagal Mengambil Data*\n\n" +
          "Terjadi kesalahan saat mengambil data dari server eksternal.\n" +
          "Silakan coba lagi atau hubungi administrator.\n\n" +
          "🔙 Ketik 'menu' untuk kembali ke menu utama"
        );
      }
    }
  }

  // Method untuk memformat response JSON
  formatJSONResponse(data) {
    if (Array.isArray(data)) {
      let response = "";
      data.forEach((item, index) => {
        if (typeof item === "object") {
          response += `📋 Item ${index + 1}:\n`;
          Object.entries(item).forEach(([key, value]) => {
            response += `• ${key}: ${value}\n`;
          });
        } else {
          response += `• ${item}\n`;
        }
      });
      return response;
    } else if (typeof data === "object") {
      let response = "";
      Object.entries(data).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          response += `📋 ${key}:\n`;
          value.forEach((item) => {
            response += `• ${item}\n`;
          });
        } else {
          response += `📋 ${key}: ${value}\n`;
        }
      });
      return response;
    }
    return String(data);
  }

  // Method untuk mendapatkan response menu utama
  async getMainMenuResponse() {
    try {
      const mainMenus = await this.getMainMenus();

      let response = "🤖 *Selamat Datang di Bot System*\n\n";
      response += "Silakan pilih menu di bawah ini:\n\n";

      if (mainMenus.length === 0) {
        response += "❌ Tidak ada menu yang tersedia.\n";
        response += "Silakan hubungi administrator untuk menambahkan menu.";
      } else {
        mainMenus.forEach((menu) => {
          response += `🔹 ${menu.keyword}. ${menu.description}\n`;
        });
      }

      response += "\n📝 *Cara penggunaan:*\n";
      response += "• Ketik angka menu (contoh: 1)\n";
      response += "• Atau ketik kata kunci (contoh: jadwal)\n";
      response += "• Ketik 'menu' untuk kembali ke menu utama";

      return response;
    } catch (error) {
      console.error("Error in getMainMenuResponse:", error.message);
      return this.getErrorMessage(error);
    }
  }

  // Method untuk memformat hasil pencarian
  async formatSearchResults(results) {
    if (results.length === 0) {
      return "❌ Tidak ditemukan menu yang sesuai dengan kata kunci tersebut.\n\n🔙 Ketik 'menu' untuk kembali ke menu utama";
    }

    let response = "🔍 *Hasil Pencarian:*\n\n";

    results.forEach((result) => {
      response += `🔹 ${result.keyword}. ${result.description}\n`;
    });

    response += "\n📝 *Cara penggunaan:*\n";
    response += "• Ketik angka menu untuk memilih\n";
    response += "• Atau ketik kata kunci lain untuk mencari\n\n";
    response += "🔙 Ketik 'menu' untuk kembali ke menu utama";

    return response;
  }

  // Method untuk memproses pesan dan menentukan response
  async processMessage(message) {
    try {
      const lowerMessage = message.toLowerCase().trim();

      // Cek apakah pesan adalah angka (untuk menu)
      if (/^\d+$/.test(lowerMessage)) {
        const menu = await this.getMenuByKeyword(lowerMessage);
        if (menu) {
          return await this.formatMenuResponse(menu);
        } else {
          return (
            "❌ *Menu Tidak Ditemukan*\n\n" +
            `Menu dengan nomor "${lowerMessage}" tidak tersedia.\n` +
            "Silakan pilih menu yang tersedia.\n\n" +
            "🔙 Ketik 'menu' untuk melihat daftar menu"
          );
        }
      }

      // Cek apakah pesan adalah kata kunci menu
      const searchResults = await this.searchMenuByDescription(lowerMessage);
      if (searchResults.length > 0) {
        return await this.formatSearchResults(searchResults);
      }

      // Jika tidak ditemukan, tampilkan menu utama
      return await this.getMainMenuResponse();
    } catch (error) {
      console.error("Error in processMessage:", error.message);
      return this.getErrorMessage(error);
    }
  }

  // Method untuk memformat response menu
  async formatMenuResponse(menu) {
    try {
      let response = `📋 *${menu.description}*\n\n`;

      // Jika menu memiliki parent_id, ini adalah sub menu
      if (menu.parent_id) {
        // Untuk sub menu, langsung tampilkan data dari URL atau pesan
        if (
          menu.url &&
          menu.url !== "NULL" &&
          menu.url !== "Masih dalam pengembangan"
        ) {
          // Jika sub menu memiliki URL, panggil API eksternal
          const apiResponse = await this.callExternalAPI(menu.url);
          if (
            apiResponse &&
            !apiResponse.includes("❌") &&
            !apiResponse.includes("🔍") &&
            !apiResponse.includes("⚠️")
          ) {
            response += apiResponse;
          } else {
            response += apiResponse || "❌ Gagal mengambil data dari server.";
          }
        } else {
          response +=
            "ℹ️ *Sub Menu Dalam Pengembangan*\n\n" +
            "Sub menu ini sedang dalam tahap pengembangan.\n" +
            "Silakan coba lagi nanti atau pilih sub menu lain.\n\n" +
            "🔙 Ketik 'menu' untuk kembali ke menu utama";
        }
      } else {
        // Ini adalah menu utama
        if (
          menu.url &&
          menu.url !== "NULL" &&
          menu.url !== "Masih dalam pengembangan"
        ) {
          // Jika menu utama memiliki URL, panggil API eksternal
          const apiResponse = await this.callExternalAPI(menu.url);
          if (
            apiResponse &&
            !apiResponse.includes("❌") &&
            !apiResponse.includes("🔍") &&
            !apiResponse.includes("⚠️")
          ) {
            response += apiResponse;
          } else {
            response += apiResponse || "❌ Gagal mengambil data dari server.";
          }
        } else {
          // Jika menu utama tidak memiliki URL, tampilkan sub menu
          const subMenus = await this.getSubMenus(menu.id);
          if (subMenus.length > 0) {
            response += "Pilih sub menu di bawah ini:\n\n";
            subMenus.forEach((subMenu) => {
              response += `🔹 ${subMenu.keyword}. ${subMenu.description}\n`;
            });
            response += "\n📝 *Cara penggunaan:*\n";
            response += "• Ketik nomor sub menu (contoh: 41, 42)\n";
            response += "• Atau ketik 'menu' untuk kembali ke menu utama";
          } else {
            response +=
              "ℹ️ *Menu Dalam Pengembangan*\n\n" +
              "Menu ini sedang dalam tahap pengembangan.\n" +
              "Silakan coba lagi nanti atau pilih menu lain.\n\n" +
              "🔙 Ketik 'menu' untuk melihat menu lain";
          }
        }
      }

      response += "\n\n🔙 Ketik 'menu' untuk kembali ke menu utama";
      return response;
    } catch (error) {
      console.error("Error in formatMenuResponse:", error.message);
      return this.getErrorMessage(error);
    }
  }

  // Method untuk setup database dan tabel
  async setupDatabase() {
    try {
      if (!this.db) {
        await this.connect();
      }

      // Create tables
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS tb_menu (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          remark TEXT,
          time_stamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TABLE IF NOT EXISTS tb_botmenu (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          menu_id INTEGER,
          parent_id INTEGER,
          keyword TEXT NOT NULL,
          description TEXT NOT NULL,
          url TEXT,
          FOREIGN KEY (menu_id) REFERENCES tb_menu(id),
          FOREIGN KEY (parent_id) REFERENCES tb_botmenu(id)
        );
        
        CREATE TABLE IF NOT EXISTS tb_users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          email TEXT,
          full_name TEXT,
          role TEXT DEFAULT 'user',
          is_active INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_login DATETIME
        );
      `);

      // Insert sample data jika belum ada
      const checkMenu = this.db
        .prepare("SELECT COUNT(*) as count FROM tb_menu")
        .get();
      if (checkMenu.count === 0) {
        this.db.exec(`
          INSERT INTO tb_menu (id, name, remark) VALUES 
          (1, 'Menu Utama', 'Menu utama bot'),
          (2, 'Informasi', 'Menu informasi'),
          (3, 'Layanan', 'Menu layanan');
          
          INSERT INTO tb_botmenu (id, menu_id, parent_id, keyword, description, url) VALUES 
          (1, 1, NULL, '1', 'Menu Utama', NULL),
          (2, 1, NULL, '2', 'Informasi', NULL),
          (3, 1, NULL, '3', 'Layanan', NULL),
          (4, 2, NULL, '21', 'Tentang Kami', NULL),
          (5, 2, NULL, '22', 'Kontak', NULL),
          (6, 3, NULL, '31', 'Jadwal', NULL),
          (7, 3, NULL, '32', 'Booking', NULL);
        `);

        console.log("✅ Sample data inserted into SQLite database");
      }

      // Insert default admin user jika belum ada
      const checkUsers = this.db
        .prepare("SELECT COUNT(*) as count FROM tb_users")
        .get();
      if (checkUsers.count === 0) {
        const bcrypt = await import("bcrypt");
        const hashedPassword = await bcrypt.hash("admin321", 10);

        this.db.exec(`
          INSERT INTO tb_users (username, password, email, full_name, role, is_active) VALUES 
          ('admin', '${hashedPassword}', 'admin@waku.local', 'Administrator', 'admin', 1),
          ('user', '${hashedPassword}', 'user@waku.local', 'Regular User', 'user', 1);
        `);

        console.log("✅ Default users created (admin/admin321, user/admin321)");
      }

      console.log("✅ SQLite database setup completed");
      return true;
    } catch (error) {
      console.error("❌ SQLite setup failed:", error);
      return false;
    }
  }

  // Method untuk close connection
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      console.log("✅ SQLite connection closed");
    }
  }
}

export default SQLiteDatabaseHandler;
