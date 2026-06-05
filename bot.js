require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const axios = require("axios");

// ── ENV ─────────────────────────────────────────────
console.log("BOT STARTING...");
console.log("ENV LOADED:", {
  BOT_TOKEN: !!process.env.BOT_TOKEN,
  APPS_SCRIPT_URL: !!process.env.APPS_SCRIPT_URL,
  ADMIN_TELEGRAM_ID: !!process.env.ADMIN_TELEGRAM_ID,
  WEBHOOK_URL: !!process.env.WEBHOOK_URL,
  NODE_ENV: process.env.NODE_ENV
});

const BOT_TOKEN = process.env.BOT_TOKEN;
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
const ADMIN_ID = String(process.env.ADMIN_TELEGRAM_ID);
const WEBHOOK_URL = process.env.WEBHOOK_URL;

if (!BOT_TOKEN) throw new Error("BOT_TOKEN missing");
if (!APPS_SCRIPT_URL) throw new Error("APPS_SCRIPT_URL missing");
if (!ADMIN_ID) throw new Error("ADMIN_TELEGRAM_ID missing");

// ── MODE SWITCH ────────────────────────────────────
const IS_PROD = process.env.NODE_ENV === "production";

// ── BOT INIT ────────────────────────────────────────
const bot = new TelegramBot(BOT_TOKEN, {
  polling: !IS_PROD
});

// IMPORTANT: prevent webhook conflicts
async function initBot() {
  try {
    if (IS_PROD && WEBHOOK_URL) {
      await bot.deleteWebHook();
      await bot.setWebHook(`${WEBHOOK_URL}/bot`);
      console.log("Webhook mode enabled");
    } else {
      await bot.deleteWebHook();
      console.log("Polling mode enabled");
    }

    const me = await bot.getMe();
    console.log("Logged in as:", me.username);
  } catch (err) {
    console.error("Bot init error:", err.message);
  }
}

initBot();

// ── EXPRESS ─────────────────────────────────────────
const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("TinkerHub Attendance Bot is running");
});

// webhook endpoint (ONLY used in production)
app.post("/bot", (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// ── HELPERS ─────────────────────────────────────────
async function sheetRequest(payload) {
  const res = await axios.post(APPS_SCRIPT_URL, payload, {
    headers: { "Content-Type": "application/json" }
  });
  return res.data;
}

const isAdmin = (id) => String(id) === ADMIN_ID;

// ── KEYBOARDS ───────────────────────────────────────
function mainKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Present", callback_data: "mark_present" },
          { text: "🌴 Leave", callback_data: "mark_leave" }
        ],
        [
          { text: "📊 My Status", callback_data: "my_status" },
          { text: "📅 Leave Balance", callback_data: "balance" }
        ]
      ]
    }
  };
}

function adminKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Present", callback_data: "mark_present" },
          { text: "🌴 Leave", callback_data: "mark_leave" }
        ],
        [
          { text: "📊 My Status", callback_data: "my_status" },
          { text: "📅 Leave Balance", callback_data: "balance" }
        ],
        [
          { text: "👥 Team Status", callback_data: "team" },
          { text: "📋 Monthly Report", callback_data: "report" }
        ]
      ]
    }
  };
}

const getKeyboard = (userId) =>
  isAdmin(userId) ? adminKeyboard() : mainKeyboard();

// ── START COMMAND ───────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  try {
    const userId = String(msg.from.id);
    const name = [msg.from.first_name, msg.from.last_name]
      .filter(Boolean)
      .join(" ");

    const check = await sheetRequest({
      action: "isRegistered",
      telegram_id: userId
    });

    if (check.registered) {
      return bot.sendMessage(
        msg.chat.id,
        `Welcome back, ${check.name}!`,
        getKeyboard(userId)
      );
    }

    const result = await sheetRequest({
      action: "register",
      telegram_id: userId,
      name
    });

    if (result.success) {
      return bot.sendMessage(
        msg.chat.id,
        `Hi ${name}, registered successfully! You get 4 leaves/month.`,
        getKeyboard(userId)
      );
    }

    bot.sendMessage(msg.chat.id, "Registration failed.");
  } catch (err) {
    console.error("/start error:", err.message);
  }
});

// ── CALLBACK HANDLER ───────────────────────────────
bot.on("callback_query", async (query) => {
  try {
    const userId = String(query.from.id);
    const chatId = query.message.chat.id;
    const data = query.data;

    await bot.answerCallbackQuery(query.id);

    const name = [query.from.first_name, query.from.last_name]
      .filter(Boolean)
      .join(" ");

    if (
      ["mark_present", "mark_leave", "my_status", "balance"].includes(data)
    ) {
      const check = await sheetRequest({
        action: "isRegistered",
        telegram_id: userId
      });

      if (!check.registered) {
        return bot.sendMessage(chatId, "Please register first.");
      }
    }

    // ── ATTENDANCE ──
    if (data === "mark_present" || data === "mark_leave") {
      const status = data === "mark_present" ? "Present" : "Leave";

      const result = await sheetRequest({
        action: "markAttendance",
        telegram_id: userId,
        name,
        status
      });

      return bot.sendMessage(
        chatId,
        `${status} marked successfully`,
        getKeyboard(userId)
      );
    }

    // ── BALANCE ──
    if (data === "balance") {
      const result = await sheetRequest({
        action: "getBalance",
        telegram_id: userId
      });

      return bot.sendMessage(
        chatId,
        `Used: ${result.used}/${result.total}\nRemaining: ${result.remaining}`,
        getKeyboard(userId)
      );
    }

    // ── STATUS ──
    if (data === "my_status") {
      const result = await sheetRequest({
        action: "getStatus",
        telegram_id: userId
      });

      return bot.sendMessage(
        chatId,
        `Present: ${result.present}\nLeave: ${result.leave}`,
        getKeyboard(userId)
      );
    }

    // ── TEAM ──
    if (data === "team") {
      if (!isAdmin(userId))
        return bot.sendMessage(chatId, "Admin only");

      const result = await sheetRequest({ action: "getTeam" });

      return bot.sendMessage(
        chatId,
        `Present: ${result.present.length}\nLeave: ${result.leave.length}`,
        getKeyboard(userId)
      );
    }

    // ── REPORT ──
    if (data === "report") {
      if (!isAdmin(userId))
        return bot.sendMessage(chatId, "Admin only");

      const result = await sheetRequest({ action: "getReport" });

      return bot.sendMessage(
        chatId,
        `Report: ${result.month}`,
        getKeyboard(userId)
      );
    }
  } catch (err) {
    console.error("callback error:", err.message);
  }
});

// ── SERVER ──────────────────────────────────────────
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});

// ── GLOBAL ERRORS ───────────────────────────────────
process.on("unhandledRejection", console.error);
process.on("uncaughtException", console.error);