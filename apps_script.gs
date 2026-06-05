const SHEET_ID = "1nAaw2uO15X1SDfiAM9AYAssNm9iCSoqNtDgtjHawj0A";
const LEAVES_PER_MONTH = 4;

/* ---------------- ENTRY POINT ---------------- */

function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  let result;

  try {
    switch (data.action) {

      case "register":
        result = registerEmployee(data.telegram_id, data.name);
        break;

      case "markAttendance":
        result = markAttendance(data.telegram_id, data.name, data.status);
        break;

      case "getBalance":
        result = getBalance(data.telegram_id);
        break;

      case "getStatus":
        result = getStatus(data.telegram_id);
        break;

      case "getTeam":
        result = getTeam();
        break;

      case "getReport":
        result = getReport();
        break;

      case "isRegistered":
        result = isRegistered(data.telegram_id);
        break;

      default:
        result = { success: false, message: "Unknown action" };
    }

  } catch (err) {
    result = { success: false, message: err.toString() };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- SHEETS ---------------- */

function getEmployeesSheet() {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName("Employees");
}

function getAttendanceSheet() {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName("Attendance");
}

/* ---------------- REGISTER ---------------- */

function isRegistered(id) {
  const data = getEmployeesSheet().getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      return {
        success: true,
        registered: true,
        name: data[i][1]
      };
    }
  }

  return { success: true, registered: false };
}

function registerEmployee(id, name) {
  const sheet = getEmployeesSheet();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      return { success: false, message: "Already registered" };
    }
  }

  const today = Utilities.formatDate(new Date(), "Asia/Kolkata", "dd/MM/yyyy");
  sheet.appendRow([id, name, today]);

  return { success: true, message: "Registered successfully" };
}

/* ---------------- ATTENDANCE ---------------- */

function markAttendance(id, name, status) {
  const sheet = getAttendanceSheet();
  const data = sheet.getDataRange().getValues();

  const today = Utilities.formatDate(new Date(), "Asia/Kolkata", "dd/MM/yyyy");
  const now = Utilities.formatDate(new Date(), "Asia/Kolkata", "dd/MM/yyyy HH:mm:ss");

  // prevent duplicate entry per day
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id) && String(data[i][2]) === today) {
      sheet.getRange(i + 1, 4).setValue(status);
      sheet.getRange(i + 1, 5).setValue(now);
      return { success: true, status };
    }
  }

  sheet.appendRow([id, name, today, status, now]);

  return { success: true, status };
}

/* ---------------- BALANCE ---------------- */

function getBalance(id) {
  const data = getAttendanceSheet().getDataRange().getValues();

  const now = new Date();
  const cm = now.getMonth();
  const cy = now.getFullYear();

  let used = 0;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== String(id)) continue;
    if (data[i][3] !== "Leave") continue;

    const parts = String(data[i][2]).split("/");
    const d = new Date(parts[2], parts[1] - 1, parts[0]);

    if (d.getMonth() === cm && d.getFullYear() === cy) {
      used++;
    }
  }

  return {
    success: true,
    used,
    remaining: LEAVES_PER_MONTH - used,
    total: LEAVES_PER_MONTH
  };
}

/* ---------------- STATUS ---------------- */

function getStatus(id) {
  const data = getAttendanceSheet().getDataRange().getValues();

  const now = new Date();
  const cm = now.getMonth();
  const cy = now.getFullYear();

  let present = 0;
  let leave = 0;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== String(id)) continue;

    const parts = String(data[i][2]).split("/");
    const d = new Date(parts[2], parts[1] - 1, parts[0]);

    if (d.getMonth() === cm && d.getFullYear() === cy) {
      if (data[i][3] === "Present") present++;
      if (data[i][3] === "Leave") leave++;
    }
  }

  return { success: true, present, leave };
}

/* ---------------- TEAM ---------------- */

function getTeam() {
  const emp = getEmployeesSheet().getDataRange().getValues();
  const att = getAttendanceSheet().getDataRange().getValues();

  const today = Utilities.formatDate(new Date(), "Asia/Kolkata", "dd/MM/yyyy");

  const map = {};

  for (let i = 1; i < att.length; i++) {
    if (att[i][2] === today) {
      map[String(att[i][0])] = att[i][3];
    }
  }

  let present = [];
  let leave = [];
  let notMarked = [];

  for (let i = 1; i < emp.length; i++) {
    const id = String(emp[i][0]);
    const name = emp[i][1];

    const status = map[id];

    if (status === "Present") present.push(name);
    else if (status === "Leave") leave.push(name);
    else notMarked.push(name);
  }

  return {
    success: true,
    present,
    leave,
    notMarked
  };
}

/* ---------------- REPORT ---------------- */

function getReport() {
  const emp = getEmployeesSheet().getDataRange().getValues();
  const att = getAttendanceSheet().getDataRange().getValues();

  const now = new Date();
  const cm = now.getMonth();
  const cy = now.getFullYear();

  let report = [];

  for (let i = 1; i < emp.length; i++) {
    const id = String(emp[i][0]);
    const name = emp[i][1];

    let present = 0;
    let leave = 0;

    for (let j = 1; j < att.length; j++) {
      if (String(att[j][0]) !== id) continue;

      const parts = String(att[j][2]).split("/");
      const d = new Date(parts[2], parts[1] - 1, parts[0]);

      if (d.getMonth() === cm && d.getFullYear() === cy) {
        if (att[j][3] === "Present") present++;
        if (att[j][3] === "Leave") leave++;
      }
    }

    report.push({
      name,
      present,
      leave,
      remaining: LEAVES_PER_MONTH - leave
    });
  }

  return {
    success: true,
    month: now.toLocaleString("default", { month: "long" }),
    year: cy,
    report
  };
}