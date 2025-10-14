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
import DatabaseHandler from "./DatabaseHandler.js";

const app = express();
const PORT = process.env.PORT || 4004;
const HOST = process.env.HOST || "localhost";

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
  res.render("login");
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

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    sessions: Object.keys(sessions).length,
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
    this.dbHandler = new DatabaseHandler();
    this.userSessions = new Map(); // Menyimpan session user
    this.botEnabled = true; // Flag untuk enable/disable bot

    // Initialize database connection
    this.initializeDatabase();
  }

  async initializeDatabase() {
    const connected = await this.dbHandler.connect();
    if (!connected) {
      console.error("❌ Failed to connect to database");
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

      // Skip jika pesan dari group (sesuai dengan logic yang sudah ada)
      if (from.includes("@g.us")) {
        console.log(
          `🚫 Bot blocked for ${sessionId} - message from group: ${from}`
        );
        return;
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
      const response = await this.callBotAPI("process", {
        message: messageText,
      });

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
  async callBotAPI(action, data = {}) {
    try {
      console.log(`🤖 Calling Database Handler: ${action}`, data);

      switch (action) {
        case "menu":
          const menuResponse = await this.dbHandler.getMainMenuResponse();
          return { success: true, response: menuResponse };

        case "process":
          const processResponse = await this.dbHandler.processMessage(
            data.message
          );
          return { success: true, response: processResponse };

        case "search":
          const searchResults = await this.dbHandler.searchMenuByDescription(
            data.search_term
          );
          const searchResponse = await this.dbHandler.formatSearchResults(
            searchResults
          );
          return { success: true, response: searchResponse };

        default:
          return { success: false, message: "Unknown action" };
      }
    } catch (error) {
      console.error("Database handler call failed:", error.message);
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
      await session.sock.clearSessionData?.(contactJid);

      // Request new prekeys
      await session.sock.requestPreKeyBundle(contactJid);

      console.log(`✅ Session cleanup completed for ${contactJid}`);
    }
  } catch (error) {
    console.error(
      `❌ Failed to cleanup session for ${contactJid}:`,
      error.message
    );
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
    let botResponse = await generateBotResponse(messageText, settings);

    console.log(
      `🤖 Generated response for session ${sessionId}: "${botResponse}"`
    );

    // Send response back to user using the session's socket
    const session = sessions[sessionId];
    if (session && session.sock) {
      await session.sock.sendMessage(from, { text: botResponse });
      console.log(`✅ Bot response sent to ${from} via session ${sessionId}`);
    } else {
      console.error(`❌ No socket found for session ${sessionId}`);
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
async function generateBotResponse(messageText, settings) {
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
    try {
      const response = await botHandler.callBotAPI("menu", {});
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
      const response = await botHandler.callBotAPI("process", {
        message: lowerText,
      });
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
      const response = await botHandler.callBotAPI("search", {
        search_term: lowerText,
      });
      console.log("🤖 Search API response:", response);
      if (response.success) {
        return response.response;
      }
    } catch (error) {
      console.error("Error searching menu:", error);
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
      // Enhanced configuration for better message handling
      generateHighQualityLinkPreview: true,
      markOnlineOnConnect: true,
      syncFullHistory: false,
      // Better error handling for decryption
      retryRequestDelayMs: 2000,
      maxMsgRetryCount: 3,
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
        try {
          const groups = await sock.groupFetchAllParticipating();
          if (!sessions[sessionId] || sessions[sessionId].deleted) return;
          sessions[sessionId].groups = Object.values(groups).map((g) => ({
            jid: g.id,
            name: g.subject,
          }));
        } catch (err) {
          console.error(`❌ Failed to fetch groups for ${sessionId}:`, err);
          if (sessions[sessionId]) sessions[sessionId].groups = [];
        }
        console.log(`✅ Session ${sessionId} connected successfully`);
      }

      if (connection === "close") {
        if (!sessions[sessionId] || sessions[sessionId].deleted) return;
        sessions[sessionId].status = "disconnected";
        sessions[sessionId].qr = null;
        console.log(`❌ Session ${sessionId} disconnected`);

        // Check disconnect reason
        const disconnectCode = lastDisconnect?.error?.output?.statusCode;
        console.log(`📊 Disconnect reason for ${sessionId}:`, disconnectCode);

        // Only auto-reconnect for certain disconnect reasons and limit attempts
        if (
          disconnectCode !== DisconnectReason.loggedOut &&
          disconnectCode !== DisconnectReason.badSession &&
          disconnectCode !== DisconnectReason.multideviceMismatch
        ) {
          // Add a flag to prevent multiple reconnection attempts
          if (sessions[sessionId] && !sessions[sessionId].reconnecting) {
            sessions[sessionId].reconnecting = true;
            sessions[sessionId].reconnectAttempts =
              (sessions[sessionId].reconnectAttempts || 0) + 1;

            // Limit reconnection attempts to prevent infinite loops
            if (sessions[sessionId].reconnectAttempts <= 3) {
              console.log(
                `🔄 Attempting to reconnect session ${sessionId} (attempt ${sessions[sessionId].reconnectAttempts}/3) in 15 seconds...`
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
              }, 15000); // Increased delay to 15 seconds
            } else {
              console.log(
                `🚫 Max reconnection attempts reached for ${sessionId}. Stopping auto-reconnect.`
              );
              sessions[sessionId].reconnecting = false;
            }
          }
        } else {
          console.log(
            `🚫 Not auto-reconnecting ${sessionId} due to disconnect reason: ${disconnectCode}`
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

      // Guard: Check if session is connected
      if (!sessions[sessionId] || sessions[sessionId].status !== "connected") {
        console.log(
          `🚫 Session ${sessionId} not connected, ignoring messages.`
        );
        return;
      }

      if (!m.messages) return;
      const msg = m.messages[0];

      // Skip if message is from bot itself
      if (msg.key.fromMe) return;

      // Handle decryption errors gracefully
      if (msg.message === undefined) {
        console.log(
          `🔒 Message from ${msg.key.remoteJid} is encrypted, attempting to decrypt...`
        );

        // Try to decrypt the message
        try {
          const decryptedMessage = await sock.decryptMessage(msg);
          if (decryptedMessage) {
            console.log(
              `✅ Message decrypted successfully from ${msg.key.remoteJid}`
            );
            // Process the decrypted message
            msg.message = decryptedMessage;
          } else {
            console.log(
              `⚠️ Failed to decrypt message from ${msg.key.remoteJid}, skipping...`
            );
            return;
          }
        } catch (decryptError) {
          console.log(
            `❌ Decryption failed for message from ${msg.key.remoteJid}:`,
            decryptError.message
          );

          // Handle specific decryption errors
          if (
            decryptError.message.includes("PreKeyError") ||
            decryptError.message.includes("Invalid PreKey ID") ||
            decryptError.message.includes("No session found")
          ) {
            console.log(
              `🔄 PreKey error detected, attempting to refresh session...`
            );

            // Use the cleanup function to handle problematic sessions
            await cleanupProblematicSession(sessionId, msg.key.remoteJid);
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

          // Check if message is from a group (contains @g.us)
          if (from.includes("@g.us")) {
            console.log(
              `🚫 Auto-reply blocked for ${sessionId} - message from group: ${from}`
            );
            return; // Skip auto-reply for group messages
          }

          // Check if group replies are allowed for this bot type
          if (
            from.includes("@g.us") &&
            !currentSettings.config?.features?.groupReply
          ) {
            console.log(
              `🚫 Group replies disabled for ${sessionId} (${currentSettings.botType})`
            );
            return;
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

    // Handle message decryption errors
    sock.ev.on("messages.update", async (update) => {
      if (update.status === "error" && update.error) {
        const errorMsg = update.error.message || update.error.toString();
        console.log(`🔒 Message decryption error for ${sessionId}:`, errorMsg);

        // Handle PreKey errors
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
            await cleanupProblematicSession(sessionId, update.key.remoteJid);
          }
        }
      }
    });

    // Add heartbeat to keep connection alive
    const heartbeatInterval = setInterval(async () => {
      if (
        sessions[sessionId] &&
        sessions[sessionId].status === "connected" &&
        sock
      ) {
        try {
          // Send a ping to keep connection alive
          await sock.presenceSubscribe(sessionId + "@s.whatsapp.net");
        } catch (err) {
          console.log(`💓 Heartbeat failed for ${sessionId}:`, err.message);
          // If heartbeat fails, mark as disconnected
          sessions[sessionId].status = "disconnected";
          clearInterval(heartbeatInterval);
        }
      } else {
        clearInterval(heartbeatInterval);
      }
    }, 30000); // Every 30 seconds
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

// Session detail page (with auth)
app.get("/session/:id", requireAuth, (req, res) => {
  const { id } = req.params;
  const s = sessions[id];
  if (!s) {
    return res.status(404).send("Session not found");
  }
  const detail = {
    id,
    status: s.status,
    groups: s.groups || [],
    hasSock: !!s.sock,
  };

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

  if (!sessionId || !to || !message) {
    return res.json({ error: "Missing required parameters" });
  }

  if (!sessions[sessionId] || sessions[sessionId].status !== "connected") {
    return res.json({ error: "Session not connected" });
  }

  try {
    const jid = isGroup ? to : to + "@s.whatsapp.net";

    // Retry mechanism for sending messages
    let retries = 3;
    let lastError;

    while (retries > 0) {
      try {
        await sessions[sessionId].sock.sendMessage(jid, { text: message });
        console.log(`✅ Message sent successfully to ${jid} via ${sessionId}`);
        return res.json({ success: true });
      } catch (err) {
        lastError = err;
        retries--;
        console.log(`⚠️ Send message failed (${3 - retries}/3):`, err.message);

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
        res.json({ success: false, message: "Invalid JSON response", output });
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

// Auto-recovery mechanism for disconnected sessions
setInterval(() => {
  Object.keys(sessions).forEach((sessionId) => {
    const session = sessions[sessionId];

    // Check if session is disconnected but not marked for deletion
    if (
      session &&
      session.status === "disconnected" &&
      !session.deleted &&
      !session.reconnecting &&
      (session.reconnectAttempts || 0) < 5
    ) {
      // Max 5 auto-recovery attempts

      console.log(`🔄 Auto-recovery: Attempting to reconnect ${sessionId}`);
      session.reconnecting = true;
      session.reconnectAttempts = (session.reconnectAttempts || 0) + 1;

      setTimeout(() => {
        if (sessions[sessionId] && !sessions[sessionId].deleted) {
          initSession(sessionId).catch((err) => {
            console.error(`❌ Auto-recovery failed for ${sessionId}:`, err);
            sessions[sessionId].reconnecting = false;
          });
        }
      }, 10000); // Wait 10 seconds before attempting
    }
  });
}, 60000); // Check every minute

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

console.log("🤖 Bot Handler initialized and integrated");
console.log("🔧 Enhanced message decryption handling enabled");
console.log("🛡️ PreKey error recovery mechanisms active");

// Start server
app
  .listen(PORT, HOST, () => {
    console.log(`🚀 WA Gateway running at http://${HOST}:${PORT}/dashboard`);
    console.log(`📊 Environment: ${process.env.NODE_ENV || "development"}`);
    console.log(`📊 Port: ${PORT}`);
    console.log(`📊 Host: ${HOST}`);
    console.log(`📊 PID: ${process.pid}`);
    console.log(`🤖 Bot integration active`);
    console.log(`🔧 Enhanced decryption error handling enabled`);
  })
  .on("error", (err) => {
    console.error(`❌ Server failed to start:`, err);
    if (err.code === "EADDRINUSE") {
      console.error(`❌ Port ${PORT} is already in use`);
    }
    process.exit(1);
  });
