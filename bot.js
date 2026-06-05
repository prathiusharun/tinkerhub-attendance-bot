require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

const BOT_TOKEN = process.env.BOT_TOKEN;
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
const ADMIN_ID = String(process.env.ADMIN_TELEGRAM_ID);

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ── Helpers ───────────────────────────────────────────────────────────────────

async function sheetRequest(payload) {
  const res = await axios.post(APPS_SCRIPT_URL, payload, {
    headers: { "Content-Type": "application/json" },
    maxRedirects: 10,
  });
  return res.data;
}

function isAdmin(id) {
  return String(id) === ADMIN_ID;
}

function mainKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Present", callback_data: "mark_present" },
          { text: "🌴 Leave", callback_data: "mark_leave" },
        ],
        [
          { text: "📊 My Status", callback_data: "my_status" },
          { text: "📅 Leave Balance", callback_data: "balance" },
        ],
      ],
    },
  };
}

function adminKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Present", callback_data: "mark_present" },
          { text: "🌴 Leave", callback_data: "mark_leave" },
        ],
        [
          { text: "📊 My Status", callback_data: "my_status" },
          { text: "📅 Leave Balance", callback_data: "balance" },
        ],
        [
          { text: "👥 Team Status", callback_data: "team" },
          { text: "📋 Monthly Report", callback_data: "report" },
        ],
      ],
    },
  };
}

function getKeyboard(userId) {
  return isAdmin(userId) ? adminKeyboard() : mainKeyboard();
}

// ── /start ────────────────────────────────────────────────────────────────────

bot.onText(/\/start/, async (msg) => {
  const userId = String(msg.from.id);
  const firstName = msg.from.first_name || "there";

  const check = await sheetRequest({ action: "isRegistered", telegram_id: userId });

  if (check.registered) {
    await bot.sendMessage(
      msg.chat.id,
      `Welcome back, ${check.name}! Use the buttons below to mark your attendance.`,
      getKeyboard(userId)
    );
    return;
  }

  // New user — register them
  const name = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ");
  const result = await sheetRequest({ action: "register", telegram_id: userId, name });

  if (result.success) {
    await bot.sendMessage(
      msg.chat.id,
      `Hi ${name}, you have been registered!\n\nYou get *4 leaves per month*. Unused leaves do not carry over.\n\nUse the buttons below to mark attendance:`,
      { parse_mode: "Markdown", ...getKeyboard(userId) }
    );
  } else {
    await bot.sendMessage(msg.chat.id, "Something went wrong during registration. Please try again.");
  }
});

// ── Callback buttons ──────────────────────────────────────────────────────────

