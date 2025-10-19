console.log("🚀 Starting WA Gateway Server...");
console.log("📊 Node.js version:", process.version);
console.log("📊 Current directory:", process.cwd());

import express from "express";
import path from "path";
import fs from "fs";
import qrcode from "qrcode";
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import axios from "axios";
import { spawn } from "child_process";
import SQLiteDatabaseHandler from "./SQLiteDatabaseHandler.js";

console.log("✅ All imports loaded successfully");

const app = express();
const PORT = process.env.PORT || 4006;
const HOST = process.env.HOST || "localhost";

// Initialize global database handler
let dbHandler;
async function initializeDatabase() {
  dbHandler = new SQLiteDatabaseHandler();
  await dbHandler.connect();
  console.log("✅ Global database handler initialized");
}

// Helper function untuk menyimpan session ke database
async function saveSessionToDatabase(sessionId, sessionData) {
  try {
    // Extract number from sessionId jika masih menggunakan format lama
    let cleanSessionId = sessionId;
    if (sessionId.startsWith("auth_info_session")) {
      cleanSessionId = sessionId.replace("auth_info_session", "");
    }

    const sessionInfo = {
      session_id: cleanSessionId,
      session_name: sessionData.session_name || `Session ${cleanSessionId}`,
      status: sessionData.status || "disconnected",
      phone_number: sessionData.phone_number || null,
      qr_code: sessionData.qr || null,
      current_menu_id: sessionData.current_menu_id || null,
      user_context: sessionData.user_context || null,
      bot_enabled: sessionData.bot_enabled !== false ? 1 : 0,
      auto_reply_enabled: sessionData.auto_reply_enabled !== false ? 1 : 0,
      group_reply_enabled: sessionData.group_reply_enabled ? 1 : 0,
    };

    await dbHandler.saveSession(sessionInfo);
    console.log(`💾 Session saved to database: ${cleanSessionId}`);
  } catch (error) {
    console.error(`❌ Error saving session to database:`, error.message);
  }
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cookie parser middleware (simple implementation)
app.use((req, res, next) => {
  req.cookies = {};
  if (req.headers.cookie) {
    console.log(`🍪 Raw cookies: ${req.headers.cookie}`);
    req.headers.cookie.split(";").forEach((cookie) => {
      const parts = cookie.trim().split("=");
      if (parts.length === 2) {
        req.cookies[parts[0]] = parts[1];
      }
    });
    console.log(`🍪 Parsed cookies:`, req.cookies);
  } else {
    console.log(`🍪 No cookies found`);
  }
  next();
});

app.use(express.static(path.join(process.cwd(), "public")));

// Simple authentication middleware
function requireAuth(req, res, next) {
  const authToken = req.cookies?.authToken;
  console.log(`🔐 Auth check - Cookie: ${authToken}`);

  if (authToken === "wa-gateway-auth-2024") {
    console.log(`✅ Authentication successful`);
    return next();
  } else {
    console.log(`❌ Authentication failed - redirecting to login`);
    return res.redirect("/login");
  }
}

// Default credentials
const DEFAULT_CREDENTIALS = {
  username: process.env.ADMIN_USERNAME || "admin",
  password: process.env.ADMIN_PASSWORD || "admin321",
};

// View engine
app.set("view engine", "ejs");
app.set("views", path.join(process.cwd(), "views"));

// Login routes
app.get("/login", (req, res) => {
  const authToken = req.cookies?.authToken;
  if (authToken === "wa-gateway-auth-2024") {
    return res.redirect("/dashboard");
  }
  const error = req.query.error || null;
  res.render("login", { error });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;

  console.log(`🔐 Login attempt: ${username}`);

  if (
    username === DEFAULT_CREDENTIALS.username &&
    password === DEFAULT_CREDENTIALS.password
  ) {
    // Set authentication cookie
    res.cookie("authToken", "wa-gateway-auth-2024", {
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      httpOnly: true,
      secure: false, // Set to true if using HTTPS
    });

    // Set username cookie
    res.cookie("username", username, {
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      httpOnly: true,
      secure: false, // Set to true if using HTTPS
    });

    console.log(`✅ Login successful: ${username}`);
    res.json({
      success: true,
      message: "Login berhasil",
      username: username,
    });
  } else {
    console.log(`❌ Login failed: ${username}`);
    res.status(401).json({
      success: false,
      message: "Username atau password salah",
    });
  }
});

app.post("/api/logout", (req, res) => {
  console.log(`🔐 Logout request`);

  // Clear authentication cookies
  res.clearCookie("authToken");
  res.clearCookie("username");
  res.json({ success: true, message: "Logout berhasil" });
});

// Enhanced health check endpoint
app.get("/health", (req, res) => {
  const sessionStatus = Object.keys(sessions).map((sessionId) => {
    const session = sessions[sessionId];
    return {
      sessionId,
      status: session?.status || "unknown",
      isConnected: session?.status === "connected",
      reconnectAttempts: session?.reconnectAttempts || 0,
      lastHeartbeat: session?.lastHeartbeat || null,
      heartbeatFailures: session?.heartbeatFailures || 0,
      reconnecting: session?.reconnecting || false,
    };
  });

  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    sessions: {
      total: Object.keys(sessions).length,
      connected: sessionStatus.filter((s) => s.isConnected).length,
      disconnected: sessionStatus.filter((s) => s.status === "disconnected")
        .length,
      reconnecting: sessionStatus.filter((s) => s.reconnecting).length,
      details: sessionStatus,
    },
    database: {
      connected: botHandler.dbHandler.connection ? true : false,
    },
  });
});

// Serve test QR page
app.get("/test-qr", (req, res) => {
  res.sendFile(path.join(process.cwd(), "test-qr.html"));
});

// --- Sessions in-memory ---
let sessions = {}; // { sessionId: { sock, status, qr, groups: [] } }

// --- Bot settings in-memory ---
let botSettings = {}; // { sessionId: { enabled: true, responses: {...}, config: {...} } }

// Simple bot menu configuration
const defaultBotConfigs = {
  menu_bot: {
    name: "Menu Bot",
    personality: "helpful",
    responseTime: "fast",
    features: {
      autoReply: true,
      groupReply: false,
      mediaSupport: false,
      menuSystem: true,
      analytics: false,
    },
    responses: {
      defaultResponse:
        "🤖 Halo! Silakan pilih menu yang tersedia atau ketik 'menu' untuk melihat pilihan.",
      greetingResponse:
        "👋 Halo! Selamat datang! Ketik 'menu' untuk melihat pilihan yang tersedia.",
      infoResponse:
        "ℹ️ Ini adalah bot menu. Ketik 'menu' untuk melihat pilihan atau ketik nomor menu yang diinginkan.",
      goodbyeResponse:
        "👋 Terima kasih! Ketik 'menu' jika membutuhkan bantuan lagi.",
      errorResponse:
        "❌ Menu tidak ditemukan. Ketik 'menu' untuk melihat pilihan yang tersedia.",
    },
  },
};

// --- Bot Handler Class ---
class BotHandler {
  constructor() {
    this.dbHandler = new SQLiteDatabaseHandler();
    this.userSessions = new Map(); // Menyimpan session user
    this.botEnabled = true; // Flag untuk enable/disable bot

    // Initialize database connection
    this.initializeDatabase();
  }

  async initializeDatabase() {
    console.log("🔄 Initializing database connection...");
    const connected = await this.dbHandler.connect();
    if (!connected) {
      console.error("❌ Failed to connect to SQLite database");
    } else {
      console.log("✅ Database connected successfully");
      // Setup database tables and sample data
      try {
        await this.dbHandler.setupDatabase();
        console.log("✅ Database setup completed");
      } catch (setupError) {
        console.error("❌ Database setup failed:", setupError.message);
      }
    }
  }

  // Method untuk memproses pesan masuk dari WhatsApp
  async processMessage(sessionId, from, messageText) {
    try {
      console.log(`🤖 Bot processing message from ${from}: "${messageText}"`);

      // Skip jika bot tidak aktif
      if (!this.botEnabled) {
        console.log("🤖 Bot is disabled, skipping message processing");
        return;
      }

      // Block group messages - bot should only reply to personal chats
      if (from.includes("@g.us")) {
        console.log(
          `🚫 Blocking group message for ${sessionId} from group: ${from} - Bot only replies to personal chats`
        );
        return; // Skip processing group messages
      }

      // Skip jika pesan dari bot sendiri
      if (messageText.startsWith("🤖") || messageText.startsWith("📋")) {
        return;
      }

      // Get user session
      let userSession = this.userSessions.get(from) || {
        currentMenu: null,
        lastActivity: Date.now(),
      };

      // Update last activity
      userSession.lastActivity = Date.now();
      this.userSessions.set(from, userSession);

      // Process message through bot API
      console.log(`🤖 Calling bot API with message: "${messageText}"`);
      const response = await this.callBotAPI(
        "process",
        {
          message: messageText,
        },
        sessionId
      );

      console.log(`🤖 Bot API response:`, response);

      if (response.success) {
        // Send response back to user
        console.log(`🤖 Sending response to ${from}: "${response.response}"`);
        await this.sendMessageToWhatsApp(sessionId, from, response.response);
      } else {
        console.error("Bot API error:", response.message);
        await this.sendMessageToWhatsApp(
          sessionId,
          from,
          "❌ Terjadi kesalahan saat memproses pesan Anda."
        );
      }
    } catch (error) {
      console.error("Error processing message:", error);
      await this.sendMessageToWhatsApp(
        sessionId,
        from,
        "❌ Terjadi kesalahan sistem. Silakan coba lagi."
      );
    }
  }

  // Method untuk memanggil database handler
  async callBotAPI(action, data = {}, sessionId = null) {
    try {
      console.log(`🤖 Calling Database Handler: ${action}`, data);

      // Ensure database connection
      const connected = await this.dbHandler.connect();
      if (!connected) {
        console.error("❌ Database not connected in callBotAPI");
        return {
          success: false,
          message: "Database not connected",
          error: "Database connection failed",
        };
      }

      switch (action) {
        case "menu":
          console.log("📋 Getting main menu response...");
          const menuResponse = await this.dbHandler.getMainMenuResponse();
          console.log("📋 Menu response:", menuResponse);
          return { success: true, response: menuResponse };

        case "process":
          console.log("🔄 Processing message:", data.message);
          const processResponse = await this.dbHandler.processMessage(
            data.message,
            sessionId
          );
          console.log("🔄 Process response:", processResponse);
          return { success: true, response: processResponse };

        case "processByCurrentMenu":
          console.log("🔄 Processing message by current menu:", data.message);
          const processByCurrentMenuResponse =
            await this.dbHandler.processMessageByCurrentMenu(
              data.message,
              sessionId
            );
          console.log(
            "🔄 Process by current menu response:",
            processByCurrentMenuResponse
          );
          return { success: true, response: processByCurrentMenuResponse };

        case "search":
          console.log("🔍 Searching for:", data.search_term);
          const searchResults = await this.dbHandler.searchMenuByDescription(
            data.search_term
          );
          const searchResponse = await this.dbHandler.formatSearchResults(
            searchResults
          );
          console.log("🔍 Search response:", searchResponse);
          return { success: true, response: searchResponse };

        default:
          return { success: false, message: "Unknown action" };
      }
    } catch (error) {
      console.error("❌ Database handler call failed:", error.message);
      console.error("❌ Error stack:", error.stack);
      return {
        success: false,
        message: "Database call failed",
        error: error.message,
      };
    }
  }

  // Method untuk mengirim pesan ke WhatsApp
  async sendMessageToWhatsApp(sessionId, to, message) {
    try {
      // Gunakan sistem send message yang sudah ada
      const response = await fetch(`http://localhost:${PORT}/api/sendMessage`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: sessionId,
          to: to,
          message: message,
          isGroup: to.includes("@g.us"),
        }),
      });

      const result = await response.json();

      if (result.success) {
        console.log(`✅ Bot message sent to ${to}`);
      } else {
        console.error("Failed to send bot message:", result.error);
      }

      return result;
    } catch (error) {
      console.error("Error sending bot message:", error);
      return { success: false, error: error.message };
    }
  }

  // Method untuk enable/disable bot
  setBotEnabled(enabled) {
    this.botEnabled = enabled;
    console.log(`🤖 Bot ${enabled ? "enabled" : "disabled"}`);
  }

  // Method untuk membersihkan session yang tidak aktif
  cleanupInactiveSessions() {
    const now = Date.now();
    const inactiveThreshold = 30 * 60 * 1000; // 30 menit

    for (const [from, session] of this.userSessions.entries()) {
      if (now - session.lastActivity > inactiveThreshold) {
        this.userSessions.delete(from);
        console.log(`🧹 Cleaned up inactive bot session for ${from}`);
      }
    }
  }

  // Method untuk mendapatkan statistik bot
  getBotStats() {
    return {
      enabled: this.botEnabled,
      activeSessions: this.userSessions.size,
      totalSessions: this.userSessions.size,
    };
  }
}

// --- Global Bot Handler Instance ---
const botHandler = new BotHandler();

