const SHEET_ID = "1nAaw2uO15X1SDfiAM9AYAssNm9iCSoqNtDgtjHawj0A";
const LEAVES_PER_MONTH = 4;

/* ---------------- UTIL ---------------- */

function todayStr() {
  return Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd");
}

function nowStr() {
  return Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd HH:mm:ss");
}

function normalizeDate(value) {
  if (!value) return "";

  if (Object.prototype.toString.call(value) === "[object Date]") {
    return Utilities.formatDate(value, "Asia/Kolkata", "yyyy-MM-dd");
  }

  try {
    return Utilities.formatDate(new Date(value), "Asia/Kolkata", "yyyy-MM-dd");
  } catch (e) {
    return String(value);
  }
}

function findTodayRow(sheet, id, today) {
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const rowId = String(data[i][0]);
    const rowDate = normalizeDate(data[i][2]);

    if (rowId === String(id) && rowDate === today) {
      return i + 1;
    }
  }
  return -1;
}

/* ---------------- ENTRY POINT ---------------- */

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    let result;

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

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: err.toString()
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
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

  sheet.appendRow([id, name, todayStr()]);

  return {
    success: true,
    message: "Registered successfully"
  };
}

/* ---------------- ATTENDANCE ---------------- */

function markAttendance(id, name, status) {
  const sheet = getAttendanceSheet();

  const today = todayStr();
  const now = nowStr();

  const rowIndex = findTodayRow(sheet, id, today);

  // If record exists
  if (rowIndex !== -1) {
    const existingStatus = sheet.getRange(rowIndex, 4).getValue();

    if (existingStatus === status) {
      return {
        success: true,
        message: "Already marked as " + status,
        status
      };
    }

    sheet.getRange(rowIndex, 4).setValue(status);
    sheet.getRange(rowIndex, 5).setValue(now);

    return {
      success: true,
      message: "Updated to " + status,
      status
    };
  }

  sheet.appendRow([id, name, today, status, now]);

  return {
    success: true,
    message: "Marked " + status,
    status
  };
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

    const d = new Date(normalizeDate(data[i][2]));

    if (d.getMonth() === cm && d.getFullYear() === cy) {
      used++;
    }
  }

  return {
    success: true,
    used,
    remaining: LEAVES_PER_MONTH - used,
    total: LEAVES_PER_MONTH,
    message: `Leave: ${used}/${LEAVES_PER_MONTH}, Remaining: ${LEAVES_PER_MONTH - used}`
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

    const d = new Date(normalizeDate(data[i][2]));

    if (d.getMonth() === cm && d.getFullYear() === cy) {
      if (data[i][3] === "Present") present++;
      if (data[i][3] === "Leave") leave++;
    }
  }

  return {
    success: true,
    present,
    leave,
    message: `Present: ${present}, Leave: ${leave}`
  };
}

/* ---------------- TEAM ---------------- */

function getTeam() {
  const emp = getEmployeesSheet().getDataRange().getValues();
  const att = getAttendanceSheet().getDataRange().getValues();

  const today = todayStr();

  const map = {};

  for (let i = 1; i < att.length; i++) {
    const rowDate = normalizeDate(att[i][2]);

    if (rowDate === today) {
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

      const d = new Date(normalizeDate(att[j][2]));

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