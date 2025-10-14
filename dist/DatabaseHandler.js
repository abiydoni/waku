import mysql from "mysql2/promise";
import { databaseConfig } from "./databaseConfig.js";

class DatabaseHandler {
  constructor() {
    this.connection = null;
    this.config = databaseConfig;
  }

  async connect() {
    try {
      this.connection = await mysql.createConnection(this.config);
      console.log("✅ Database connected successfully");
      return true;
    } catch (error) {
      console.error("❌ Database connection failed:", error.message);

      // Berikan pesan error yang spesifik berdasarkan jenis error
      if (error.code === "ECONNREFUSED") {
        console.error(
          "🔌 MySQL server tidak berjalan atau tidak dapat diakses"
        );
      } else if (error.code === "ER_ACCESS_DENIED_ERROR") {
        console.error("🔐 Username atau password database salah");
      } else if (error.code === "ER_BAD_DB_ERROR") {
        console.error("📁 Database tidak ditemukan");
      } else if (error.code === "ETIMEDOUT") {
        console.error("⏰ Koneksi timeout - server tidak merespon");
      } else {
        console.error("❓ Error tidak dikenal:", error.code);
      }

      return false;
    }
  }

  // Method untuk mendapatkan pesan error yang user-friendly
  getErrorMessage(error) {
    if (error.code === "ECONNREFUSED") {
      return (
        "🔌 *Server Database Tidak Tersedia*\n\n" +
        "Mohon maaf, server database sedang tidak dapat diakses.\n" +
        "Silakan coba lagi dalam beberapa saat.\n\n" +
        "🔙 Ketik 'menu' untuk kembali ke menu utama"
      );
    } else if (error.code === "ER_ACCESS_DENIED_ERROR") {
      return (
        "🔐 *Error Koneksi Database*\n\n" +
        "Terjadi masalah dengan koneksi database.\n" +
        "Silakan hubungi administrator untuk memperbaiki masalah ini.\n\n" +
        "🔙 Ketik 'menu' untuk kembali ke menu utama"
      );
    } else if (error.code === "ER_BAD_DB_ERROR") {
      return (
        "📁 *Database Tidak Ditemukan*\n\n" +
        "Database yang diperlukan tidak tersedia.\n" +
        "Silakan hubungi administrator untuk setup database.\n\n" +
        "🔙 Ketik 'menu' untuk kembali ke menu utama"
      );
    } else if (error.code === "ETIMEDOUT") {
      return (
        "⏰ *Koneksi Timeout*\n\n" +
        "Server database tidak merespon dalam waktu yang ditentukan.\n" +
        "Silakan coba lagi nanti.\n\n" +
        "🔙 Ketik 'menu' untuk kembali ke menu utama"
      );
    } else {
      return (
        "❌ *Terjadi Kesalahan Sistem*\n\n" +
        "Mohon maaf, terjadi kesalahan yang tidak terduga.\n" +
        "Silakan coba lagi atau hubungi administrator.\n\n" +
        "🔙 Ketik 'menu' untuk kembali ke menu utama"
      );
    }
  }

  // Method untuk mendapatkan semua menu utama (parent_id = NULL)
  async getMainMenus() {
    try {
      if (!this.connection) {
        throw new Error("Database not connected");
      }

      const [rows] = await this.connection.execute(
        `SELECT id, parent_id, keyword, description, url 
         FROM tb_botmenu 
         WHERE parent_id IS NULL 
         ORDER BY keyword ASC`
      );
      return rows;
    } catch (error) {
      console.error("Error getting main menus:", error.message);

      // Jika error koneksi database, throw error untuk ditangani di level atas
      if (
        error.code === "ECONNREFUSED" ||
        error.code === "ER_ACCESS_DENIED_ERROR" ||
        error.code === "ER_BAD_DB_ERROR" ||
        error.code === "ETIMEDOUT"
      ) {
        throw error;
      }

      return [];
    }
  }

  // Method untuk mendapatkan sub menu berdasarkan parent_id
  async getSubMenus(parentId) {
    try {
      const [rows] = await this.connection.execute(
        `SELECT id, parent_id, keyword, description, url 
         FROM tb_botmenu 
         WHERE parent_id = ? 
         ORDER BY keyword ASC`,
        [parentId]
      );
      return rows;
    } catch (error) {
      console.error("Error getting sub menus:", error.message);
      return [];
    }
  }

  // Method untuk mendapatkan menu berdasarkan ID
  async getMenuById(id) {
    try {
      const [rows] = await this.connection.execute(
        `SELECT id, parent_id, keyword, description, url 
         FROM tb_botmenu 
         WHERE id = ?`,
        [id]
      );
      return rows[0] || null;
    } catch (error) {
      console.error("Error getting menu by ID:", error.message);
      return null;
    }
  }

  // Method untuk mendapatkan menu berdasarkan keyword (semua menu)
  async getMenuByKeyword(keyword) {
    try {
      if (!this.connection) {
        throw new Error("Database not connected");
      }

      // Cari di semua menu berdasarkan keyword (baik menu utama maupun sub menu)
      const [rows] = await this.connection.execute(
        `SELECT id, parent_id, keyword, description, url 
         FROM tb_botmenu 
         WHERE keyword = ?`,
        [keyword]
      );

      if (rows.length > 0) {
        return rows[0];
      }

      return null;
    } catch (error) {
      console.error("Error getting menu by keyword:", error.message);

      // Jika error koneksi database, throw error untuk ditangani di level atas
      if (
        error.code === "ECONNREFUSED" ||
        error.code === "ER_ACCESS_DENIED_ERROR" ||
        error.code === "ER_BAD_DB_ERROR" ||
        error.code === "ETIMEDOUT"
      ) {
        throw error;
      }

      return null;
    }
  }

  // Method untuk mencari menu berdasarkan deskripsi
  async searchMenuByDescription(searchTerm) {
    try {
      const [rows] = await this.connection.execute(
        `SELECT id, parent_id, keyword, description, url 
         FROM tb_botmenu 
         WHERE description LIKE ? AND parent_id IS NULL
         ORDER BY keyword ASC`,
        [`%${searchTerm}%`]
      );
      return rows;
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
        // Berikan pesan error berdasarkan status code
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
        } else if (response.status === 403) {
          return (
            "🔒 *Akses Ditolak*\n\n" +
            "Anda tidak memiliki izin untuk mengakses data ini.\n" +
            "Silakan hubungi administrator.\n\n" +
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

      // Berikan pesan error berdasarkan jenis error
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
}

export default DatabaseHandler;
