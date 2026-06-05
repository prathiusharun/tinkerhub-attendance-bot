const rawDate = data[i][2];

// force correct parsing for dd/MM/yyyy
const parts = String(rawDate).split("/");

const day = parseInt(parts[0]);
const monthVal = parseInt(parts[1]) - 1;
const yearVal = parseInt(parts[2]);

if (monthVal === month && yearVal === year) {
  leavesUsed++;
}