// --- Function to clean up problematic sessions ---
async function cleanupProblematicSession(sessionId, contactJid) {
  try {
    console.log(
      `🧹 Cleaning up problematic session for ${contactJid} in ${sessionId}`
    );

    const session = sessions[sessionId];
    if (session && session.sock) {
      // Clear any cached session data for this contact
      try {
        await session.sock.clearSessionData?.(contactJid);
        console.log(`✅ Session data cleared for ${contactJid}`);
      } catch (clearError) {
        console.log(
          `⚠️ Failed to clear session data for ${contactJid}:`,
          clearError.message
        );
      }

      // Request new prekeys with retry logic
      let prekeyRetries = 3;
      while (prekeyRetries > 0) {
        try {
          await session.sock.requestPreKeyBundle(contactJid);
          console.log(
            `✅ PreKey bundle requested successfully for ${contactJid}`
          );
          break;
        } catch (prekeyError) {
          prekeyRetries--;
          console.log(
            `⚠️ PreKey request failed for ${contactJid} (${
              3 - prekeyRetries
            }/3):`,
            prekeyError.message
          );

          if (prekeyRetries > 0) {
            // Wait before retry
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      }

      // Clear decryption attempts for this contact
      if (session.decryptionAttempts) {
        session.decryptionAttempts.delete(contactJid);
        console.log(`✅ Decryption attempts cleared for ${contactJid}`);
      }

      // Additional cleanup for Bad MAC errors
      try {
        // Force refresh session state
        if (session.sock.refreshSession) {
          await session.sock.refreshSession(contactJid);
          console.log(`✅ Session refreshed for ${contactJid}`);
        }
      } catch (refreshError) {
        console.log(
          `⚠️ Session refresh failed for ${contactJid}:`,
          refreshError.message
        );
      }

      console.log(`✅ Session cleanup completed for ${contactJid}`);
    } else {
      console.log(`⚠️ No valid session found for cleanup: ${sessionId}`);
    }
  } catch (error) {
    console.error(
      `❌ Failed to cleanup session for ${contactJid}:`,
      error.message
    );
    // Don't throw the error, just log it to prevent cascading failures
  }
}

// --- Function to manually clear problematic session data ---
async function clearProblematicSessionData(sessionId, contactJid) {
  try {
    console.log(
      `🧹 Manually clearing session data for ${contactJid} in ${sessionId}`
    );

    const session = sessions[sessionId];
    if (session && session.sock) {
      // Clear session data
      if (session.sock.clearSessionData) {
        await session.sock.clearSessionData(contactJid);
        console.log(`✅ Session data cleared for ${contactJid}`);
      }

      // Clear local tracking
      if (session.decryptionAttempts) {
        session.decryptionAttempts.delete(contactJid);
      }

      // Clear last decryption attempt
      if (session.lastDecryptionAttempt) {
        delete session.lastDecryptionAttempt[contactJid];
      }

      console.log(`✅ Manual cleanup completed for ${contactJid}`);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`❌ Manual cleanup failed for ${contactJid}:`, error.message);
    return false;
  }
}

// --- Function to process message with bot and session settings ---
async function processMessageWithBot(sessionId, from, messageText, settings) {
  try {
    console.log(
      `🤖 Processing message for session ${sessionId}: "${messageText}"`
    );

    // Check if bot is enabled for this session
    if (!settings || !settings.enabled) {
      console.log(`🚫 Bot disabled for session ${sessionId}`);
      return;
    }

    // Generate response based on session-specific settings
    console.log(
      `🤖 Generating response for session ${sessionId}, message: "${messageText}"`
    );
    let botResponse = await generateBotResponse(
      messageText,
      settings,
      sessionId
    );

    console.log(
      `🤖 Generated response for session ${sessionId}: "${botResponse}"`
    );

    // Send response back to user using the session's socket
    const session = sessions[sessionId];
    console.log(`🔍 Debug: Session ${sessionId} exists:`, !!session);
    console.log(
      `🔍 Debug: Session socket exists:`,
      !!(session && session.sock)
    );
    console.log(`🔍 Debug: Session status:`, session?.status);
    console.log(`🔍 Debug: Bot response to send:`, botResponse);

    if (session && session.sock) {
      try {
        // Check if socket is still connected
        if (session.sock.user && session.sock.user.id) {
          const sendResult = await session.sock.sendMessage(from, {
            text: botResponse,
          });
          console.log(
            `✅ Bot response sent to ${from} via session ${sessionId}`
          );
          console.log(`📤 Send result:`, sendResult);

          // Send acknowledgment after successful message send
          try {
            if (msg.key && msg.key.id && msg.key.remoteJid) {
              await session.sock.sendMessageAck(msg.key, "read");
              console.log(`✅ Final acknowledgment sent for ${from}`);
            }
          } catch (ackError) {
            console.log(`⚠️ Final acknowledgment failed:`, ackError.message);
          }
        } else {
          console.log(`⚠️ Socket not properly connected, attempting fallback`);
          throw new Error("Socket not connected");
        }
      } catch (sendError) {
        console.error(
          `❌ Failed to send bot response to ${from}:`,
          sendError.message
        );
        console.error(`❌ Send error details:`, sendError);

        // Fallback: Try to send via API endpoint
        try {
          console.log(`🔄 Attempting fallback send via API for ${from}`);
          const response = await fetch(
            `http://localhost:4006/api/sendMessage`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                sessionId: sessionId,
                to: from.replace("@s.whatsapp.net", ""),
                message: botResponse,
              }),
            }
          );

          if (response.ok) {
            console.log(`✅ Fallback response sent successfully to ${from}`);
          } else {
            console.error(`❌ Fallback send failed:`, await response.text());
          }
        } catch (fallbackError) {
          console.error(`❌ Fallback send error:`, fallbackError.message);
        }
      }
    } else {
      console.error(`❌ No socket found for session ${sessionId}`);
      console.error(`❌ Session details:`, session);

      // Fallback: Try to send via API endpoint even without socket
      try {
        console.log(`🔄 Attempting API fallback send for ${from}`);
        const response = await fetch(`http://localhost:4006/api/sendMessage`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sessionId: sessionId,
            to: from.replace("@s.whatsapp.net", ""),
            message: botResponse,
          }),
        });

        if (response.ok) {
          console.log(`✅ API fallback response sent successfully to ${from}`);
        } else {
          console.error(`❌ API fallback send failed:`, await response.text());
        }
      } catch (apiError) {
        console.error(`❌ API fallback send error:`, apiError.message);
      }
    }
  } catch (error) {
    console.error(
      `❌ Error processing message for session ${sessionId}:`,
      error
    );
    // Send error message using session's socket
    const session = sessions[sessionId];
    if (session && session.sock) {
      const errorMessage =
        settings?.responses?.errorResponse ||
        "❌ Terjadi kesalahan sistem. Silakan coba lagi.";
      await session.sock.sendMessage(from, { text: errorMessage });
    }
  }
}

// --- Function to generate bot response based on session settings ---
async function generateBotResponse(messageText, settings, sessionId = null) {
  if (!settings || !settings.responses) {
    return "🤖 Bot sedang aktif, silakan coba lagi.";
  }

  const responses = settings.responses;
  const lowerText = messageText.toLowerCase().trim();

  // Check for greeting keywords
  if (
    lowerText.includes("halo") ||
    lowerText.includes("hi") ||
    lowerText.includes("hello") ||
    lowerText.includes("hai") ||
    lowerText.includes("assalamualaikum") ||
    lowerText.includes("selamat")
  ) {
    return responses.greetingResponse || responses.defaultResponse;
  }

  // Check for menu keywords
  if (
    lowerText.includes("menu") ||
    lowerText.includes("info") ||
    lowerText.includes("informasi") ||
    lowerText.includes("help") ||
    lowerText.includes("bantuan")
  ) {
    // Call bot menu API to get menu
    console.log("🤖 Calling menu API for:", lowerText);
    console.log("🤖 BotHandler exists:", !!botHandler);
    console.log(
      "🤖 BotHandler callBotAPI method exists:",
      typeof botHandler.callBotAPI
    );

    try {
      const response = await botHandler.callBotAPI("menu", {}, sessionId);
      console.log("🤖 Menu API response:", response);
      console.log("🤖 Response success:", response.success);
      console.log("🤖 Response data:", response.response);

      if (response.success) {
        console.log("🤖 Using API response");
        return response.response;
      } else {
        console.log("🤖 API response not successful, using fallback");
      }
    } catch (error) {
      console.error("Error getting menu:", error);
      console.error("Error details:", error.message);
      console.error("Error stack:", error.stack);
    }
    // Fallback response if API is not available
    return (
      "🤖 *Menu Bot*\n\n" +
      "Silakan pilih menu di bawah ini:\n\n" +
      "🔹 1. Menu Utama\n" +
      "🔹 2. Informasi\n" +
      "🔹 3. Bantuan\n\n" +
      "📝 *Cara penggunaan:*\n" +
      "• Ketik angka menu (contoh: 1)\n" +
      "• Atau ketik kata kunci\n" +
      "• Ketik 'menu' untuk kembali ke menu utama"
    );
  }

  // Check for goodbye keywords
  if (
    lowerText.includes("terima kasih") ||
    lowerText.includes("thanks") ||
    lowerText.includes("makasih") ||
    lowerText.includes("bye") ||
    lowerText.includes("selamat tinggal") ||
    lowerText.includes("sampai jumpa")
  ) {
    return responses.goodbyeResponse || responses.defaultResponse;
  }

  // Check if message is numeric (menu selection)
  if (isNumeric(lowerText)) {
    console.log("🤖 Processing numeric menu selection:", lowerText);
    try {
      // Gunakan process biasa untuk pesan numerik
      const response = await botHandler.callBotAPI(
        "process",
        {
          message: lowerText,
        },
        sessionId
      );
      console.log("🤖 Process API response:", response);
      if (response.success) {
        return response.response;
      }
    } catch (error) {
      console.error("Error processing menu selection:", error);
    }
  }

  // Check for search terms
  if (lowerText.length > 2) {
    console.log("🤖 Searching for:", lowerText);
    try {
      const response = await botHandler.callBotAPI(
        "search",
        {
          search_term: lowerText,
        },
        sessionId
      );
      console.log("🤖 Search API response:", response);
      if (response.success) {
        return response.response;
      }
    } catch (error) {
      console.error("Error searching menu:", error);
    }
  }

  // For non-numeric messages, try regular process first
  if (!isNumeric(lowerText)) {
    console.log("🤖 Processing non-numeric message:", lowerText);
    try {
      const response = await botHandler.callBotAPI(
        "process",
        {
          message: lowerText,
        },
        sessionId
      );
      console.log("🤖 Process API response:", response);
      if (response.success) {
        return response.response;
      }
    } catch (error) {
      console.error("Error processing message:", error);
    }
  }

  // Default response
  console.log("🤖 Using default response for:", messageText);
  return responses.defaultResponse;
}

// Helper function to check if string is numeric
function isNumeric(str) {
  return /^\d+$/.test(str);
}

// --- Load existing session folder ---
const authFolder = process.cwd();
function loadSessions() {
  try {
    const dirs = fs
      .readdirSync(authFolder, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith("auth_info_"))
      .map((d) => d.name.replace("auth_info_", ""));

    console.log(`📁 Found ${dirs.length} existing sessions:`, dirs);

    dirs.forEach((id) => {
      if (!sessions[id])
        sessions[id] = {
          sock: null,
          status: "disconnected",
          qr: null,
          groups: [],
        };

      // Initialize bot settings for existing sessions
      if (!botSettings[id]) {
        botSettings[id] = {
          enabled: true,
          responses: {
            defaultResponse:
              "🤖 Halo! Terima kasih sudah menghubungi saya. Bot sedang aktif.",
            greetingResponse: "👋 Halo! Ada yang bisa saya bantu?",
            infoResponse:
              "ℹ️ Ini adalah WhatsApp Bot yang sedang aktif. Silakan kirim pesan untuk berinteraksi.",
          },
        };
        console.log(`🤖 Initialized bot settings for existing session ${id}`);
      }
    });
  } catch (error) {
    console.error("❌ Error loading sessions:", error);
  }
}
loadSessions();

