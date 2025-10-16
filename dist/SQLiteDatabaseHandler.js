// Database Configuration untuk JSON File Database (Built-in Node.js)
import fs from "fs/promises";
import path from "path";
import bcrypt from "bcrypt"; // Import bcrypt for password hashing

class SQLiteDatabaseHandler {
  constructor() {
    this.dbPath = "./database.json";
    this.data = {
      tb_menu: [],
      tb_botmenu: [],
      tb_users: [],
    };
  }

  async connect(maxRetries = 3, retryDelay = 2000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(
          `🔄 JSON Database connection attempt ${attempt}/${maxRetries}`
        );

        // Load existing data or create new
        try {
          const fileContent = await fs.readFile(this.dbPath, "utf8");
          this.data = JSON.parse(fileContent);
        } catch (error) {
          // File doesn't exist, create new
          console.log("📁 Creating new database file");
          this.data = {
            tb_menu: [],
            tb_botmenu: [],
            tb_users: [],
          };
        }

        console.log("✅ JSON Database connected successfully");
        return true;
      } catch (error) {
        console.error(
          `❌ JSON Database connection attempt ${attempt} failed:`,
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

    console.error("❌ All JSON Database connection attempts failed");
    return false;
  }

  // Method untuk save data ke file
  async saveData() {
    try {
      await fs.writeFile(this.dbPath, JSON.stringify(this.data, null, 2));
      return true;
    } catch (error) {
      console.error("Error saving data:", error.message);
      return false;
    }
  }

  // Method untuk check connection health
  checkConnectionHealth() {
    try {
      return this.data !== null;
    } catch (error) {
      console.error("❌ JSON Database health check failed:", error.message);
      return false;
    }
  }

  // Method untuk reconnect jika diperlukan
  async ensureConnection() {
    if (!this.checkConnectionHealth()) {
      console.log(
        "🔄 JSON Database connection lost, attempting to reconnect..."
      );
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
      // Pastikan koneksi database sehat dan data fresh
      await this.ensureConnection();

      // Reload data dari file untuk memastikan data terbaru
      await this.connect();

      return this.data.tb_botmenu
        .filter((menu) => menu.parent_id === null)
        .sort((a, b) => a.keyword.localeCompare(b.keyword));
    } catch (error) {
      console.error("Error getting main menus:", error.message);
      return [];
    }
  }

  // Method untuk mendapatkan sub menu berdasarkan parent_id
  async getSubMenus(parentId) {
    try {
      // Pastikan data fresh
      await this.ensureConnection();
      await this.connect();

      return this.data.tb_botmenu
        .filter((menu) => menu.parent_id === parentId)
        .sort((a, b) => a.keyword.localeCompare(b.keyword));
    } catch (error) {
      console.error("Error getting sub menus:", error.message);
      return [];
    }
  }

  // Method untuk mendapatkan menu berdasarkan ID
  async getMenuById(id) {
    try {
      // Pastikan data fresh
      await this.ensureConnection();
      await this.connect();

      return this.data.tb_botmenu.find((menu) => menu.id === id) || null;
    } catch (error) {
      console.error("Error getting menu by ID:", error.message);
      return null;
    }
  }

  // Method untuk mendapatkan menu berdasarkan keyword (semua menu)
  async getMenuByKeyword(keyword) {
    try {
      // Pastikan data fresh
      await this.ensureConnection();
      await this.connect();

      return (
        this.data.tb_botmenu.find((menu) => menu.keyword === keyword) || null
      );
    } catch (error) {
      console.error("Error getting menu by keyword:", error.message);
      return null;
    }
  }

  // Method untuk mencari menu berdasarkan deskripsi
  async searchMenuByDescription(searchTerm) {
    try {
      // Pastikan data fresh
      await this.ensureConnection();
      await this.connect();

      return this.data.tb_botmenu
        .filter(
          (menu) =>
            menu.description.toLowerCase().includes(searchTerm.toLowerCase()) &&
            menu.parent_id === null
        )
        .sort((a, b) => a.keyword.localeCompare(b.keyword));
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
      if (!this.data) {
        await this.connect();
      }

      // Insert sample data jika belum ada
      if (this.data.tb_menu.length === 0) {
        this.data.tb_menu = [
          {
            id: 1,
            name: "Menu Utama",
            remark: "Menu utama bot",
            time_stamp: new Date().toISOString(),
          },
          {
            id: 2,
            name: "Informasi",
            remark: "Menu informasi",
            time_stamp: new Date().toISOString(),
          },
          {
            id: 3,
            name: "Layanan",
            remark: "Menu layanan",
            time_stamp: new Date().toISOString(),
          },
        ];

        this.data.tb_botmenu = [
          {
            id: 1,
            menu_id: 1,
            parent_id: null,
            keyword: "1",
            description: "Menu Utama",
            url: null,
          },
          {
            id: 2,
            menu_id: 1,
            parent_id: null,
            keyword: "2",
            description: "Informasi",
            url: null,
          },
          {
            id: 3,
            menu_id: 1,
            parent_id: null,
            keyword: "3",
            description: "Layanan",
            url: null,
          },
          {
            id: 4,
            menu_id: 2,
            parent_id: null,
            keyword: "21",
            description: "Tentang Kami",
            url: null,
          },
          {
            id: 5,
            menu_id: 2,
            parent_id: null,
            keyword: "22",
            description: "Kontak",
            url: null,
          },
          {
            id: 6,
            menu_id: 3,
            parent_id: null,
            keyword: "31",
            description: "Jadwal",
            url: null,
          },
          {
            id: 7,
            menu_id: 3,
            parent_id: null,
            keyword: "32",
            description: "Booking",
            url: null,
          },
        ];

        await this.saveData();
        console.log("✅ Sample data inserted into JSON database");
      }

      // Insert default admin user jika belum ada
      if (this.data.tb_users.length === 0) {
        const hashedPassword = await bcrypt.hash("admin321", 10);

        this.data.tb_users = [
          {
            id: 1,
            username: "admin",
            password: hashedPassword,
            email: "admin@waku.local",
            full_name: "Administrator",
            role: "admin",
            is_active: 1,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            last_login: null,
          },
          {
            id: 2,
            username: "user",
            password: hashedPassword,
            email: "user@waku.local",
            full_name: "Regular User",
            role: "user",
            is_active: 1,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            last_login: null,
          },
        ];

        await this.saveData();
        console.log("✅ Default users created (admin/admin321, user/admin321)");
      }

      console.log("✅ JSON Database setup completed");
      return true;
    } catch (error) {
      console.error("❌ JSON Database setup failed:", error);
      return false;
    }
  }

  // Method untuk close connection
  close() {
    this.data = null;
    console.log("✅ JSON Database connection closed");
  }
}

export default SQLiteDatabaseHandler;
