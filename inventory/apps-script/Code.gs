/**
 * 庫存查詢：共用的數量回報
 *
 * 用法（只要做一次）：
 * 1. 建一個 Google 試算表，選「擴充功能 → Apps Script」。
 * 2. 把這整份程式貼上去，取代原本的內容。
 * 3. 把下面的 PASSWORD 改成公司密碼（和手機輸入的一樣）。
 * 4. 按「部署 → 新增部署作業 → 網頁應用程式」，
 *    執行身分選「我」，誰可以存取選「所有人」，按「部署」。
 * 5. 把產生的網址（https://script.google.com/macros/s/.../exec）
 *    填到 inventory/config.js 的 REPORT_API。
 *
 * 回報會寫在試算表的「回報」工作表；按 ✕ 劃掉的只改狀態，不會刪除。
 */
const PASSWORD = '在這裡填公司密碼';

const SHEET = '回報';
const COLS = ['id', '時間', '編號', '品名', '倉別', '系統數量', '實際數量', '原因', '備註', '報表日期', '狀態', '處理時間'];
const OPEN = '未處理', DONE = '已處理';

function doGet() {
  return out_({ ok: true, hello: '庫存回報' });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'bad request' }); }
  if (String(req.pass) !== PASSWORD) return out_({ ok: false, error: 'badpass' });
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = sheet_();
    if (req.action === 'add') {
      const r = req.report || {};
      sh.appendRow([Utilities.getUuid().slice(0, 8), new Date(), str_(r.code), str_(r.name), str_(r.wh),
        num_(r.sys), num_(r.actual), str_(r.reason), str_(r.note), str_(r.dataDate), OPEN, '']);
    } else if (req.action === 'done' || req.action === 'reopen') {
      const ids = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues();
      const i = ids.findIndex(row => String(row[0]) === String(req.id));
      if (i >= 0) sh.getRange(i + 2, 11, 1, 2).setValues([[req.action === 'done' ? DONE : OPEN, req.action === 'done' ? new Date() : '']]);
    }
    return out_({ ok: true, reports: list_(sh) });
  } finally {
    lock.releaseLock();
  }
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET);
  if (!sh) { sh = ss.insertSheet(SHEET); sh.appendRow(COLS); sh.setFrozenRows(1); }
  return sh;
}

// 只回傳「未處理」的回報
function list_(sh) {
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, COLS.length).getValues()
    .filter(r => r[0] && r[10] === OPEN)
    .map(r => ({ id: String(r[0]), at: r[1] instanceof Date ? r[1].toISOString() : String(r[1]),
      code: String(r[2]), name: String(r[3]), wh: String(r[4]), sys: Number(r[5]), actual: Number(r[6]),
      reason: String(r[7]), note: String(r[8]), dataDate: String(r[9]) }));
}

// 文字最多 200 字；開頭是 = + - @ 的加上 ' 當成文字，避免被當成公式
function str_(v) {
  const s = String(v == null ? '' : v).slice(0, 200);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
function num_(v) { const n = Number(v); return isFinite(n) ? n : ''; }
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