// --- Initialize session + bot ---
async function initSession(sessionId) {
  console.log(`🔄 Initializing session: ${sessionId}`);
  console.log(`📊 Current session state:`, sessions[sessionId]);

  if (sessions[sessionId].sock && sessions[sessionId].status === "connected") {
    console.log(`✅ Session ${sessionId} already connected`);
    return; // sudah jalan dan connected
  }

  try {
    console.log(`📁 Loading auth state for ${sessionId}`);
    const { state, saveCreds } = await useMultiFileAuthState(
      `auth_info_${sessionId}`
    );
    console.log(`📁 Auth state loaded for ${sessionId}:`, {
      hasCreds: !!state.creds,
      hasKeys: !!state.keys,
    });

    console.log(`🔧 Getting latest Baileys version`);
    const { version } = await fetchLatestBaileysVersion();
    console.log(`🔧 Baileys version:`, version);

    console.log(`📱 Creating WhatsApp socket for ${sessionId}`);
    const sock = makeWASocket({
      version,
      auth: state,
      // Enhanced configuration for persistent connection
      generateHighQualityLinkPreview: true,
      markOnlineOnConnect: true,
      syncFullHistory: false,
      // Aggressive connection settings
      retryRequestDelayMs: 1000,
      maxMsgRetryCount: 5,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      // Always online settings
      defaultQueryTimeoutMs: 60000,
      // Enhanced persistence settings
      shouldSyncHistoryMessage: () => false,
      shouldIgnoreJid: () => false,
      // Connection recovery settings
      browser: ["WA-KU", "Chrome", "1.0.0"],
      // Keep connection alive
      keepAliveIntervalMs: 25000,
      // Enhanced reconnection
      connectTimeoutMs: 90000,
      logger: {
        level: "silent",
        child() {
          return {
            level: "silent",
            debug() {},
            info() {},
            warn() {},
            error(...args) {
              console.error(`[${sessionId}]`, ...args);
            },
            trace() {},
          };
        },
        debug() {},
        info() {},
        warn() {},
        error(...args) {
          console.error(`[${sessionId}]`, ...args);
        },
        trace() {},
      },
    });
    console.log(`📱 Socket created for ${sessionId}`);

    sessions[sessionId].sock = sock;
    sessions[sessionId].status = "connecting";
    sessions[sessionId].qr = null; // Reset QR

    console.log(`✅ Socket created for ${sessionId}`);

    // Set timeout for QR generation (30 seconds)
    const qrTimeout = setTimeout(() => {
      if (
        sessions[sessionId].status === "connecting" &&
        !sessions[sessionId].qr
      ) {
        console.log(`⏰ QR timeout for session ${sessionId}, retrying...`);
        sessions[sessionId].status = "disconnected";
        // Retry connection
        setTimeout(() => {
          initSession(sessionId).catch((err) => {
            console.error(`❌ Retry failed for ${sessionId}:`, err);
          });
        }, 5000);
      }
    }, 30000);

    // --- credentials update ---
    sock.ev.on("creds.update", saveCreds);

    // --- connection update ---
    sock.ev.on("connection.update", async (update) => {
      // Guard: session may have been deleted while events are still firing
      if (!sessions[sessionId] || sessions[sessionId].deleted) {
        return;
      }
      const { connection, qr, lastDisconnect } = update;

      console.log(`📱 Session ${sessionId} connection update:`, {
        connection,
        hasQR: !!qr,
        qrLength: qr ? qr.length : 0,
      });

      if (qr) {
        try {
          console.log(
            `📱 QR received for session ${sessionId}, generating image...`
          );
          if (!sessions[sessionId] || sessions[sessionId].deleted) return;
          sessions[sessionId].qr = await qrcode.toDataURL(qr);
          sessions[sessionId].status = "connecting";
          console.log(
            `✅ QR generated for session ${sessionId}, length: ${sessions[sessionId].qr.length}`
          );
          // Clear QR timeout since QR is now available
          if (qrTimeout) clearTimeout(qrTimeout);
        } catch (err) {
          console.error(`❌ QR generation failed for ${sessionId}:`, err);
        }
      }

      if (connection === "open") {
        if (!sessions[sessionId] || sessions[sessionId].deleted) return;
        sessions[sessionId].status = "connected";
        sessions[sessionId].qr = null; // Clear QR after connection
        sessions[sessionId].reconnectAttempts = 0; // Reset reconnect attempts
        sessions[sessionId].heartbeatFailures = 0; // Reset heartbeat failures
        sessions[sessionId].lastHeartbeat = Date.now(); // Set initial heartbeat time

        // Save session status to database
        await saveSessionToDatabase(sessionId, sessions[sessionId]);

        try {
          console.log(`📋 Fetching groups for session ${sessionId}...`);
          const groups = await sock.groupFetchAllParticipating();
          console.log(`📋 Raw groups data for ${sessionId}:`, groups);
          console.log(
            `📋 Groups count for ${sessionId}:`,
            Object.keys(groups).length
          );

          if (!sessions[sessionId] || sessions[sessionId].deleted) return;

          const processedGroups = Object.values(groups).map((g) => ({
            jid: g.id,
            name: g.subject,
          }));

          sessions[sessionId].groups = processedGroups;
          console.log(`📋 Processed groups for ${sessionId}:`, processedGroups);
          console.log(
            `📋 Final groups count for ${sessionId}:`,
            processedGroups.length
          );

          if (processedGroups.length === 0) {
            console.log(`📋 Session ${sessionId} has no WhatsApp groups`);
          }
        } catch (err) {
          console.error(`❌ Failed to fetch groups for ${sessionId}:`, err);
          if (sessions[sessionId]) {
            sessions[sessionId].groups = [];
            console.log(`📋 Set empty groups for ${sessionId} due to error`);
          }
        }
        console.log(
          `✅ Session ${sessionId} connected successfully - Always Connected Mode Active`
        );

        // Force update session status to ensure it's properly marked as connected
        setTimeout(() => {
          if (sessions[sessionId] && sessions[sessionId].sock) {
            sessions[sessionId].status = "connected";
            console.log(
              `🔄 Force-updated session ${sessionId} status to connected`
            );
          }
        }, 1000);
      }

      if (connection === "close") {
        if (!sessions[sessionId] || sessions[sessionId].deleted) return;
        sessions[sessionId].status = "disconnected";
        sessions[sessionId].qr = null;
        console.log(`❌ Session ${sessionId} disconnected`);

        // Save session status to database
        await saveSessionToDatabase(sessionId, sessions[sessionId]);

        // Check disconnect reason
        const disconnectCode = lastDisconnect?.error?.output?.statusCode;
        console.log(`📊 Disconnect reason for ${sessionId}:`, disconnectCode);

        // Handle specific disconnect reasons
        if (disconnectCode === 440) {
          console.log(
            `🚫 Session ${sessionId} stream error (440), attempting reconnection`
          );
          // For stream errors, try to reconnect immediately
          setTimeout(() => {
            if (sessions[sessionId] && !sessions[sessionId].deleted) {
              sessions[sessionId].reconnecting = true;
              initSession(sessionId).catch((err) => {
                console.error(`❌ Reconnection failed for ${sessionId}:`, err);
                sessions[sessionId].reconnecting = false;
              });
            }
          }, 5000);
        } else if (disconnectCode !== DisconnectReason.loggedOut) {
          // Add a flag to prevent multiple reconnection attempts
          if (sessions[sessionId] && !sessions[sessionId].reconnecting) {
            sessions[sessionId].reconnecting = true;
            sessions[sessionId].reconnectAttempts =
              (sessions[sessionId].reconnectAttempts || 0) + 1;

            // Unlimited reconnection attempts with exponential backoff
            const delay = Math.min(
              5000 * Math.pow(1.5, sessions[sessionId].reconnectAttempts - 1),
              60000
            ); // Max 60 seconds

            console.log(
              `🔄 Attempting to reconnect session ${sessionId} (attempt ${
                sessions[sessionId].reconnectAttempts
              }) in ${delay / 1000} seconds...`
            );

            setTimeout(() => {
              if (
                sessions[sessionId] &&
                !sessions[sessionId].deleted &&
                sessions[sessionId].status === "disconnected"
              ) {
                sessions[sessionId].reconnecting = false;
                initSession(sessionId).catch((err) => {
                  console.error(
                    `❌ Reconnection failed for ${sessionId}:`,
                    err
                  );
                  sessions[sessionId].reconnecting = false;
                });
              }
            }, delay);
          }
        } else {
          console.log(
            `🚫 Session ${sessionId} logged out, manual reconnection required`
          );
          sessions[sessionId].reconnecting = false;
        }
      }
    });

    sock.ev.on("creds.update", saveCreds);

    // --- Auto-reply bot ---
    sock.ev.on("messages.upsert", async (m) => {
      // Guard: Check if session is deleted
      if (sessions[sessionId] && sessions[sessionId].deleted) {
        console.log(
          `🚫 Session ${sessionId} already marked for deletion, ignoring messages.`
        );
        return;
      }

      // Continue with message processing
      if (!m.messages) return;

      // Guard: Check if session is connected
      console.log(
        `🔍 Debug: Checking session ${sessionId} status:`,
        sessions[sessionId]?.status
      );
      console.log(`🔍 Debug: Session exists:`, !!sessions[sessionId]);
      console.log(
        `🔍 Debug: All session statuses:`,
        Object.keys(sessions).map((id) => ({
          id,
          status: sessions[id]?.status,
        }))
      );

      // More lenient connection check - allow processing if socket exists
      if (
        !sessions[sessionId] ||
        (!sessions[sessionId].sock &&
          sessions[sessionId].status !== "connected")
      ) {
        console.log(
          `🚫 Session ${sessionId} not ready, ignoring messages. Status: ${
            sessions[sessionId]?.status
          }, Socket: ${!!sessions[sessionId]?.sock}`
        );
        return;
      }

      if (!m.messages) return;
      const msg = m.messages[0];

      // Skip if message is from bot itself
      if (msg.key.fromMe) return;

      // Enhanced decryption error handling
      if (msg.message === undefined) {
        console.log(
          `🔒 Message from ${msg.key.remoteJid} is encrypted, attempting to decrypt...`
        );

        // Check if message is from group - block group messages
        if (msg.key.remoteJid.includes("@g.us")) {
          console.log(
            `🚫 Blocking group message from ${msg.key.remoteJid} - Bot only replies to personal chats`
          );
          return; // Skip processing group messages
        }

        // Send immediate response to show bot is working
        try {
          const session = sessions[sessionId];
          if (session && session.sock) {
            // Send immediate response first (more reliable)
            await session.sock.sendMessage(msg.key.remoteJid, {
              text: "🤖 Bot menerima pesan Anda. Sedang memproses...",
            });
            console.log(`📤 Sent immediate response to ${msg.key.remoteJid}`);

            // Send acknowledgment immediately after response
            try {
              if (msg.key && msg.key.id && msg.key.remoteJid) {
                await session.sock.sendMessageAck(msg.key, "read");
                console.log(
                  `✅ Immediate acknowledgment sent for ${msg.key.remoteJid}`
                );
              }
            } catch (ackError) {
              console.log(
                `⚠️ Immediate acknowledgment failed:`,
                ackError.message
              );
            }
          }
        } catch (responseError) {
          console.log(
            `⚠️ Failed to send immediate response to ${msg.key.remoteJid}:`,
            responseError.message
          );
        }

        // Track decryption attempts per contact
        const contactJid = msg.key.remoteJid;
        if (!sessions[sessionId].decryptionAttempts) {
          sessions[sessionId].decryptionAttempts = new Map();
        }

        const attempts =
          sessions[sessionId].decryptionAttempts.get(contactJid) || 0;

        // Limit decryption attempts to prevent infinite loops
        if (attempts >= 3) {
          console.log(
            `🚫 Max decryption attempts reached for ${contactJid}, skipping message`
          );

          // Send final response to user
          try {
            const session = sessions[sessionId];
            if (session && session.sock) {
              await session.sock.sendMessage(contactJid, {
                text: "🚫 Pesan tidak dapat diproses setelah 3 percobaan. Coba kirim ulang atau ketik 'menu'",
              });
              console.log(`📤 Sent max attempts response to ${contactJid}`);
            }
          } catch (finalError) {
            console.log(
              `⚠️ Failed to send max attempts response to ${contactJid}:`,
              finalError.message
            );
          }
          return;
        }

        // Try to decrypt the message with retry logic
        try {
          const decryptedMessage = await sock.decryptMessage(msg);
          if (decryptedMessage) {
            console.log(`✅ Message decrypted successfully from ${contactJid}`);
            // Reset attempts counter on success
            sessions[sessionId].decryptionAttempts.delete(contactJid);
            // Process the decrypted message
            msg.message = decryptedMessage;
          } else {
            console.log(
              `⚠️ Failed to decrypt message from ${contactJid}, skipping...`
            );

            // Send response to user about decryption failure
            try {
              const session = sessions[sessionId];
              if (session && session.sock) {
                await session.sock.sendMessage(contactJid, {
                  text: "🔒 Pesan tidak dapat diproses. Coba kirim ulang atau ketik 'menu'",
                });
                console.log(
                  `📤 Sent decryption failure response to ${contactJid}`
                );
              }
            } catch (fallbackError) {
              console.log(
                `⚠️ Failed to send decryption failure response to ${contactJid}:`,
                fallbackError.message
              );
            }
            return;
          }
        } catch (decryptError) {
          console.log(
            `❌ Decryption failed for message from ${contactJid} (attempt ${
              attempts + 1
            }/3):`,
            decryptError.message
          );

          // Increment attempts counter and track timestamp
          sessions[sessionId].decryptionAttempts.set(contactJid, attempts + 1);
          if (!sessions[sessionId].lastDecryptionAttempt) {
            sessions[sessionId].lastDecryptionAttempt = {};
          }
          sessions[sessionId].lastDecryptionAttempt[contactJid] = Date.now();

          // Send response to user about decryption error
          try {
            const session = sessions[sessionId];
            if (session && session.sock) {
              await session.sock.sendMessage(contactJid, {
                text: "🔐 Masalah dekripsi pesan. Coba kirim ulang atau ketik 'menu'",
              });
              console.log(`📤 Sent decryption error response to ${contactJid}`);
            }
          } catch (notifyError) {
            console.log(
              `⚠️ Failed to send decryption error response to ${contactJid}:`,
              notifyError.message
            );
          }

          // Handle specific decryption errors with enhanced recovery
          if (
            decryptError.message.includes("PreKeyError") ||
            decryptError.message.includes("Invalid PreKey ID") ||
            decryptError.message.includes("No session found") ||
            decryptError.message.includes("Bad MAC")
          ) {
            console.log(
              `🔄 PreKey/Session/Bad MAC error detected for ${contactJid}, attempting recovery...`
            );

            // Special handling for Bad MAC error
            if (decryptError.message.includes("Bad MAC")) {
              console.log(
                `🔐 Bad MAC detected - clearing corrupted session data for ${contactJid}`
              );

              // Force clear session data for this specific contact
              try {
                if (session.sock.clearSessionData) {
                  await session.sock.clearSessionData(contactJid);
                  console.log(
                    `✅ Session data forcefully cleared for ${contactJid}`
                  );
                }

                // Clear from local session tracking
                if (session.decryptionAttempts) {
                  session.decryptionAttempts.delete(contactJid);
                }

                // Wait longer for Bad MAC recovery
                await new Promise((resolve) => setTimeout(resolve, 3000));
              } catch (clearError) {
                console.log(
                  `⚠️ Failed to clear session data for Bad MAC:`,
                  clearError.message
                );
              }
            }

            // Enhanced cleanup with better error handling
            try {
              await cleanupProblematicSession(sessionId, contactJid);

              // Wait a bit before next attempt
              await new Promise((resolve) => setTimeout(resolve, 2000));

              // Try to request new prekeys
              try {
                await sock.requestPreKeyBundle(contactJid);
                console.log(`✅ PreKey bundle requested for ${contactJid}`);
              } catch (prekeyError) {
                console.log(
                  `⚠️ Failed to request PreKey bundle for ${contactJid}:`,
                  prekeyError.message
                );
              }
            } catch (cleanupError) {
              console.log(
                `❌ Cleanup failed for ${contactJid}:`,
                cleanupError.message
              );
            }
          }

          // If this was the last attempt, log it and clear the counter
          if (attempts + 1 >= 3) {
            console.log(
              `🚫 Giving up on decryption for ${contactJid} after 3 attempts`
            );
            sessions[sessionId].decryptionAttempts.delete(contactJid);
          }

          return;
        }
      }

      // Handle different message types
      let messageText = "";
      let isTextMessage = false;

      if (msg.message?.conversation) {
        messageText = msg.message.conversation;
        isTextMessage = true;
      } else if (msg.message?.extendedTextMessage?.text) {
        messageText = msg.message.extendedTextMessage.text;
        isTextMessage = true;
      }

      if (isTextMessage && messageText.trim()) {
        try {
          const from = msg.key.remoteJid;

          // Check if message is from group - block group messages
          if (from.includes("@g.us")) {
            console.log(
              `🚫 Blocking group message from ${from} - Bot only replies to personal chats`
            );
            return; // Skip processing group messages
          }

          // Send immediate response to show bot is working
          try {
            const session = sessions[sessionId];
            if (session && session.sock) {
              // Send immediate response first (more reliable)
              const immediateResult = await session.sock.sendMessage(from, {
                text: "🤖 Bot menerima pesan Anda. Sedang memproses...",
              });
              console.log(`📤 Sent immediate response to ${from}`);
              console.log(`📤 Immediate response result:`, immediateResult);

              // Send acknowledgment immediately after response
              try {
                if (msg.key && msg.key.id && msg.key.remoteJid) {
                  await session.sock.sendMessageAck(msg.key, "read");
                  console.log(`✅ Immediate acknowledgment sent for ${from}`);
                }
              } catch (ackError) {
                console.log(
                  `⚠️ Immediate acknowledgment failed:`,
                  ackError.message
                );
              }
            }
          } catch (responseError) {
            console.log(
              `⚠️ Failed to send immediate response:`,
              responseError.message
            );
          }

          // Check if auto-reply is enabled for this session
          const settings = botSettings[sessionId];
          console.log(`🤖 Checking bot settings for ${sessionId}:`, settings);
          console.log(`🤖 Bot enabled status:`, settings?.enabled);
          console.log(`🤖 Bot type:`, settings?.botType);
          console.log(`🤖 Available sessions:`, Object.keys(sessions));
          console.log(`🤖 Available bot settings:`, Object.keys(botSettings));

          // Initialize bot settings if not exists
          if (!settings) {
            console.log(
              `🤖 No bot settings found for ${sessionId}, initializing...`
            );
            const defaultConfig = defaultBotConfigs.menu_bot;
            botSettings[sessionId] = {
              enabled: true,
              botType: "menu_bot",
              config: { ...defaultConfig },
              responses: { ...defaultConfig.responses },
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            console.log(
              `🤖 Initialized bot settings for ${sessionId}:`,
              botSettings[sessionId]
            );
          }

          // Get updated settings after initialization
          const currentSettings = botSettings[sessionId];
          if (!currentSettings || !currentSettings.enabled) {
            console.log(`🚫 Auto-reply disabled for session ${sessionId}`);
            return;
          }

          // Block group messages - bot should only reply to personal chats
          if (from.includes("@g.us")) {
            console.log(
              `🚫 Auto-reply blocked for ${sessionId} - message from group: ${from} - Bot only replies to personal chats`
            );
            return; // Skip auto-reply for group messages
          }

          console.log(
            `✅ Auto-reply enabled for session ${sessionId}, proceeding...`
          );

          // Rate limiting: prevent spam
          const now = Date.now();
          const lastReplyTime = sessions[sessionId].lastReplyTime || 0;
          const timeDiff = now - lastReplyTime;

          if (timeDiff < 2000) {
            // 2 seconds cooldown
            console.log(`🚫 Rate limit: Too soon to reply for ${sessionId}`);
            return;
          }

          console.log(
            `🤖 Processing message for ${sessionId} from personal chat ${from}: "${messageText}"`
          );
          console.log(`🤖 Bot settings for ${sessionId}:`, currentSettings);

          // Process message through bot handler with session-specific settings
          await processMessageWithBot(
            sessionId,
            from,
            messageText,
            currentSettings
          );

          // Update last reply time for rate limiting
          sessions[sessionId].lastReplyTime = now;
        } catch (err) {
          console.error(`❌ Bot processing failed for ${sessionId}:`, err);

          // If it's a connection error, mark session as disconnected
          if (
            err.message.includes("connection") ||
            err.message.includes("socket")
          ) {
            console.log(
              `🔌 Connection error detected for ${sessionId}, marking as disconnected`
            );
            sessions[sessionId].status = "disconnected";
          }
        }
      }
    });

    // Handle errors
    sock.ev.on("connection.error", (err) => {
      console.error(`❌ Connection error for ${sessionId}:`, err);
      sessions[sessionId].status = "error";
    });

    // Handle message decryption errors with enhanced recovery
    sock.ev.on("messages.update", async (update) => {
      if (update.status === "error" && update.error) {
        const errorMsg = update.error.message || update.error.toString();
        console.log(`🔒 Message decryption error for ${sessionId}:`, errorMsg);

        // Handle PreKey errors with enhanced recovery
        if (
          errorMsg.includes("PreKeyError") ||
          errorMsg.includes("Invalid PreKey ID") ||
          errorMsg.includes("No session found")
        ) {
          console.log(
            `🔄 Attempting to resolve PreKey issue for ${sessionId}...`
          );

          // Use the cleanup function to handle problematic sessions
          if (update.key?.remoteJid) {
            try {
              await cleanupProblematicSession(sessionId, update.key.remoteJid);

              // Additional recovery: try to refresh the entire session if needed
              const session = sessions[sessionId];
              if (session && session.sock) {
                try {
                  // Force a session refresh
                  await session.sock.refreshSession?.();
                  console.log(`✅ Session refreshed for ${sessionId}`);
                } catch (refreshError) {
                  console.log(
                    `⚠️ Session refresh failed for ${sessionId}:`,
                    refreshError.message
                  );
                }
              }
            } catch (recoveryError) {
              console.log(
                `❌ Recovery failed for ${sessionId}:`,
                recoveryError.message
              );
            }
          }
        }
      }
    });

    // Enhanced heartbeat mechanism with better error handling
    const heartbeatInterval = setInterval(async () => {
      if (
        sessions[sessionId] &&
        sessions[sessionId].status === "connected" &&
        sock &&
        !sessions[sessionId].deleted
      ) {
        try {
          // Multiple keep-alive strategies
          await Promise.allSettled([
            // Send presence update
            sock.sendPresenceUpdate("available"),
            // Subscribe to presence
            sock.presenceSubscribe(sessionId + "@s.whatsapp.net"),
            // Send typing indicator to keep connection active
            sock.sendPresenceUpdate("composing"),
          ]);

          // Reset heartbeat failures on success
          sessions[sessionId].heartbeatFailures = 0;
          sessions[sessionId].lastHeartbeat = Date.now();

          console.log(`💓 Enhanced heartbeat sent for ${sessionId}`);
        } catch (err) {
          console.log(`💓 Heartbeat failed for ${sessionId}:`, err.message);

          // Increment heartbeat failures
          sessions[sessionId].heartbeatFailures =
            (sessions[sessionId].heartbeatFailures || 0) + 1;

          // If heartbeat fails multiple times, attempt reconnection
          if (sessions[sessionId].heartbeatFailures >= 5) {
            console.log(
              `💔 Multiple heartbeat failures for ${sessionId}, attempting reconnection`
            );
            sessions[sessionId].status = "disconnected";
            sessions[sessionId].heartbeatFailures = 0;

            // Trigger reconnection
            if (!sessions[sessionId].reconnecting) {
              sessions[sessionId].reconnecting = true;
              setTimeout(() => {
                if (sessions[sessionId] && !sessions[sessionId].deleted) {
                  initSession(sessionId).catch((err) => {
                    console.error(
                      `❌ Heartbeat-triggered reconnection failed for ${sessionId}:`,
                      err
                    );
                    sessions[sessionId].reconnecting = false;
                  });
                }
              }, 5000);
            }

            clearInterval(heartbeatInterval);
          }
        }
      } else {
        clearInterval(heartbeatInterval);
      }
    }, 20000); // Every 20 seconds (less aggressive)
  } catch (err) {
    console.error(`❌ Failed to initialize session ${sessionId}:`, err);
    sessions[sessionId].status = "error";
  }
}

// --- Init all existing sessions on server start ---
for (const sessionId of Object.keys(sessions)) {
  initSession(sessionId);
}

// --- Routes ---
// Root redirect to dashboard
// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    pid: process.pid,
    port: PORT,
    host: HOST,
  });
});

