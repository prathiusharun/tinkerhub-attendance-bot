const SHEET_ID = "1nAaw2uO15X1SDfiAM9AYAssNm9iCSoqNtDgtjHawj0A";
const ADMIN_TELEGRAM_ID = PropertiesService.getScriptProperties().getProperty("ADMIN_TELEGRAM_ID");
const LEAVES_PER_MONTH = 4;

function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const action = data.action;
  let result;

  try {
    if (action === "register")         result = registerEmployee(data.telegram_id, data.name);
    else if (action === "markAttendance") result = markAttendance(data.telegram_id, data.name, data.status);
    else if (action === "getBalance")   result = getBalance(data.telegram_id);
    else if (action === "getStatus")    result = getStatus(data.telegram_id);
    else if (action === "getTeam")      result = getTeam();
    else if (action === "getReport")    result = getReport();
    else if (action === "isRegistered") result = isRegistered(data.telegram_id);
    else result = { success: false, message: "Unknown action" };
  } catch (err) {
    result = { success: false, message: err.toString() };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: "ok" }))
    .setMimeType(ContentService.MimeType.JSON);
}

function getEmployeesSheet() {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName("Employees");
}

function getAttendanceSheet() {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName("Attendance");
}

function isRegistered(telegram_id) {
  const sheet = getEmployeesSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(telegram_id)) {
      return { success: true, registered: true, name: data[i][1] };
    }
  }
  return { success: true, registered: false };
}

function registerEmployee(telegram_id, name) {
  const sheet = getEmployeesSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(telegram_id)) {
      return { success: false, message: "Already registered" };
    }
  }
  const today = Utilities.formatDate(new Date(), "Asia/Kolkata", "dd/MM/yyyy");
  sheet.appendRow([telegram_id, name, today]);
  return { success: true, message: "Registered successfully" };
}

function markAttendance(telegram_id, name, status) {
  const sheet = getAttendanceSheet();
  const today = Utilities.formatDate(new Date(), "Asia/Kolkata", "dd/MM/yyyy");
  const now = Utilities.formatDate(new Date(), "Asia/Kolkata", "dd/MM/yyyy HH:mm:ss");
  const data = sheet.getDataRange().getValues();

  // Check leave balance before marking leave
  if (status === "Leave") {
    const balance = getBalance(telegram_id);
    if (balance.remaining <= 0) {
      return { success: false, message: "No leave balance remaining for this month." };
    }
  }

  // Idempotent: update existing record if found for today
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(telegram_id) && data[i][2] === today) {
      sheet.getRange(i + 1, 4).setValue(status);
      sheet.getRange(i + 1, 5).setValue(now);
      return { success: true, message: "updated", status: status };
    }
  }

  // New record
  sheet.appendRow([telegram_id, name, today, status, now]);
  return { success: true, message: "recorded", status: status };
}

function getBalance(telegram_id) {
  const sheet = getAttendanceSheet();
  const data = sheet.getDataRange().getValues();
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  let leavesUsed = 0;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(telegram_id) && data[i][3] === "Leave") {
      const parts = String(data[i][2]).split("/");
      const rowMonth = parseInt(parts[1]) - 1;
      const rowYear = parseInt(parts[2]);
      if (rowMonth === month && rowYear === year) leavesUsed++;
    }
  }

  return {
    success: true,
    used: leavesUsed,
    remaining: LEAVES_PER_MONTH - leavesUsed,
    total: LEAVES_PER_MONTH
  };
}

function getStatus(telegram_id) {
  const sheet = getAttendanceSheet();
  const data = sheet.getDataRange().getValues();
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  let presentDays = 0, leaveDays = 0, records = [];

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(telegram_id)) {
      const parts = String(data[i][2]).split("/");
      const rowMonth = parseInt(parts[1]) - 1;
      const rowYear = parseInt(parts[2]);
      if (rowMonth === month && rowYear === year) {
        if (data[i][3] === "Present") presentDays++;
        else if (data[i][3] === "Leave") leaveDays++;
        records.push({ date: data[i][2], status: data[i][3] });
      }
    }
  }

  return { success: true, present: presentDays, leave: leaveDays, records };
}

function getTeam() {
  const empSheet = getEmployeesSheet();
  const attSheet = getAttendanceSheet();
  const today = Utilities.formatDate(new Date(), "Asia/Kolkata", "dd/MM/yyyy");

  const employees = empSheet.getDataRange().getValues();
  const attendance = attSheet.getDataRange().getValues();

  // Build today's attendance map
  const todayMap = {};
  for (let i = 1; i < attendance.length; i++) {
    if (attendance[i][2] === today) {
      todayMap[String(attendance[i][0])] = attendance[i][3];
    }
  }

  let present = [], leave = [], notMarked = [];
  for (let i = 1; i < employees.length; i++) {
    const id = String(employees[i][0]);
    const name = employees[i][1];
    const status = todayMap[id];
    if (status === "Present") present.push(name);
    else if (status === "Leave") leave.push(name);
    else notMarked.push(name);
  }

  return { success: true, date: today, present, leave, notMarked };
}

function getReport() {
  const empSheet = getEmployeesSheet();
  const attSheet = getAttendanceSheet();
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();

  const employees = empSheet.getDataRange().getValues();
  const attendance = attSheet.getDataRange().getValues();

  const report = [];
  for (let i = 1; i < employees.length; i++) {
    const id = String(employees[i][0]);
    const name = employees[i][1];
    let presentDays = 0, leaveDays = 0;

    for (let j = 1; j < attendance.length; j++) {
      if (String(attendance[j][0]) === id) {
        const parts = String(attendance[j][2]).split("/");
        const rowMonth = parseInt(parts[1]) - 1;
        const rowYear = parseInt(parts[2]);
        if (rowMonth === month && rowYear === year) {
          if (attendance[j][3] === "Present") presentDays++;
          else if (attendance[j][3] === "Leave") leaveDays++;
        }
      }
    }

    report.push({
      name,
      present: presentDays,
      leave: leaveDays,
      remaining: LEAVES_PER_MONTH - leaveDays
    });
  }

  const monthName = now.toLocaleString("default", { month: "long" });
  return { success: true, month: monthName, year, report };
}
