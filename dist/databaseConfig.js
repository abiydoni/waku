// Database Configuration untuk Node.js
// Sesuaikan dengan konfigurasi database Anda

export const databaseConfig = {
  // Konfigurasi database MySQL
  host: "localhost",
  user: "appsbeem_admin",
  password: "A7by777__", // Masukkan password database Anda
  database: "appsbeem_botwa", // Nama database Anda
  charset: "utf8mb4",

  // Konfigurasi koneksi yang benar untuk mysql2
  port: 3306,
  connectTimeout: 60000,
  multipleStatements: false,

  // Konfigurasi SSL (opsional)
  ssl: false,
};

// Environment variables override
if (process.env.DB_HOST) databaseConfig.host = process.env.DB_HOST;
if (process.env.DB_USER) databaseConfig.user = process.env.DB_USER;
if (process.env.DB_PASS) databaseConfig.password = process.env.DB_PASS;
if (process.env.DB_NAME) databaseConfig.database = process.env.DB_NAME;