bot.on("callback_query", async (query) => {
  const userId = String(query.from.id);
  const chatId = query.message.chat.id;
  const data = query.data;
  const name = [query.from.first_name, query.from.last_name].filter(Boolean).join(" ");

  await bot.answerCallbackQuery(query.id);

  // Check registration for attendance actions
  if (["mark_present", "mark_leave", "my_status", "balance"].includes(data)) {
    const check = await sheetRequest({ action: "isRegistered", telegram_id: userId });
    if (!check.registered) {
      await bot.sendMessage(chatId, "Please register first by sending /start.");
      return;
    }
  }

  if (data === "mark_present" || data === "mark_leave") {
    const status = data === "mark_present" ? "Present" : "Leave";
    const result = await sheetRequest({ action: "markAttendance", telegram_id: userId, name, status });

    if (!result.success) {
      await bot.sendMessage(chatId, `Could not mark attendance: ${result.message}`);
      return;
    }

    const action = result.message === "updated" ? "Updated" : "Recorded";
    const emoji = status === "Present" ? "✅" : "🌴";
    await bot.sendMessage(
      chatId,
      `${emoji} *${action}:* You are marked *${status}* for today.\n\nYou can change this any time today by tapping a button below.`,
      { parse_mode: "Markdown", ...getKeyboard(userId) }
    );
  }

  else if (data === "balance") {
    const result = await sheetRequest({ action: "getBalance", telegram_id: userId });
    const bar = "🟢".repeat(result.remaining) + "⬜".repeat(result.used);
    await bot.sendMessage(
      chatId,
      `📅 *Leave Balance — This Month*\n\n${bar}\n\nUsed: ${result.used} / ${result.total}\nRemaining: *${result.remaining}*\n\n_Unused leaves do not carry over._`,
      { parse_mode: "Markdown", ...getKeyboard(userId) }
    );
  }

  else if (data === "my_status") {
    const result = await sheetRequest({ action: "getStatus", telegram_id: userId });
    const recent = result.records.slice(-5).reverse()
      .map(r => `  ${r.date} — ${r.status === "Present" ? "✅ Present" : "🌴 Leave"}`)
      .join("\n");
    await bot.sendMessage(
      chatId,
      `📊 *Your Attendance — This Month*\n\nPresent: *${result.present} days*\nLeave: *${result.leave} days*\n\n*Recent records:*\n${recent || "  No records yet."}`,
      { parse_mode: "Markdown", ...getKeyboard(userId) }
    );
  }

  else if (data === "team") {
    if (!isAdmin(userId)) {
      await bot.sendMessage(chatId, "This command is for admins only.");
      return;
    }
    const result = await sheetRequest({ action: "getTeam" });
    const fmt = (arr) => arr.length ? arr.map(n => `  • ${n}`).join("\n") : "  None";
    await bot.sendMessage(
      chatId,
      `👥 *Team Status — ${result.date}*\n\n✅ Present (${result.present.length})\n${fmt(result.present)}\n\n🌴 On Leave (${result.leave.length})\n${fmt(result.leave)}\n\n⬜ Not Marked (${result.notMarked.length})\n${fmt(result.notMarked)}`,
      { parse_mode: "Markdown", ...getKeyboard(userId) }
    );
  }

  else if (data === "report") {
    if (!isAdmin(userId)) {
      await bot.sendMessage(chatId, "This command is for admins only.");
      return;
    }
    const result = await sheetRequest({ action: "getReport" });
    const rows = result.report
      .map(e => `  ${e.name}\n    Present: ${e.present} | Leave: ${e.leave} | Remaining: ${e.remaining}`)
      .join("\n\n");
    await bot.sendMessage(
      chatId,
      `📋 *Monthly Report — ${result.month} ${result.year}*\n\n${rows || "No records yet."}`,
      { parse_mode: "Markdown", ...getKeyboard(userId) }
    );
  }
});

// ── Text commands (fallback) ──────────────────────────────────────────────────

bot.onText(/\/team/, async (msg) => {
  if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, "Admin only.");
  const result = await sheetRequest({ action: "getTeam" });
  const fmt = (arr) => arr.length ? arr.map(n => `  • ${n}`).join("\n") : "  None";
  bot.sendMessage(
    msg.chat.id,
    `👥 *Team Status — ${result.date}*\n\n✅ Present (${result.present.length})\n${fmt(result.present)}\n\n🌴 On Leave (${result.leave.length})\n${fmt(result.leave)}\n\n⬜ Not Marked (${result.notMarked.length})\n${fmt(result.notMarked)}`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/report/, async (msg) => {
  if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, "Admin only.");
  const result = await sheetRequest({ action: "getReport" });
  const rows = result.report
    .map(e => `  ${e.name}\n    Present: ${e.present} | Leave: ${e.leave} | Remaining: ${e.remaining}`)
    .join("\n\n");
  bot.sendMessage(
    msg.chat.id,
    `📋 *Monthly Report — ${result.month} ${result.year}*\n\n${rows || "No records yet."}`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/balance/, async (msg) => {
  const userId = String(msg.from.id);
  const result = await sheetRequest({ action: "getBalance", telegram_id: userId });
  const bar = "🟢".repeat(result.remaining) + "⬜".repeat(result.used);
  bot.sendMessage(
    msg.chat.id,
    `📅 *Leave Balance*\n\n${bar}\nUsed: ${result.used} / ${result.total}\nRemaining: *${result.remaining}*`,
    { parse_mode: "Markdown" }
  );
});

console.log("TinkerHub Attendance Bot is running...");