// Root redirect to dashboard (with auth)
app.get("/", requireAuth, (req, res) => {
  res.redirect("/dashboard");
});

// Dashboard route (with auth)
app.get("/dashboard", requireAuth, (req, res) => {
  const sessArray = Object.keys(sessions).map((id) => ({
    id,
    status: sessions[id].status,
    groups: sessions[id].groups || [],
  }));

  const username = req.cookies?.username || "Admin";

  res.render("dashboard", {
    sessions: sessArray,
    username: username,
  });
});

// Route: Tables page
app.get("/tables", requireAuth, (req, res) => {
  const username = req.cookies?.username || "Admin";
  res.render("tables", { username });
});

// Session detail page (with auth)
app.get("/session/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  console.log(`📋 Rendering session page for: ${id}`);

  // Get session from database
  const dbSession = dbHandler.getSession(id);
  if (!dbSession) {
    console.log(`📋 Session ${id} not found in database`);
    return res.status(404).send("Session not found in database");
  }

  console.log(`📋 Database session data:`, dbSession);
  console.log(`📋 Current menu ID from database:`, dbSession.current_menu_id);
  console.log(`📋 Current menu ID type:`, typeof dbSession.current_menu_id);
  console.log(
    `📋 Current menu ID is null:`,
    dbSession.current_menu_id === null
  );
  console.log(
    `📋 Current menu ID is undefined:`,
    dbSession.current_menu_id === undefined
  );

  // Get session from memory (for groups and status)
  const s = sessions[id];
  console.log(`📋 Memory session for ${id}:`, s);
  console.log(`📋 Groups in memory:`, s ? s.groups : "No session in memory");

  // Ensure session exists in memory
  if (!s) {
    console.log(`📋 Session ${id} not in memory, creating...`);
    sessions[id] = {
      sock: null,
      status: "disconnected",
      qr: null,
      groups: [],
    };
  }

  // Get groups - only show groups if session is connected and has groups
  let groups = [];
  const sessionStatus = sessions[id] ? sessions[id].status : "disconnected";
  console.log(`📋 Session ${id} status:`, sessionStatus);

  if (sessionStatus === "connected" && sessions[id] && sessions[id].groups) {
    groups = sessions[id].groups;
    console.log(`📋 Groups for connected session ${id}:`, groups);
    console.log(`📋 Groups length:`, groups.length);
    console.log(`📋 Groups type:`, typeof groups);

    // Validate groups data
    if (!Array.isArray(groups)) {
      console.warn(
        `📋 Groups is not an array for session ${id}, setting to empty array`
      );
      groups = [];
    }

    if (groups.length === 0) {
      console.log(`📋 Session ${id} is connected but has no WhatsApp groups`);
    }
  } else {
    console.log(`📋 Session ${id} is not connected or no groups available`);
    groups = []; // Empty groups for disconnected sessions
  }

  // Get menus from database for dropdown
  let menus = [];
  try {
    menus = await dbHandler.getAllMenus();
    console.log(`📋 Menus for session ${id}:`, menus);
    console.log(`📋 Menus count:`, menus.length);
  } catch (error) {
    console.error(`❌ Error getting menus for session ${id}:`, error.message);
    menus = [];
  }

  const detail = {
    id,
    status: sessions[id] ? sessions[id].status : "disconnected",
    groups: groups,
    hasSock: sessions[id] ? !!sessions[id].sock : false,
    // Add database fields
    current_menu_id: dbSession.current_menu_id,
    session_name: dbSession.session_name,
    phone_number: dbSession.phone_number,
    bot_enabled: dbSession.bot_enabled,
    auto_reply_enabled: dbSession.auto_reply_enabled,
    group_reply_enabled: dbSession.group_reply_enabled,
    // Add menus for dropdown
    menus: menus,
  };

  console.log(`📋 Final session detail:`, detail);
  console.log(`📋 Menus data being sent to template:`, detail.menus);
  console.log(
    `📋 Current menu ID being sent to template:`,
    detail.current_menu_id
  );

  const username = req.cookies?.username || "Admin";

  res.render("session", {
    session: detail,
    username: username,
  });
});

