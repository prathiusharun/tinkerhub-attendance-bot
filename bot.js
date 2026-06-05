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
  NODE_ENV: process.env.NODE_ENV
});

const BOT_TOKEN = process.env.BOT_TOKEN;
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
const ADMIN_ID = String(process.env.ADMIN_TELEGRAM_ID);

if (!BOT_TOKEN) throw new Error("BOT_TOKEN missing");
if (!APPS_SCRIPT_URL) throw new Error("APPS_SCRIPT_URL missing");
if (!ADMIN_ID) throw new Error("ADMIN_TELEGRAM_ID missing");

// ── BOT (POLLING ONLY - SIMPLE & STABLE) ─────────────
const bot = new TelegramBot(BOT_TOKEN, {
  polling: true
});

bot.on("polling_error", (err) => {
  console.error("Polling error:", err.message);
});

// ── EXPRESS (KEEP ALIVE FOR RENDER) ─────────────────
const app = express();

app.get("/", (req, res) => {
  res.send("TinkerHub Attendance Bot is running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});

// ── HELPERS ─────────────────────────────────────────
async function sheetRequest(payload) {
  try {
    const res = await axios.post(APPS_SCRIPT_URL, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 10000
    });
    console.log("RAW RESPONSE FROM APPS SCRIPT:", res.data);

    return res.data;
  } catch (err) {
    console.error("Sheet error:", err.message);
    return { success: false, message: "Sheet request failed" };
  }
}

const isAdmin = (id) => String(id) === ADMIN_ID;

// ── KEYBOARDS ───────────────────────────────────────
function keyboard(isAdminUser) {
  const base = [
    [
      { text: "✅ Present", callback_data: "mark_present" },
      { text: "🌴 Leave", callback_data: "mark_leave" }
    ],
    [
      { text: "📊 My Status", callback_data: "my_status" },
      { text: "📅 Leave Balance", callback_data: "balance" }
    ]
  ];

  if (isAdminUser) {
    base.push([
      { text: "👥 Team Status", callback_data: "team" },
      { text: "📋 Monthly Report", callback_data: "report" }
    ]);
  }

  return { reply_markup: { inline_keyboard: base } };
}

// ── START ───────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  const userId = String(msg.from.id);
  const name = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ");

  const check = await sheetRequest({
    action: "isRegistered",
    telegram_id: userId
  });

  if (check.registered) {
    return bot.sendMessage(
      msg.chat.id,
      `Welcome back, ${check.name}!`,
      keyboard(isAdmin(userId))
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
      keyboard(isAdmin(userId))
    );
  }

  bot.sendMessage(msg.chat.id, "Registration failed.");
});

// ── CALLBACKS ───────────────────────────────────────
bot.on("callback_query", async (query) => {
  try {
    const userId = String(query.from.id);
    const chatId = query.message.chat.id;
    const data = query.data;

    await bot.answerCallbackQuery(query.id);

    const name = [query.from.first_name, query.from.last_name].filter(Boolean).join(" ");

    const requiresReg = ["mark_present", "mark_leave", "my_status", "balance"];

    if (requiresReg.includes(data)) {
      const check = await sheetRequest({
        action: "isRegistered",
        telegram_id: userId
      });

      if (!check.registered) {
        return bot.sendMessage(chatId, "Please register first using /start");
      }
    }

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
        result.success ? `Marked ${status}` : "Failed to mark",
        keyboard(isAdmin(userId))
      );
    }

    if (data === "balance") {
      const r = await sheetRequest({ action: "getBalance", telegram_id: userId });

      return bot.sendMessage(
        chatId,
        `Used: ${r.used}/${r.total}\nRemaining: ${r.remaining}`,
        keyboard(isAdmin(userId))
      );
    }

    if (data === "my_status") {
      const r = await sheetRequest({ action: "getStatus", telegram_id: userId });

      return bot.sendMessage(
        chatId,
        `Present: ${r.present}\nLeave: ${r.leave}`,
        keyboard(isAdmin(userId))
      );
    }

    if (data === "team") {
      if (!isAdmin(userId)) return bot.sendMessage(chatId, "Admin only");

      const r = await sheetRequest({ action: "getTeam" });

      return bot.sendMessage(
        chatId,
        `Present: ${r.present.length}\nLeave: ${r.leave.length}`,
        keyboard(true)
      );
    }

    if (data === "report") {
      if (!isAdmin(userId)) return bot.sendMessage(chatId, "Admin only");

      const r = await sheetRequest({ action: "getReport" });

      return bot.sendMessage(
        chatId,
        `Report: ${r.month}`,
        keyboard(true)
      );
    }
  } catch (err) {
    console.error("Callback error:", err.message);
  }
});

// ── GLOBAL SAFETY ───────────────────────────────────
process.on("unhandledRejection", console.error);
process.on("uncaughtException", console.error);