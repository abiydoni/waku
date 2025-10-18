import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import axios from "axios";

class SQLiteDatabaseHandler {
  constructor() {
    this.dbPath = "./data/database.sqlite";
    this.db = null;
    this.isConnected = false;
  }

  // Method untuk koneksi ke database SQLite
  async connect() {
    try {
      console.log("🔄 Connecting to SQLite database...");

      // Pastikan direktori ada
      const dbDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      // Koneksi ke database SQLite menggunakan better-sqlite3
      this.db = new Database(this.dbPath);
      this.isConnected = true;

      console.log("✅ SQLite database connected successfully");

      // Setup database tables
      await this.setupDatabase();

      return true;
    } catch (error) {
      console.error("❌ Failed to connect to SQLite database:", error.message);
      this.isConnected = false;
      return false;
    }
  }

  // Method untuk setup database tables dan data
  async setupDatabase() {
    try {
      console.log("🔄 Setting up SQLite database tables...");

      // Create tb_menu table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS tb_menu (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          remark TEXT,
          time_stamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create tb_botmenu table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS tb_botmenu (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          menu_id INTEGER,
          parent_id INTEGER,
          keyword TEXT NOT NULL,
          description TEXT NOT NULL,
          url TEXT,
          FOREIGN KEY (menu_id) REFERENCES tb_menu(id),
          FOREIGN KEY (parent_id) REFERENCES tb_botmenu(id)
        )
      `);

      // Create tb_users table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS tb_users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          full_name TEXT NOT NULL,
          role TEXT DEFAULT 'user',
          is_active INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_login DATETIME
        )
      `);

      // Check if data already exists
      const menuCount = this.db
        .prepare("SELECT COUNT(*) as count FROM tb_menu")
        .get();
      const botMenuCount = this.db
        .prepare("SELECT COUNT(*) as count FROM tb_botmenu")
        .get();
      const userCount = this.db
        .prepare("SELECT COUNT(*) as count FROM tb_users")
        .get();

      console.log(
        `📊 Current data: ${menuCount.count} menus, ${botMenuCount.count} bot menus, ${userCount.count} users`
      );

      // Insert sample data if tables are empty
      if (menuCount.count === 0) {
        console.log("📝 Inserting sample menu data...");
        await this.insertSampleData();
      }

      console.log("✅ SQLite database setup completed");
    } catch (error) {
      console.error("❌ Failed to setup SQLite database:", error.message);
      throw error;
    }
  }

  // Method untuk insert sample data dari database.json
  async insertSampleData() {
    try {
      console.log("📝 Inserting data from database.json...");

      // Insert menu data (persis seperti database.json)
      const insertMenu = this.db.prepare(`
        INSERT INTO tb_menu (id, name, remark, time_stamp) VALUES (?, ?, ?, ?)
      `);

      insertMenu.run(
        1,
        "Jimpitan",
        "Bot menu untuk aplikasi jimpitan RT.07",
        "2025-10-12T16:12:23.000Z"
      );
      insertMenu.run(
        2,
        "Gemma",
        "Bot menu untuk aplikasi Bibel Gemma",
        "2025-10-12T16:12:23.000Z"
      );

      // Insert bot menu data (persis seperti database.json)
      const insertBotMenu = this.db.prepare(`
        INSERT INTO tb_botmenu (id, menu_id, parent_id, keyword, description, url) VALUES (?, ?, ?, ?, ?, ?)
      `);

      // Menu utama
      insertBotMenu.run(
        1,
        1,
        null,
        "1",
        "Data Kepala Keluarga",
        "https://rt07.appsbee.my.id/api/ambil_kk.php"
      );
      insertBotMenu.run(
        2,
        1,
        null,
        "2",
        "Jadwal jaga hari ini",
        "https://rt07.appsbee.my.id/api/ambil_jaga.php"
      );
      insertBotMenu.run(3, 1, null, "3", "Semua Jadwal Jaga", null);
      insertBotMenu.run(4, 1, null, "4", "Laporan", null);
      insertBotMenu.run(
        18,
        1,
        null,
        "5",
        "Informasi lain",
        "Masih dalam pengembangan"
      );

      // Sub menu hari
      insertBotMenu.run(
        5,
        1,
        3,
        "31",
        "Senin",
        "https://rt07.appsbee.my.id/api/ambil_jaga_semua.php?hari=Monday"
      );
      insertBotMenu.run(
        6,
        1,
        3,
        "32",
        "Selasa",
        "https://rt07.appsbee.my.id/api/ambil_jaga_semua.php?hari=Tuesday"
      );
      insertBotMenu.run(
        7,
        1,
        3,
        "33",
        "Rabu",
        "https://rt07.appsbee.my.id/api/ambil_jaga_semua.php?hari=Wednesday"
      );
      insertBotMenu.run(
        8,
        1,
        3,
        "34",
        "Kamis",
        "https://rt07.appsbee.my.id/api/ambil_jaga_semua.php?hari=Thursday"
      );
      insertBotMenu.run(
        9,
        1,
        3,
        "35",
        "Jumat",
        "https://rt07.appsbee.my.id/api/ambil_jaga_semua.php?hari=Friday"
      );
      insertBotMenu.run(
        10,
        1,
        3,
        "36",
        "Sabtu",
        "https://rt07.appsbee.my.id/api/ambil_jaga_semua.php?hari=Saturday"
      );
      insertBotMenu.run(
        11,
        1,
        3,
        "37",
        "Minggu",
        "https://rt07.appsbee.my.id/api/ambil_jaga_semua.php?hari=Sunday"
      );

      // Sub menu laporan
      insertBotMenu.run(
        13,
        1,
        4,
        "41",
        "Laporan jimpitan semalam",
        "https://rt07.appsbee.my.id/api/ambil_jimpitan.php"
      );
      insertBotMenu.run(
        14,
        1,
        4,
        "42",
        "Laporan lain",
        "Masih dalam pengembangan"
      );

      // Menu Gemma
      insertBotMenu.run(
        22,
        2,
        null,
        "1",
        "Test Menu Gemma",
        "Masih dalam pengembangan"
      );

      // Insert user data (persis seperti database.json)
      const insertUser = this.db.prepare(`
        INSERT INTO tb_users (id, username, password, email, full_name, role, is_active, created_at, updated_at, last_login) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insertUser.run(
        1,
        "admin",
        "$2b$10$Kk8Fh9A./iGtxolsboJcN.VDgILeOvCu2WkjTdUWHigG4XXls4uC2",
        "admin@waku.local",
        "Administrator",
        "admin",
        1,
        "2025-10-16T10:03:45.024Z",
        "2025-10-16T10:03:45.024Z",
        "2025-10-18T13:39:47.441Z"
      );
      insertUser.run(
        2,
        "user",
        "$2b$10$Kk8Fh9A./iGtxolsboJcN.VDgILeOvCu2WkjTdUWHigG4XXls4uC2",
        "user@waku.local",
        "Regular User",
        "user",
        1,
        "2025-10-16T10:03:45.024Z",
        "2025-10-16T10:03:45.024Z",
        null
      );

      console.log("✅ Data from database.json inserted successfully");
      console.log("📊 Inserted: 2 menus, 15 bot menus, 2 users");
    } catch (error) {
      console.error(
        "❌ Failed to insert data from database.json:",
        error.message
      );
      throw error;
    }
  }

  // Method untuk mendapatkan semua menu utama (parent_id = NULL)
  async getMainMenus() {
    try {
      console.log("📋 Getting main menus...");

      // Pastikan koneksi database sehat dan data fresh
      await this.ensureConnection();

      const mainMenus = this.db
        .prepare(
          `
        SELECT * FROM tb_botmenu 
        WHERE parent_id IS NULL 
        ORDER BY keyword
      `
        )
        .all();

      console.log("📋 Filtered main menus:", mainMenus);
      return mainMenus;
    } catch (error) {
      console.error("❌ Error getting main menus:", error.message);
      console.error("❌ Error stack:", error.stack);
      return [];
    }
  }

  // Method untuk mendapatkan sub menu berdasarkan parent_id
  async getSubMenus(parentId) {
    try {
      // Pastikan data fresh
      await this.ensureConnection();

      return this.db
        .prepare(
          `
        SELECT * FROM tb_botmenu 
        WHERE parent_id = ? 
        ORDER BY keyword
      `
        )
        .all(parentId);
    } catch (error) {
      console.error("Error getting sub menus:", error.message);
      return [];
    }
  }

  // Method untuk mencari menu berdasarkan keyword
  async findMenuByKeyword(keyword) {
    try {
      await this.ensureConnection();

      return this.db
        .prepare(
          `
        SELECT * FROM tb_botmenu 
        WHERE keyword = ?
      `
        )
        .get(keyword);
    } catch (error) {
      console.error("Error finding menu by keyword:", error.message);
      return null;
    }
  }

  // Method untuk mencari menu berdasarkan description
  async searchMenuByDescription(searchTerm) {
    try {
      await this.ensureConnection();

      return this.db
        .prepare(
          `
        SELECT * FROM tb_botmenu 
        WHERE description LIKE ? 
        ORDER BY keyword
      `
        )
        .all(`%${searchTerm}%`);
    } catch (error) {
      console.error("Error searching menu by description:", error.message);
      return [];
    }
  }

  // Method untuk mengambil data dari URL
  async fetchDataFromUrl(url) {
    try {
      console.log(`🌐 Fetching data from URL: ${url}`);

      const response = await axios.get(url, {
        headers: {
          "User-Agent": "WhatsApp Bot",
          Accept: "application/json, text/plain, */*",
        },
        timeout: 10000, // 10 seconds timeout
      });

      const data = response.data;
      console.log(`✅ Data fetched successfully from ${url}`);

      // Format data untuk WhatsApp
      return this.formatApiResponse(data);
    } catch (error) {
      console.error(`❌ Error fetching data from ${url}:`, error.message);
      throw error;
    }
  }

  // Method untuk memformat response dari API
  formatApiResponse(data) {
    try {
      // Data sudah berupa object dari axios
      if (Array.isArray(data)) {
        // Jika array, format sebagai list
        let formatted = "";
        data.forEach((item, index) => {
          if (typeof item === "object") {
            formatted += `${index + 1}. `;
            Object.entries(item).forEach(([key, value]) => {
              formatted += `${key}: ${value}\n`;
            });
            formatted += "\n";
          } else {
            formatted += `${index + 1}. ${item}\n`;
          }
        });
        return formatted.trim();
      } else if (typeof data === "object") {
        // Jika object, format sebagai key-value
        let formatted = "";
        Object.entries(data).forEach(([key, value]) => {
          formatted += `• ${key}: ${value}\n`;
        });
        return formatted.trim();
      } else {
        return String(data);
      }
    } catch (error) {
      // Jika ada error, return sebagai text biasa
      return String(data);
    }
  }

  // Method untuk mendapatkan response menu utama
  async getMainMenuResponse() {
    try {
      console.log("📋 Getting main menu response...");

      const mainMenus = await this.getMainMenus();
      console.log("📋 Main menus found:", mainMenus.length);
      console.log("📋 Main menus:", mainMenus);

      let response = "🤖 *Selamat Datang di Bot System*\n\n";
      response += "Silakan pilih menu di bawah ini:\n\n";

      if (mainMenus.length === 0) {
        response += "❌ Tidak ada menu yang tersedia.\n";
        response += "Silakan hubungi administrator untuk menambahkan menu.";
        console.log("📋 No main menus found, returning empty menu message");
      } else {
        mainMenus.forEach((menu) => {
          response += `🔹 ${menu.keyword}. ${menu.description}\n`;
        });
        console.log("📋 Menu response generated successfully");
      }

      response += "\n📝 *Cara penggunaan:*\n";
      response += "• Ketik angka menu (contoh: 1)\n";
      response += "• Atau ketik kata kunci (contoh: jadwal)\n";
      response += "• Ketik 'menu' untuk kembali ke menu utama";

      return response;
    } catch (error) {
      console.error("❌ Error in getMainMenuResponse:", error.message);
      console.error("❌ Error stack:", error.stack);
      return this.getErrorMessage(error);
    }
  }

  // Method untuk memformat hasil pencarian
  async formatSearchResults(results) {
    if (results.length === 0) {
      return "❌ Tidak ditemukan menu yang sesuai dengan kata kunci tersebut.\n\n🔙 Ketik 'menu' untuk kembali ke menu utama";
    }

    let response = "🔍 *Hasil Pencarian:*\n\n";
    results.forEach((menu) => {
      response += `🔹 ${menu.keyword}. ${menu.description}\n`;
    });
    response += "\n🔙 Ketik 'menu' untuk kembali ke menu utama";

    return response;
  }

  // Method untuk memproses pesan
  async processMessage(message) {
    try {
      await this.ensureConnection();

      const lowerMessage = message.toLowerCase().trim();

      // Cari menu berdasarkan keyword
      const menu = await this.findMenuByKeyword(lowerMessage);
      if (menu) {
        if (menu.url && menu.url !== "Masih dalam pengembangan") {
          // Jika ada URL, cari sub menu
          const subMenus = await this.getSubMenus(menu.id);
          if (subMenus.length > 0) {
            let response = `📋 *${menu.description}*\n\n`;
            subMenus.forEach((subMenu) => {
              response += `🔹 ${subMenu.keyword}. ${subMenu.description}\n`;
            });
            response += "\n🔙 Ketik 'menu' untuk kembali ke menu utama";
            return response;
          } else {
            // Jika ada URL, ambil data dari URL
            try {
              const data = await this.fetchDataFromUrl(menu.url);
              return `📋 *${menu.description}*\n\n${data}\n\n🔙 Ketik 'menu' untuk kembali ke menu utama`;
            } catch (error) {
              console.error(
                `Error fetching data from ${menu.url}:`,
                error.message
              );
              return `📋 *${menu.description}*\n\n⚠️ Gagal mengambil data dari server.\n\n🔙 Ketik 'menu' untuk kembali ke menu utama`;
            }
          }
        } else {
          // Jika tidak ada URL, cari sub menu
          const subMenus = await this.getSubMenus(menu.id);
          if (subMenus.length > 0) {
            let response = `📋 *${menu.description}*\n\n`;
            subMenus.forEach((subMenu) => {
              response += `🔹 ${subMenu.keyword}. ${subMenu.description}\n`;
            });
            response += "\n🔙 Ketik 'menu' untuk kembali ke menu utama";
            return response;
          } else {
            return `📋 *${menu.description}*\n\n⚠️ Fitur ini masih dalam pengembangan.\n\n🔙 Ketik 'menu' untuk kembali ke menu utama`;
          }
        }
      }

      // Jika tidak ditemukan, cari berdasarkan description
      const searchResults = await this.searchMenuByDescription(lowerMessage);
      if (searchResults.length > 0) {
        return await this.formatSearchResults(searchResults);
      }

      // Default response
      return "❌ Menu tidak ditemukan.\n\n🔙 Ketik 'menu' untuk melihat daftar menu yang tersedia.";
    } catch (error) {
      console.error("Error processing message:", error.message);
      return this.getErrorMessage(error);
    }
  }

  // Method untuk memastikan koneksi database
  async ensureConnection() {
    if (!this.isConnected) {
      await this.connect();
    }
  }

  // Method untuk mendapatkan error message
  getErrorMessage(error) {
    return (
      "❌ Terjadi kesalahan dalam memproses permintaan Anda.\n\n" +
      "Silakan coba lagi atau hubungi administrator.\n\n" +
      "🔙 Ketik 'menu' untuk kembali ke menu utama"
    );
  }

  // Method untuk menutup koneksi database
  async close() {
    try {
      if (this.db) {
        this.db.close();
        this.isConnected = false;
        console.log("✅ SQLite database connection closed");
      }
    } catch (error) {
      console.error("❌ Error closing database:", error.message);
    }
  }
}

export default SQLiteDatabaseHandler;