// API: Connect
app.post("/api/connect", async (req, res) => {
  const { sessionId } = req.body;
  console.log(`📱 Connect request for session: ${sessionId}`);

  if (!sessionId) {
    console.log(`❌ No sessionId provided`);
    return res.json({ error: "No sessionId provided" });
  }

  if (!sessions[sessionId]) {
    console.log(`📝 Creating new session: ${sessionId}`);
    sessions[sessionId] = {
      sock: null,
      status: "disconnected",
      qr: null,
      groups: [],
      reconnecting: false,
      reconnectAttempts: 0,
    };

    // Save session to database
    await saveSessionToDatabase(sessionId, sessions[sessionId]);

    // Initialize bot settings for new session
    if (!botSettings[sessionId]) {
      botSettings[sessionId] = {
        enabled: true,
        responses: {
          defaultResponse:
            "🤖 Halo! Terima kasih sudah menghubungi saya. Bot sedang aktif.",
          greetingResponse: "👋 Halo! Ada yang bisa saya bantu?",
          infoResponse:
            "ℹ️ Ini adalah WhatsApp Bot yang sedang aktif. Silakan kirim pesan untuk berinteraksi.",
        },
      };
      console.log(`🤖 Initialized bot settings for new session ${sessionId}`);
    }
  } else {
    console.log(
      `🔄 Reusing existing session: ${sessionId}, current status: ${sessions[sessionId].status}`
    );
  }

  try {
    // Reset session status
    sessions[sessionId].status = "connecting";
    sessions[sessionId].qr = null;

    console.log(`🚀 Starting initSession for ${sessionId}`);

    // Initialize session (this is async but we don't wait for QR generation)
    initSession(sessionId).catch((err) => {
      console.error(`❌ Session init error for ${sessionId}:`, err);
      sessions[sessionId].status = "error";
    });

    // Return immediately with current status
    const response = {
      success: true,
      status: sessions[sessionId].status,
      message: "Connection initiated successfully",
    };

    console.log(`✅ Connect response for ${sessionId}:`, response);
    res.json(response);
  } catch (err) {
    console.error(`❌ Connect error for ${sessionId}:`, err);
    res.json({ error: err.message });
  }
});

// API: Disconnect
app.post("/api/disconnect", async (req, res) => {
  const { sessionId } = req.body;
  if (!sessions[sessionId]) return res.json({ error: "Session not found" });

  try {
    await sessions[sessionId].sock.logout();
    sessions[sessionId].status = "disconnected";
    res.json({ success: true });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// API: Disconnect and Delete Session Data
app.post("/api/disconnectAndDelete", async (req, res) => {
  const { sessionId } = req.body;
  if (!sessions[sessionId]) return res.json({ error: "Session not found" });

  try {
    // Mark as deleted to stop event handlers
    sessions[sessionId].deleted = true;

    // Remove listeners and logout safely
    if (sessions[sessionId].sock) {
      try {
        sessions[sessionId].sock.ev.removeAllListeners?.();
      } catch {}
      try {
        await sessions[sessionId].sock.logout();
      } catch {}
    }

    // Delete auth folder
    const authFolder = `auth_info_${sessionId}`;
    if (fs.existsSync(authFolder)) {
      fs.rmSync(authFolder, { recursive: true, force: true });
      console.log(`🗑️ Deleted auth folder: ${authFolder}`);
    }

    // Remove from sessions object
    delete sessions[sessionId];

    res.json({
      success: true,
      message: "Session disconnected and data deleted",
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// API: Reset Session (force cleanup)
app.post("/api/resetSession", async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.json({ error: "No sessionId provided" });

  try {
    console.log(`🧹 Force resetting session: ${sessionId}`);

    // Stop any ongoing reconnection attempts
    if (sessions[sessionId]) {
      sessions[sessionId].deleted = true;
      sessions[sessionId].reconnecting = false;
      sessions[sessionId].reconnectAttempts = 0;

      // Disconnect if connected
      if (sessions[sessionId].sock) {
        try {
          sessions[sessionId].sock.ev.removeAllListeners?.();
          await sessions[sessionId].sock.logout();
        } catch (err) {
          console.log(`⚠️ Logout failed for ${sessionId}:`, err.message);
        }
      }
    }

    // Delete auth folder
    const authPath = `auth_info_${sessionId}`;
    if (fs.existsSync(authPath)) {
      fs.rmSync(authPath, { recursive: true, force: true });
      console.log(`🗑️ Deleted auth folder for ${sessionId}`);
    }

    // Remove from sessions
    delete sessions[sessionId];

    // Recreate session with clean state
    sessions[sessionId] = {
      sock: null,
      status: "disconnected",
      qr: null,
      groups: [],
      reconnecting: false,
      reconnectAttempts: 0,
    };

    res.json({
      success: true,
      message: "Session reset successfully",
    });
  } catch (err) {
    console.error(`❌ Reset session error for ${sessionId}:`, err);
    res.json({ error: err.message });
  }
});

// API: Clean up problematic contact session
app.post("/api/cleanupContact", async (req, res) => {
  const { sessionId, contactJid } = req.body;

  if (!sessionId || !contactJid) {
    return res.json({ error: "Missing sessionId or contactJid" });
  }

  try {
    console.log(
      `🧹 Cleaning up contact session: ${contactJid} in ${sessionId}`
    );

    await cleanupProblematicSession(sessionId, contactJid);

    res.json({
      success: true,
      message: `Contact session cleaned up for ${contactJid}`,
    });
  } catch (err) {
    console.error(`❌ Cleanup contact error:`, err);
    res.json({ error: err.message });
  }
});

// API: Send message (personal / group)
app.post("/api/sendMessage", async (req, res) => {
  const { sessionId, to, message, isGroup } = req.body;

  console.log(`📤 SendMessage API called:`, {
    sessionId,
    to,
    message,
    isGroup,
  });

  if (!sessionId || !to || !message) {
    console.log(`❌ Missing parameters:`, { sessionId, to, message });
    return res.json({ error: "Missing required parameters" });
  }

  if (!sessions[sessionId] || sessions[sessionId].status !== "connected") {
    console.log(`❌ Session not connected:`, {
      sessionId,
      exists: !!sessions[sessionId],
      status: sessions[sessionId]?.status,
    });
    return res.json({ error: "Session not connected" });
  }

  try {
    const jid = isGroup ? to : to + "@s.whatsapp.net";
    console.log(`📱 Sending message to JID: ${jid} (isGroup: ${isGroup})`);

    // Retry mechanism for sending messages
    let retries = 3;
    let lastError;

    while (retries > 0) {
      try {
        console.log(
          `🔄 Attempting to send message (attempt ${4 - retries}/3) to ${jid}`
        );
        await sessions[sessionId].sock.sendMessage(jid, { text: message });
        console.log(`✅ Message sent successfully to ${jid} via ${sessionId}`);
        return res.json({ success: true });
      } catch (err) {
        lastError = err;
        retries--;
        console.log(`⚠️ Send message failed (${3 - retries}/3):`, err.message);
        console.log(`🔍 Error details:`, err);

        if (retries > 0) {
          // Wait 1 second before retry
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }

    // If all retries failed
    console.error(
      `❌ Failed to send message after 3 attempts:`,
      lastError.message
    );
    res.json({ error: `Failed to send message: ${lastError.message}` });
  } catch (err) {
    console.error(`❌ Send message error:`, err);
    res.json({ error: err.message });
  }
});

// API: Bot health check
app.get("/api/botHealth/:sessionId", (req, res) => {
  const { sessionId } = req.params;

  if (!sessionId) {
    return res.json({ error: "No sessionId provided" });
  }

  const session = sessions[sessionId];
  if (!session) {
    return res.json({
      error: "Session not found",
      health: "unhealthy",
    });
  }

  const health = {
    sessionId: sessionId,
    status: session.status,
    connected: session.status === "connected",
    lastReplyTime: session.lastReplyTime || null,
    reconnectAttempts: session.reconnectAttempts || 0,
    reconnecting: session.reconnecting || false,
    botEnabled: botSettings[sessionId]?.enabled || false,
    timestamp: new Date().toISOString(),
  };

  res.json({
    health: health,
    healthy: session.status === "connected" && !session.reconnecting,
  });
});

// API: getSessions
app.get("/api/getSessions", (req, res) => {
  const sessArray = Object.keys(sessions).map((id) => ({
    id,
    status: sessions[id].status,
    groups: sessions[id].groups,
  }));
  res.json({ sessions: sessArray });
});

// API: Test bot settings
app.get("/api/testBotSettings/:sessionId", (req, res) => {
  const { sessionId } = req.params;

  console.log(`🧪 Testing bot settings for ${sessionId}`);

  const session = sessions[sessionId];
  const settings = botSettings[sessionId];

  res.json({
    sessionId: sessionId,
    sessionExists: !!session,
    sessionStatus: session?.status,
    botSettingsExists: !!settings,
    botEnabled: settings?.enabled,
    botResponses: settings?.responses,
    allBotSettings: botSettings,
    timestamp: new Date().toISOString(),
  });
});

// API: Save bot settings
app.post("/api/botSettings", (req, res) => {
  console.log(`🤖 Bot settings POST request received`);
  console.log(`🤖 Request body:`, req.body);
  console.log(`🤖 Request headers:`, req.headers);

  const { sessionId, enabled, responses, config, botType } = req.body;

  console.log(`🤖 Bot settings API called for ${sessionId}:`, {
    enabled,
    responses,
    config,
    botType,
  });

  if (!sessionId) {
    console.log("❌ No sessionId provided");
    return res.json({ error: "No sessionId provided" });
  }

  // Initialize bot settings for session if not exists
  if (!botSettings[sessionId]) {
    // Use default config based on botType or general
    const defaultConfig =
      defaultBotConfigs[botType] || defaultBotConfigs.menu_bot;
    botSettings[sessionId] = {
      enabled: true,
      botType: botType || "general",
      config: { ...defaultConfig },
      responses: { ...defaultConfig.responses },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    console.log(
      `🤖 Initialized bot settings for ${sessionId} with type: ${
        botType || "general"
      }`
    );
  }

  // Update settings
  if (enabled !== undefined) {
    botSettings[sessionId].enabled = enabled;
    console.log(`🤖 Updated enabled status for ${sessionId}: ${enabled}`);
  }

  if (botType && botType !== botSettings[sessionId].botType) {
    // Change bot type - apply new default config
    const newConfig = defaultBotConfigs[botType] || defaultBotConfigs.general;
    botSettings[sessionId].botType = botType;
    botSettings[sessionId].config = { ...newConfig };
    botSettings[sessionId].responses = { ...newConfig.responses };
    console.log(`🤖 Changed bot type for ${sessionId} to: ${botType}`);
  }

  if (responses) {
    botSettings[sessionId].responses = {
      ...botSettings[sessionId].responses,
      ...responses,
    };
    console.log(`🤖 Updated responses for ${sessionId}:`, responses);
  }

  if (config) {
    botSettings[sessionId].config = {
      ...botSettings[sessionId].config,
      ...config,
    };
    console.log(`🤖 Updated config for ${sessionId}:`, config);
  }

  // Update timestamp
  botSettings[sessionId].updatedAt = new Date().toISOString();

  console.log(
    `🤖 Bot settings updated for ${sessionId}:`,
    botSettings[sessionId]
  );

  res.json({
    success: true,
    settings: botSettings[sessionId],
  });
});

// API: Get bot settings
app.get("/api/botSettings/:sessionId", (req, res) => {
  const { sessionId } = req.params;

  console.log(`🤖 Getting bot settings for ${sessionId}`);

  if (!sessionId) {
    console.log("❌ No sessionId provided");
    return res.json({ error: "No sessionId provided" });
  }

  // Return default settings if not exists
  if (!botSettings[sessionId]) {
    const defaultConfig = defaultBotConfigs.menu_bot;
    botSettings[sessionId] = {
      enabled: true,
      botType: "menu_bot",
      config: { ...defaultConfig },
      responses: { ...defaultConfig.responses },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    console.log(`🤖 Created default bot settings for ${sessionId}`);
  }

  const settings = botSettings[sessionId];

  console.log(`🤖 Returning bot settings for ${sessionId}:`, settings);

  res.json({ settings });
});

// API: Get available bot types
app.get("/api/botTypes", (req, res) => {
  console.log(`🤖 Getting available bot types`);

  const botTypes = Object.keys(defaultBotConfigs).map((type) => ({
    type,
    name: defaultBotConfigs[type].name,
    personality: defaultBotConfigs[type].personality,
    features: defaultBotConfigs[type].features,
  }));

  res.json({
    success: true,
    botTypes,
    count: botTypes.length,
  });
});

// API: Get bot configuration template
app.get("/api/botConfig/:botType", (req, res) => {
  const { botType } = req.params;

  console.log(`🤖 Getting bot config template for: ${botType}`);

  if (!defaultBotConfigs[botType]) {
    return res.json({
      error: "Bot type not found",
      availableTypes: Object.keys(defaultBotConfigs),
    });
  }

  res.json({
    success: true,
    config: defaultBotConfigs[botType],
  });
});

// API: Reset bot settings to default
app.post("/api/botSettings/:sessionId/reset", (req, res) => {
  const { sessionId } = req.params;
  const { botType = "general" } = req.body;

  console.log(`🤖 Resetting bot settings for ${sessionId} to type: ${botType}`);

  if (!sessionId) {
    return res.json({ error: "No sessionId provided" });
  }

  const defaultConfig = defaultBotConfigs[botType] || defaultBotConfigs.general;

  botSettings[sessionId] = {
    enabled: true,
    botType: botType,
    config: { ...defaultConfig },
    responses: { ...defaultConfig.responses },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  console.log(`🤖 Bot settings reset for ${sessionId}`);

  res.json({
    success: true,
    settings: botSettings[sessionId],
    message: `Bot settings reset to ${botType} type`,
  });
});

// API: Clear problematic session data
app.post("/api/session/:sessionId/clearData", async (req, res) => {
  const { sessionId } = req.params;
  const { contactJid } = req.body;

  console.log(`🧹 Clearing session data for ${contactJid} in ${sessionId}`);

  if (!sessionId) {
    return res.json({ error: "No sessionId provided" });
  }

  if (!contactJid) {
    return res.json({ error: "No contactJid provided" });
  }

  try {
    const success = await clearProblematicSessionData(sessionId, contactJid);

    if (success) {
      res.json({
        success: true,
        message: `Session data cleared for ${contactJid}`,
        contactJid: contactJid,
      });
    } else {
      res.json({
        success: false,
        error: "Failed to clear session data",
      });
    }
  } catch (error) {
    console.error(`❌ Error clearing session data:`, error);
    res.json({
      success: false,
      error: error.message,
    });
  }
});

// API: Get QR Code
app.get("/api/getQR/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  console.log(`📱 Getting QR for session: ${sessionId}`);
  console.log(`📊 Available sessions:`, Object.keys(sessions));

  if (!sessions[sessionId]) {
    console.log(`❌ Session ${sessionId} not found`);
    return res.json({ error: "Session not found" });
  }

  const sessionData = sessions[sessionId];
  console.log(`📊 Session ${sessionId} data:`, {
    status: sessionData.status,
    hasQR: !!sessionData.qr,
    hasSock: !!sessionData.sock,
  });

  res.json({
    qr: sessionData.qr,
    status: sessionData.status,
    hasQR: !!sessionData.qr,
    hasSock: !!sessionData.sock,
  });
});

// API: Bot Control
app.post("/api/botControl", (req, res) => {
  const { action, sessionId } = req.body;

  if (action === "enable") {
    if (sessionId) {
      // Enable bot for specific session
      if (!botSettings[sessionId]) {
        botSettings[sessionId] = {
          enabled: true,
          responses: {
            defaultResponse:
              "🤖 Halo! Terima kasih sudah menghubungi saya. Bot sedang aktif.",
            greetingResponse: "👋 Halo! Ada yang bisa saya bantu?",
            infoResponse:
              "ℹ️ Ini adalah WhatsApp Bot yang sedang aktif. Silakan kirim pesan untuk berinteraksi.",
          },
        };
      } else {
        botSettings[sessionId].enabled = true;
      }
      res.json({
        success: true,
        message: `Bot enabled for session ${sessionId}`,
      });
    } else {
      // Enable bot globally
      botHandler.setBotEnabled(true);
      res.json({ success: true, message: "Bot enabled globally" });
    }
  } else if (action === "disable") {
    if (sessionId) {
      // Disable bot for specific session
      if (botSettings[sessionId]) {
        botSettings[sessionId].enabled = false;
      }
      res.json({
        success: true,
        message: `Bot disabled for session ${sessionId}`,
      });
    } else {
      // Disable bot globally
      botHandler.setBotEnabled(false);
      res.json({ success: true, message: "Bot disabled globally" });
    }
  } else {
    res.json({ success: false, message: "Invalid action" });
  }
});

// API: Get Bot Stats
app.get("/api/botStats", (req, res) => {
  const stats = botHandler.getBotStats();
  res.json({ success: true, stats });
});

// API: Get Bot Status for Session
app.get("/api/botStatus/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const settings = botSettings[sessionId];

  res.json({
    success: true,
    sessionId: sessionId,
    enabled: settings?.enabled || false,
    settings: settings || null,
  });
});

// ===== USER MANAGEMENT API ENDPOINTS =====

// API: Get all users
app.get("/api/users", async (req, res) => {
  try {
    const dbHandler = new SQLiteDatabaseHandler();
    const connected = await dbHandler.connect();

    if (!connected) {
      return res
        .status(500)
        .json({ error: "SQLite database connection failed" });
    }

    // Get users from SQLite database
    const users = dbHandler.db
      .prepare(
        `
      SELECT * FROM tb_users 
      ORDER BY created_at DESC
    `
      )
      .all();

    res.json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// API: Create new user
app.post("/api/users", async (req, res) => {
  try {
    const { username, password, email, full_name, role = "user" } = req.body;

    if (!username || !password) {
      return res
        .status(400)
        .json({ error: "Username and password are required" });
    }

    const dbHandler = new SQLiteDatabaseHandler();
    await dbHandler.connect();

    // Check if username already exists
    const existingUser = dbHandler.db
      .prepare(
        `
      SELECT COUNT(*) as count FROM tb_users WHERE username = ?
    `
      )
      .get(username);

    if (existingUser.count > 0) {
      return res.status(400).json({ error: "Username already exists" });
    }

    // Hash password
    const bcrypt = await import("bcrypt");
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user in SQLite
    const result = dbHandler.db
      .prepare(
        `
      INSERT INTO tb_users (username, password, email, full_name, role, is_active, created_at, updated_at, last_login) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        username,
        hashedPassword,
        email || null,
        full_name || null,
        role,
        1,
        new Date().toISOString(),
        new Date().toISOString(),
        null
      );

    res.json({
      success: true,
      id: result.lastInsertRowid,
      message: "User created successfully",
    });
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).json({ error: "Failed to create user" });
  }
});

// API: Update user
app.put("/api/users/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { username, email, full_name, role, is_active } = req.body;

    if (!username) {
      return res.status(400).json({ error: "Username is required" });
    }

    const dbHandler = new SQLiteDatabaseHandler();
    await dbHandler.connect();

    // Find user by ID
    const user = dbHandler.db
      .prepare(
        `
      SELECT * FROM tb_users WHERE id = ?
    `
      )
      .get(parseInt(id));

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Check if username already exists (excluding current user)
    const existingUser = dbHandler.db
      .prepare(
        `
      SELECT COUNT(*) as count FROM tb_users WHERE username = ? AND id != ?
    `
      )
      .get(username, parseInt(id));

    if (existingUser.count > 0) {
      return res.status(400).json({ error: "Username already exists" });
    }

    // Update user in SQLite
    const result = dbHandler.db
      .prepare(
        `
      UPDATE tb_users 
      SET username = ?, email = ?, full_name = ?, role = ?, is_active = ?, updated_at = ?
      WHERE id = ?
    `
      )
      .run(
        username,
        email || null,
        full_name || null,
        role || "user",
        is_active ? 1 : 0,
        new Date().toISOString(),
        parseInt(id)
      );

    res.json({
      success: true,
      message: "User updated successfully",
    });
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ error: "Failed to update user" });
  }
});

// API: Change user password
app.put("/api/users/:id/password", async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ error: "Password is required" });
    }

    const dbHandler = new SQLiteDatabaseHandler();
    await dbHandler.connect();

    // Find user by ID
    const user = dbHandler.db
      .prepare(
        `
      SELECT * FROM tb_users WHERE id = ?
    `
      )
      .get(parseInt(id));

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Hash password
    const bcrypt = await import("bcrypt");
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update password in SQLite
    const result = dbHandler.db
      .prepare(
        `
      UPDATE tb_users 
      SET password = ?, updated_at = ?
      WHERE id = ?
    `
      )
      .run(hashedPassword, new Date().toISOString(), parseInt(id));

    res.json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (error) {
    console.error("Error updating password:", error);
    res.status(500).json({ error: "Failed to update password" });
  }
});

// API: Delete user
app.delete("/api/users/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const dbHandler = new SQLiteDatabaseHandler();
    await dbHandler.connect();

    // Find user by ID
    const user = dbHandler.db
      .prepare(
        `
      SELECT * FROM tb_users WHERE id = ?
    `
      )
      .get(parseInt(id));

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Prevent deleting admin user
    if (user.username === "admin") {
      return res.status(400).json({ error: "Cannot delete admin user" });
    }

    // Delete user from SQLite
    const result = dbHandler.db
      .prepare(
        `
      DELETE FROM tb_users WHERE id = ?
    `
      )
      .run(parseInt(id));

    res.json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (error) {}
});

// ===== SESSION MANAGEMENT APIs =====

// API: Get all sessions
app.get("/api/sessions", async (req, res) => {
  try {
    const sessions = dbHandler.getAllSessions();
    res.json({ success: true, data: sessions });
  } catch (error) {
    console.error("Error getting sessions:", error.message);
    res.json({ error: error.message });
  }
});

// API: Get specific session

// API: Get session status (real-time)
app.get("/api/sessions/:sessionId/status", async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Cek status dari memory (real-time)
    const memorySession = sessions[sessionId];
    const memoryStatus = memorySession ? memorySession.status : "disconnected";

    // Cek status dari database
    const dbSession = dbHandler.getSession(sessionId);
    const dbStatus = dbSession ? dbSession.status : "disconnected";

    // Gunakan status dari memory sebagai yang paling akurat
    const realTimeStatus = memoryStatus;

    console.log(
      `📊 Session ${sessionId} status: memory=${memoryStatus}, db=${dbStatus}, realtime=${realTimeStatus}`
    );

    res.json({
      success: true,
      data: {
        sessionId: sessionId,
        status: realTimeStatus,
        memoryStatus: memoryStatus,
        dbStatus: dbStatus,
        lastActivity: memorySession?.lastActivity || null,
      },
    });
  } catch (error) {
    console.error("Error getting session status:", error.message);
    res.json({ error: error.message });
  }
});

// API: Get all settings (for tables page)
app.get("/api/settings/all", async (req, res) => {
  try {
    const allSessions = dbHandler.getAllSessions();
    let allSettings = [];

    // Clean up orphaned sessions (sessions without settings)
    const sessionsWithSettings = [];
    for (const session of allSessions) {
      const settings = dbHandler.getAllSettings(session.session_id);
      if (settings.length > 0) {
        sessionsWithSettings.push(session);
        // Only include settings that have valid session_id
        const validSettings = settings.filter(
          (setting) => setting.session_id === session.session_id
        );
        allSettings = allSettings.concat(validSettings);
      } else {
        // Remove orphaned session
        console.log(`🧹 Removing orphaned session: ${session.session_id}`);
        dbHandler.deleteSession(session.session_id);
      }
    }

    console.log(
      `📊 Returning ${allSettings.length} settings for ${sessionsWithSettings.length} sessions`
    );
    res.json({ success: true, data: allSettings });
  } catch (error) {
    console.error("Error getting all settings:", error.message);
    res.json({ error: error.message });
  }
});

// API endpoint untuk mendapatkan daftar menu
app.get("/api/menus", async (req, res) => {
  try {
    console.log("📋 API request for menus");
    console.log(
      "📋 Database handler status:",
      dbHandler ? "Available" : "Not available"
    );
    console.log(
      "📋 Database connection status:",
      dbHandler?.isConnected ? "Connected" : "Not connected"
    );

    const menus = await dbHandler.getAllMenus();
    console.log(`📋 getAllMenus returned:`, menus);
    console.log(`📋 Menus type:`, typeof menus);
    console.log(`📋 Is array:`, Array.isArray(menus));
    console.log(`📋 Returning ${menus ? menus.length : 0} menus`);

    // Pastikan menus adalah array
    if (!Array.isArray(menus)) {
      console.error("❌ getAllMenus did not return an array:", typeof menus);
      return res.json({ success: false, error: "Invalid menu data format" });
    }

    console.log("📋 Sending response with menus:", menus);
    res.json({ success: true, menus: menus });
  } catch (error) {
    console.error("❌ Error getting menus:", error.message);
    console.error("❌ Error stack:", error.stack);
    res.json({ success: false, error: error.message });
  }
});

// API endpoint untuk mendapatkan detail session
app.get("/api/sessions/:sessionId", async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    console.log(`📋 API request for session: ${sessionId}`);

    const session = dbHandler.getSession(sessionId);

    if (!session) {
      console.log(`📋 Session ${sessionId} not found in database`);
      return res.json({ success: false, error: "Session not found" });
    }

    console.log(`📋 Returning session details for: ${sessionId}`);
    console.log(`📋 Session current_menu_id: ${session.current_menu_id}`);
    console.log(`📋 Session data:`, session);
    res.json({ success: true, session: session });
  } catch (error) {
    console.error("Error getting session:", error.message);
    res.json({ success: false, error: error.message });
  }
});

// API endpoint untuk mengupdate current_menu_id
app.post("/api/sessions/updateCurrentMenu", async (req, res) => {
  try {
    const { sessionId, currentMenuId } = req.body;

    if (!sessionId) {
      return res.json({ success: false, error: "Session ID is required" });
    }

    // Validate session exists
    const session = dbHandler.getSession(sessionId);
    if (!session) {
      return res.json({ success: false, error: "Session not found" });
    }

    // Update current_menu_id
    const success = dbHandler.updateCurrentMenu(sessionId, currentMenuId);

    if (success) {
      console.log(
        `📋 Updated current_menu_id for session ${sessionId} to: ${currentMenuId}`
      );
      res.json({ success: true, message: "Current menu updated successfully" });
    } else {
      res.json({ success: false, error: "Failed to update current menu" });
    }
  } catch (error) {
    console.error("Error updating current menu:", error.message);
    res.json({ success: false, error: error.message });
  }
});

// API: Save/Update session
app.post("/api/sessions", async (req, res) => {
  try {
    const sessionData = req.body;

    // Validate session data
    if (!sessionData.session_id) {
      return res.status(400).json({ error: "Session ID is required" });
    }

    // Check if session has settings before saving
    const existingSettings = dbHandler.getAllSettings(sessionData.session_id);
    if (existingSettings.length === 0) {
      console.log(
        `⚠️ Session ${sessionData.session_id} has no settings, skipping save`
      );
      return res.json({
        success: false,
        message: "Session has no settings, not saved",
        skipped: true,
      });
    }

    const result = await dbHandler.saveSession(sessionData);

    if (result) {
      res.json({ success: true, message: "Session saved successfully" });
    } else {
      res.json({ error: "Failed to save session" });
    }
  } catch (error) {
    console.error("Error saving session:", error.message);
    res.json({ error: error.message });
  }
});

// API: Update session status
app.put("/api/sessions/:sessionId/status", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { status } = req.body;

    const result = dbHandler.updateSessionStatus(sessionId, status);

    if (result) {
      res.json({ success: true, message: "Session status updated" });
    } else {
      res.json({ error: "Failed to update session status" });
    }
  } catch (error) {
    console.error("Error updating session status:", error.message);
    res.json({ error: error.message });
  }
});

// API: Update current menu
app.put("/api/sessions/:sessionId/menu", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { menuId } = req.body;

    const result = dbHandler.updateCurrentMenu(sessionId, menuId);

    if (result) {
      res.json({ success: true, message: "Current menu updated" });
    } else {
      res.json({ error: "Failed to update current menu" });
    }
  } catch (error) {
    console.error("Error updating current menu:", error.message);
    res.json({ error: error.message });
  }
});

// ===== BOT SETTINGS APIs =====

// API: Get all settings for a session
app.get("/api/sessions/:sessionId/settings", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const settings = dbHandler.getAllSettings(sessionId);
    res.json({ success: true, data: settings });
  } catch (error) {
    console.error("Error getting settings:", error.message);
    res.json({ error: error.message });
  }
});

// API: Get specific setting
app.get("/api/sessions/:sessionId/settings/:key", async (req, res) => {
  try {
    const { sessionId, key } = req.params;
    const setting = dbHandler.getSetting(sessionId, key);

    if (!setting) {
      return res.json({ error: "Setting not found" });
    }

    res.json({ success: true, data: setting });
  } catch (error) {
    console.error("Error getting setting:", error.message);
    res.json({ error: error.message });
  }
});

// API: Save/Update setting
app.post("/api/sessions/:sessionId/settings", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { key, value, type = "string", description = "" } = req.body;

    const result = await dbHandler.saveSetting(
      sessionId,
      key,
      value,
      type,
      description
    );

    if (result) {
      res.json({ success: true, message: "Setting saved successfully" });
    } else {
      res.json({ error: "Failed to save setting" });
    }
  } catch (error) {
    console.error("Error saving setting:", error.message);
    res.json({ error: error.message });
  }
});

// API: Delete setting
app.delete("/api/sessions/:sessionId/settings/:key", async (req, res) => {
  try {
    const { sessionId, key } = req.params;
    const result = dbHandler.deleteSetting(sessionId, key);

    if (result) {
      res.json({ success: true, message: "Setting deleted successfully" });
    } else {
      res.json({ error: "Failed to delete setting" });
    }
  } catch (error) {
    console.error("Error deleting setting:", error.message);
    res.json({ error: error.message });
  }
});

// API: User login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res
        .status(400)
        .json({ error: "Username and password are required" });
    }

    const dbHandler = new SQLiteDatabaseHandler();
    await dbHandler.connect();

    // Find user by username
    const user = dbHandler.db
      .prepare(
        `
      SELECT * FROM tb_users WHERE username = ?
    `
      )
      .get(username);

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (!user.is_active) {
      return res.status(401).json({ error: "Account is deactivated" });
    }

    // Verify password
    const bcrypt = await import("bcrypt");
    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Update last login in SQLite
    dbHandler.db
      .prepare(
        `
      UPDATE tb_users SET last_login = ? WHERE id = ?
    `
      )
      .run(new Date().toISOString(), user.id);

    // Set session cookie
    res.cookie("authToken", "wa-gateway-auth-2024", {
      httpOnly: true,
      secure: false,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });
    res.cookie("username", user.username, {
      httpOnly: false,
      secure: false,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
      },
      message: "Login successful",
    });
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).json({ error: "Login failed" });
  }
});

// API: User logout
app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("authToken");
  res.clearCookie("username");
  res.json({ success: true, message: "Logout successful" });
});

// API: Get current user info
app.get("/api/auth/me", async (req, res) => {
  try {
    const username = req.cookies?.username;

    if (!username) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const dbHandler = new SQLiteDatabaseHandler();
    await dbHandler.connect();

    // Find user by username
    const user = dbHandler.db
      .prepare(
        `
      SELECT * FROM tb_users WHERE username = ?
    `
      )
      .get(username);

    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        is_active: user.is_active,
        created_at: user.created_at,
        last_login: user.last_login,
      },
    });
  } catch (error) {
    console.error("Error getting user info:", error);
    res.status(500).json({ error: "Failed to get user info" });
  }
});

// API: User management page
app.get("/user-management", requireAuth, (req, res) => {
  const username = req.cookies?.username || "Admin";
  res.render("user-management", { username });
});

// API: User login (form-based)
app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.render("login", {
        error: "Username and password are required",
      });
    }

    const dbHandler = new SQLiteDatabaseHandler();
    await dbHandler.connect();

    // Find user by username
    const user = dbHandler.db
      .prepare(
        `
      SELECT * FROM tb_users WHERE username = ?
    `
      )
      .get(username);

    if (!user) {
      return res.render("login", { error: "Invalid credentials" });
    }

    if (!user.is_active) {
      return res.render("login", { error: "Account is deactivated" });
    }

    // Verify password
    const bcrypt = await import("bcrypt");
    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      return res.render("login", { error: "Invalid credentials" });
    }

    // Update last login in SQLite
    dbHandler.db
      .prepare(
        `
      UPDATE tb_users SET last_login = ? WHERE id = ?
    `
      )
      .run(new Date().toISOString(), user.id);

    // Set session cookie
    res.cookie("authToken", "wa-gateway-auth-2024", {
      httpOnly: true,
      secure: false,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });
    res.cookie("username", user.username, {
      httpOnly: false,
      secure: false,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });

    res.redirect("/dashboard");
  } catch (error) {
    console.error("Error during login:", error);
    res.render("login", { error: "Login failed" });
  }
});

// API: User logout
app.post("/logout", (req, res) => {
  res.clearCookie("authToken");
  res.clearCookie("username");
  res.redirect("/login");
});

// ===== MENU MANAGEMENT API ENDPOINTS =====

// API: Get all menus (tb_menu)
// API: Create new menu (tb_menu)
app.post("/api/menus", async (req, res) => {
  try {
    const { name, remark } = req.body;

    if (!name || !remark) {
      return res.status(400).json({ error: "Name and remark are required" });
    }

    const dbHandler = new SQLiteDatabaseHandler();
    await dbHandler.connect();

    // Create new menu in SQLite
    const result = dbHandler.db
      .prepare(
        `
      INSERT INTO tb_menu (name, remark, time_stamp) 
      VALUES (?, ?, ?)
    `
      )
      .run(name, remark, new Date().toISOString());

    res.json({
      success: true,
      id: result.lastInsertRowid,
      message: "Menu created successfully",
    });
  } catch (error) {
    console.error("Error creating menu:", error);
    res.status(500).json({ error: "Failed to create menu" });
  }
});

// API: Update menu (tb_menu)
app.put("/api/menus/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, remark } = req.body;

    if (!name || !remark) {
      return res.status(400).json({ error: "Name and remark are required" });
    }

    const dbHandler = new SQLiteDatabaseHandler();
    await dbHandler.connect();

    // Update menu in SQLite
    const result = dbHandler.db
      .prepare(
        `
      UPDATE tb_menu 
      SET name = ?, remark = ?, time_stamp = ? 
      WHERE id = ?
    `
      )
      .run(name, remark, new Date().toISOString(), parseInt(id));

    if (result.changes === 0) {
      return res.status(404).json({ error: "Menu not found" });
    }

    res.json({
      success: true,
      message: "Menu updated successfully",
    });
  } catch (error) {
    console.error("Error updating menu:", error);
    res.status(500).json({ error: "Failed to update menu" });
  }
});

// API: Delete menu (tb_menu)
app.delete("/api/menus/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const dbHandler = new SQLiteDatabaseHandler();
    await dbHandler.connect();

    // Check if menu is being used by bot menus
    const botMenusCount = dbHandler.db
      .prepare(
        `
      SELECT COUNT(*) as count FROM tb_botmenu WHERE menu_id = ?
    `
      )
      .get(parseInt(id));

    if (botMenusCount.count > 0) {
      return res.status(400).json({
        error: "Cannot delete menu. It is being used by bot menus.",
      });
    }

    // Delete menu from SQLite
    const result = dbHandler.db
      .prepare(
        `
      DELETE FROM tb_menu WHERE id = ?
    `
      )
      .run(parseInt(id));

    if (result.changes === 0) {
      return res.status(404).json({ error: "Menu not found" });
    }

    res.json({
      success: true,
      message: "Menu deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting menu:", error);
    res.status(500).json({ error: "Failed to delete menu" });
  }
});

// API: Get all bot menus (tb_botmenu)
app.get("/api/botmenus", async (req, res) => {
  try {
    const dbHandler = new SQLiteDatabaseHandler();
    const connected = await dbHandler.connect();

    if (!connected) {
      return res
        .status(500)
        .json({ error: "SQLite database connection failed" });
    }

    // Get botmenus from SQLite database
    const botmenus = dbHandler.db
      .prepare(
        `
      SELECT * FROM tb_botmenu 
      ORDER BY menu_id, parent_id, keyword
    `
      )
      .all();

    res.json(botmenus);
  } catch (error) {
    console.error("Error fetching bot menus:", error);
    res.status(500).json({ error: "Failed to fetch bot menus" });
  }
});

// API: Create new bot menu (tb_botmenu)
app.post("/api/botmenus", async (req, res) => {
  try {
    const { menu_id, parent_id, keyword, description, url } = req.body;

    if (!menu_id || !keyword || !description) {
      return res.status(400).json({
        error: "Menu ID, keyword, and description are required",
      });
    }

    const dbHandler = new SQLiteDatabaseHandler();
    await dbHandler.connect();

    // Check if menu_id exists
    const menuExists = dbHandler.db
      .prepare(
        `
      SELECT COUNT(*) as count FROM tb_menu WHERE id = ?
    `
      )
      .get(parseInt(menu_id));

    if (menuExists.count === 0) {
      return res.status(400).json({ error: "Menu ID does not exist" });
    }

    // Check if parent_id exists (if provided)
    if (parent_id) {
      const parentExists = dbHandler.db
        .prepare(
          `
        SELECT COUNT(*) as count FROM tb_botmenu WHERE id = ?
      `
        )
        .get(parseInt(parent_id));

      if (parentExists.count === 0) {
        return res.status(400).json({ error: "Parent ID does not exist" });
      }
    }

    // Check if keyword already exists for the same menu_id
    const keywordExists = dbHandler.db
      .prepare(
        `
      SELECT COUNT(*) as count FROM tb_botmenu WHERE keyword = ? AND menu_id = ?
    `
      )
      .get(keyword, parseInt(menu_id));

    if (keywordExists.count > 0) {
      return res
        .status(400)
        .json({ error: "Keyword already exists for this menu" });
    }

    // Create new botmenu in SQLite
    const result = dbHandler.db
      .prepare(
        `
      INSERT INTO tb_botmenu (menu_id, parent_id, keyword, description, url) 
      VALUES (?, ?, ?, ?, ?)
    `
      )
      .run(
        parseInt(menu_id),
        parent_id ? parseInt(parent_id) : null,
        keyword,
        description,
        url || null
      );

    res.json({
      success: true,
      id: result.lastInsertRowid,
      message: "Bot menu created successfully",
    });
  } catch (error) {
    console.error("Error creating bot menu:", error);
    res.status(500).json({ error: "Failed to create bot menu" });
  }
});

// API: Update bot menu (tb_botmenu)
app.put("/api/botmenus/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { menu_id, parent_id, keyword, description, url } = req.body;

    if (!menu_id || !keyword || !description) {
      return res.status(400).json({
        error: "Menu ID, keyword, and description are required",
      });
    }

    const dbHandler = new SQLiteDatabaseHandler();
    await dbHandler.connect();

    // Check if menu_id exists
    const menuExists = dbHandler.db
      .prepare(
        `
      SELECT COUNT(*) as count FROM tb_menu WHERE id = ?
    `
      )
      .get(parseInt(menu_id));

    if (menuExists.count === 0) {
      return res.status(400).json({ error: "Menu ID does not exist" });
    }

    // Check if parent_id exists (if provided)
    if (parent_id) {
      const parentExists = dbHandler.db
        .prepare(
          `
        SELECT COUNT(*) as count FROM tb_botmenu WHERE id = ? AND id != ?
      `
        )
        .get(parseInt(parent_id), parseInt(id));

      if (parentExists.count === 0) {
        return res.status(400).json({ error: "Parent ID does not exist" });
      }
    }

    // Check if keyword already exists for the same menu_id (excluding current botmenu)
    const keywordExists = dbHandler.db
      .prepare(
        `
      SELECT COUNT(*) as count FROM tb_botmenu 
      WHERE keyword = ? AND menu_id = ? AND id != ?
    `
      )
      .get(keyword, parseInt(menu_id), parseInt(id));

    if (keywordExists.count > 0) {
      return res
        .status(400)
        .json({ error: "Keyword already exists for this menu" });
    }

    // Update botmenu in SQLite
    const result = dbHandler.db
      .prepare(
        `
      UPDATE tb_botmenu 
      SET menu_id = ?, parent_id = ?, keyword = ?, description = ?, url = ?
      WHERE id = ?
    `
      )
      .run(
        parseInt(menu_id),
        parent_id ? parseInt(parent_id) : null,
        keyword,
        description,
        url || null,
        parseInt(id)
      );

    if (result.changes === 0) {
      return res.status(404).json({ error: "Bot menu not found" });
    }

    res.json({
      success: true,
      message: "Bot menu updated successfully",
    });
  } catch (error) {
    console.error("Error updating bot menu:", error);
    res.status(500).json({ error: "Failed to update bot menu" });
  }
});

// API: Delete bot menu (tb_botmenu)
app.delete("/api/botmenus/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const dbHandler = new SQLiteDatabaseHandler();
    await dbHandler.connect();

    // Check if this bot menu has children
    const childrenCount = dbHandler.db
      .prepare(
        `
      SELECT COUNT(*) as count FROM tb_botmenu WHERE parent_id = ?
    `
      )
      .get(parseInt(id));

    if (childrenCount.count > 0) {
      return res.status(400).json({
        error: "Cannot delete bot menu. It has child menus.",
      });
    }

    // Delete botmenu from SQLite
    const result = dbHandler.db
      .prepare(
        `
      DELETE FROM tb_botmenu WHERE id = ?
    `
      )
      .run(parseInt(id));

    if (result.changes === 0) {
      return res.status(404).json({ error: "Bot menu not found" });
    }

    res.json({
      success: true,
      message: "Bot menu deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting bot menu:", error);
    res.status(500).json({ error: "Failed to delete bot menu" });
  }
});

// API: Get menu management page
app.get("/menu-management", requireAuth, (req, res) => {
  const username = req.cookies?.username || "Admin";
  res.render("menu-management", { username });
});

// API: Bot PHP Handler
app.post("/api/botPhp", (req, res) => {
  const { action, message } = req.body;
  console.log(
    `🤖 PHP Handler called with action: ${action}, message: "${message}"`
  );

  // Create PHP script content
  const phpScript = `
<?php
require_once 'api/db.php';
require_once 'api/BotMenu.php';

header('Content-Type: application/json');

try {
    $botMenu = new BotMenu();
    
    switch ('${action}') {
        case 'process':
            $response = $botMenu->processMessage('${message}');
            echo json_encode(['success' => true, 'response' => $response]);
            break;
        case 'main-menu':
            $menus = $botMenu->getMainMenus();
            echo json_encode(['success' => true, 'menus' => $menus]);
            break;
        default:
            echo json_encode(['success' => false, 'message' => 'Invalid action']);
    }
} catch (Exception $e) {
    echo json_encode(['success' => false, 'message' => $e->getMessage()]);
}
?>`;

  // Write PHP script to temp file
  const tempFile = path.join(process.cwd(), "temp-bot.php");
  fs.writeFileSync(tempFile, phpScript);

  // Execute PHP script
  const php = spawn("php", [tempFile]);
  let output = "";
  let error = "";

  php.stdout.on("data", (data) => {
    output += data.toString();
  });

  php.stderr.on("data", (data) => {
    error += data.toString();
  });

  php.on("close", (code) => {
    // Clean up temp file
    fs.unlinkSync(tempFile);

    console.log(`🤖 PHP execution completed with code: ${code}`);
    console.log(`🤖 PHP output: ${output}`);
    if (error) console.log(`🤖 PHP error: ${error}`);

    if (code === 0) {
      try {
        const result = JSON.parse(output);
        console.log(`🤖 PHP result:`, result);
        res.json(result);
      } catch (e) {
        console.error(`🤖 JSON parse error:`, e.message);
        res.json({
          success: false,
          message: "Invalid JSON response",
          output,
        });
      }
    } else {
      console.error(`🤖 PHP execution failed with code: ${code}`);
      res.json({ success: false, message: "PHP execution failed", error });
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("❌ Unhandled error:", err);
  res.status(500).json({
    error: "Internal server error",
    message: err.message,
  });
});

// Enhanced auto-recovery mechanism for disconnected sessions
setInterval(() => {
  Object.keys(sessions).forEach((sessionId) => {
    const session = sessions[sessionId];

    // Check if session is disconnected but not marked for deletion
    if (
      session &&
      session.status === "disconnected" &&
      !session.deleted &&
      !session.reconnecting
    ) {
      // Enhanced auto-recovery with better logging
      console.log(`🔄 Auto-recovery: Attempting to reconnect ${sessionId}`);
      session.reconnecting = true;
      session.reconnectAttempts = (session.reconnectAttempts || 0) + 1;

      // Exponential backoff with jitter and max attempts tracking
      const baseDelay = Math.min(
        5000 * Math.pow(1.5, session.reconnectAttempts - 1),
        60000
      );
      const jitter = Math.random() * 3000; // 0-3 seconds random
      const delay = Math.min(baseDelay + jitter, 60000); // Max 60 seconds

      console.log(
        `⏳ Auto-recovery delay for ${sessionId}: ${Math.round(
          delay / 1000
        )}s (attempt ${session.reconnectAttempts})`
      );

      setTimeout(() => {
        if (sessions[sessionId] && !sessions[sessionId].deleted) {
          initSession(sessionId).catch((err) => {
            console.error(`❌ Auto-recovery failed for ${sessionId}:`, err);
            sessions[sessionId].reconnecting = false;

            // If too many failed attempts, log warning
            if (session.reconnectAttempts > 10) {
              console.warn(
                `⚠️ Session ${sessionId} has failed ${session.reconnectAttempts} reconnection attempts`
              );
            }
          });
        }
      }, delay);
    }
  });
}, 45000); // Check every 45 seconds (less aggressive)

// Enhanced connection monitoring and health check
setInterval(() => {
  Object.keys(sessions).forEach((sessionId) => {
    const session = sessions[sessionId];

    if (session && session.status === "connected") {
      const now = Date.now();
      const lastHeartbeat = session.lastHeartbeat || 0;
      const timeSinceHeartbeat = now - lastHeartbeat;

      // If no heartbeat for more than 3 minutes, consider disconnected
      if (timeSinceHeartbeat > 180000) {
        // 3 minutes
        console.log(
          `💔 No heartbeat detected for ${sessionId} for ${Math.round(
            timeSinceHeartbeat / 1000
          )}s, marking as disconnected`
        );
        session.status = "disconnected";
      }

      // Log connection health warnings
      if (timeSinceHeartbeat > 120000) {
        // 2 minutes
        console.log(
          `⚠️ Session ${sessionId} health warning: No heartbeat for ${Math.round(
            timeSinceHeartbeat / 1000
          )}s`
        );
      } else if (timeSinceHeartbeat > 60000) {
        // 1 minute
        console.log(
          `💓 Session ${sessionId} heartbeat delay: ${Math.round(
            timeSinceHeartbeat / 1000
          )}s`
        );
      }
    }
  });
}, 60000); // Check every 60 seconds (less aggressive)

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM received, shutting down gracefully...");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("🛑 SIGINT received, shutting down gracefully...");
  process.exit(0);
});

// 404 handler - must be last
app.use((req, res) => {
  console.log(`❌ Route not found: ${req.method} ${req.path}`);
  res.status(404).json({ error: "Route not found" });
});

// Initialize bot handler cleanup
setInterval(() => {
  botHandler.cleanupInactiveSessions();
}, 10 * 60 * 1000); // Cleanup every 10 minutes

// Periodic cleanup of decryption attempts and session maintenance
setInterval(() => {
  console.log(`🧹 Running periodic session cleanup...`);

  Object.keys(sessions).forEach((sessionId) => {
    const session = sessions[sessionId];
    if (session && session.decryptionAttempts) {
      // Clear old decryption attempts (older than 1 hour)
      const now = Date.now();
      const oneHourAgo = now - 60 * 60 * 1000;

      for (const [
        contactJid,
        attempts,
      ] of session.decryptionAttempts.entries()) {
        // If we have timestamp data, use it; otherwise clear attempts older than 10 minutes
        const lastAttempt =
          session.lastDecryptionAttempt?.[contactJid] || now - 10 * 60 * 1000;

        if (lastAttempt < oneHourAgo) {
          session.decryptionAttempts.delete(contactJid);
          if (session.lastDecryptionAttempt) {
            delete session.lastDecryptionAttempt[contactJid];
          }
          console.log(
            `🧹 Cleared old decryption attempts for ${contactJid} in ${sessionId}`
          );
        }
      }
    }
  });

  console.log(`✅ Periodic session cleanup completed`);
}, 30 * 60 * 1000); // Cleanup every 30 minutes

console.log("🤖 Bot Handler initialized and integrated");
console.log("🔧 Enhanced message decryption handling enabled");
console.log("🛡️ PreKey error recovery mechanisms active");
console.log("🔄 Always Connected Mode: ENABLED");
console.log("💓 Enhanced Heartbeat: Every 20 seconds with multiple strategies");
console.log("🔄 Smart Auto-Recovery: ENABLED with exponential backoff");
console.log("📊 Enhanced Connection Monitoring: Every 60 seconds");
console.log("🔗 Database Connection: Enhanced with retry mechanism");
console.log("🏥 Health Check: Enhanced with detailed session status");

// 404 handler - must be last
app.use((req, res) => {
  console.log(`❌ Route not found: ${req.method} ${req.path}`);
  res.status(404).json({ error: "Route not found" });
});

// Start server
console.log("🔄 Starting server...");

// Initialize database before starting server
initializeDatabase();

app
  .listen(PORT, HOST, () => {
    console.log(`🚀 WA Gateway running at http://${HOST}:${PORT}/dashboard`);
    console.log(`📊 Environment: ${process.env.NODE_ENV || "development"}`);
    console.log(`📊 Port: ${PORT}`);
    console.log(`📊 Host: ${HOST}`);
    console.log(`📊 PID: ${process.pid}`);
    console.log(`🤖 Bot integration active`);
    console.log(`🔧 Enhanced decryption error handling enabled`);
    console.log(
      `📋 Menu Management available at: http://${HOST}:${PORT}/menu-management`
    );
  })
  .on("error", (err) => {
    console.error(`❌ Server failed to start:`, err);
    if (err.code === "EADDRINUSE") {
      console.error(`❌ Port ${PORT} is already in use`);
    }
    process.exit(1);
  });
