/**
 * 庫存查詢：共用的庫存資料、數量回報、備料清單與盤點
 *
 * 第一次設定：
 * 1. 建一個 Google 試算表，選「擴充功能 → Apps Script」。
 * 2. 把這整份程式貼上去，取代原本的內容。
 * 3. 把下面的 PASSWORD 改成公司密碼（和手機輸入的一樣）。
 * 4. 按「部署 → 新增部署作業 → 網頁應用程式」，
 *    執行身分選「我」，誰可以存取選「所有人」，按「部署」。
 * 5. 把產生的網址（https://script.google.com/macros/s/.../exec）
 *    填到 inventory/config.js 的 REPORT_API。
 *
 * 之後更新程式（網址不變）：
 *   貼上新程式、改好 PASSWORD、存檔 →「部署 → 管理部署作業」→ 鉛筆圖示 →
 *   版本選「新版本」→「部署」。不要用「新增部署作業」，那會產生新網址。
 *
 * 庫存資料（電腦上傳頁按「上傳」，已用公司密碼加密）存在「庫存資料」工作表，
 * 回報寫在「回報」工作表，備料寫在「備料」工作表，盤點寫在「盤點」工作表。
 * 按 ✕ 或清掉的只改狀態，不會刪除列。
 * 備料的「客戶」欄會存客戶名稱：試算表只在擁有者的 Google 帳號裡，
 * 客戶資料絕對不要放進 GitHub。
 */
const PASSWORD = '在這裡填公司密碼';

const REPORT = { name: '回報', cols: ['id', '時間', '編號', '品名', '倉別', '系統數量', '實際數量', '原因', '備註', '報表日期', '狀態', '處理時間'] };
const PICK = { name: '備料', cols: ['id', '時間', '客戶', '編號', '品名', '數量', '狀態', '處理時間'] };
const COUNT = { name: '盤點', cols: ['id', '時間', '倉別', '編號', '品名', '系統數量', '實盤數量', '報表日期', '狀態', '結束時間'] };
const COUNTING = '盤點中', FINISHED = '已結束';  // 盤點
const DATA_SHEET = '庫存資料', CHUNK = 45000;   // 加密後的資料很長，一格最多 5 萬字，分段存
const OPEN = '未處理', DONE = '已處理';           // 回報
const TODO = '未備', READY = '已備', GONE = '清掉'; // 備料

function doGet() {
  return out_({ ok: true, hello: '庫存回報', version: 5 });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'bad request' }); }
  // 讀庫存資料不用密碼：資料本身已經加密，手機要先拿到檔案才能請使用者輸入密碼
  if (req.action === 'dataGet') return out_({ ok: true, version: 5, file: dataGet_() });
  if (String(req.pass) !== PASSWORD) return out_({ ok: false, error: 'badpass' });
  if (req.action === 'dataPut') {
    const f = req.file;
    if (!f || f.format !== 'inventory-data' || !f.data) return out_({ ok: false, error: 'bad file' });
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try { dataPut_(JSON.stringify(f)); } finally { lock.releaseLock(); }
    const back = dataGet_();
    return out_({ ok: true, version: 5, saved: !!back && back.uploadedAt === f.uploadedAt, date: f.date, count: f.count, uploadedAt: f.uploadedAt });
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const rs = sheet_(REPORT), ps = sheet_(PICK), cs = sheet_(COUNT);
    const a = req.action;
    if (a === 'add') {
      const r = req.report || {};
      rs.appendRow([id_(), new Date(), text_(r.code), str_(r.name), text_(r.wh),
        num_(r.sys), num_(r.actual), str_(r.reason), str_(r.note), text_(r.dataDate), OPEN, '']);
    } else if (a === 'done' || a === 'reopen') {
      setStatus_(rs, req.id, 11, a === 'done' ? DONE : OPEN);
    } else if (a === 'pickAdd') {
      const p = req.pick || {};
      ps.appendRow([id_(), new Date(), str_(p.customer), text_(p.code), str_(p.name), num_(p.qty), TODO, '']);
    } else if (a === 'pickSet') {
      // status：未備／已備／清掉
      if ([TODO, READY, GONE].indexOf(req.status) >= 0) setStatus_(ps, req.id, 7, req.status);
    } else if (a === 'pickRename') {
      // 改客戶名稱：還沒清掉的備料，客戶是 from 的全部改成 to
      const rows = all_(ps), to = str_(req.to);
      rows.forEach((r, i) => {
        if ((r[6] === TODO || r[6] === READY) && String(r[2]) === String(req.from)) ps.getRange(i + 2, 3).setValue(to);
      });
    } else if (a === 'pickQty') {
      // 改要備的數量
      const rows = all_(ps), n = num_(req.qty);
      const i = rows.findIndex(r => String(r[0]) === String(req.id));
      if (i >= 0 && n !== '' && n > 0) ps.getRange(i + 2, 6).setValue(n);
    } else if (a === 'countSet') {
      // 記下實盤數量：同一個倉、同一個編號、還在盤點中的只留一筆（後面輸入的蓋過前面的）
      const c = req.count || {}, rows = all_(cs);
      const i = rows.findIndex(r => r[8] === COUNTING && String(r[2]) === String(c.wh) && String(r[3]) === String(c.code));
      const vals = [new Date(), text_(c.wh), text_(c.code), str_(c.name), num_(c.sys), num_(c.actual), text_(c.dataDate)];
      if (i >= 0) cs.getRange(i + 2, 2, 1, 7).setValues([vals]);
      else cs.appendRow([id_()].concat(vals, [COUNTING, '']));
    } else if (a === 'countClear') {
      // 取消某一項的盤點數字（打錯了）
      const rows = all_(cs);
      const i = rows.findIndex(r => r[8] === COUNTING && String(r[2]) === String(req.wh) && String(r[3]) === String(req.code));
      if (i >= 0) cs.getRange(i + 2, 9, 1, 2).setValues([['取消', new Date()]]);
    } else if (a === 'countFinish') {
      // 結束這個倉這次的盤點：紀錄留在試算表，App 上從頭開始
      const rows = all_(cs);
      rows.forEach((r, i) => { if (r[8] === COUNTING && String(r[2]) === String(req.wh)) cs.getRange(i + 2, 9, 1, 2).setValues([[FINISHED, new Date()]]); });
    } else if (a === 'pickClearReady') {
      // 把某個客戶（或全部）已備好的清掉
      const rows = all_(ps);
      rows.forEach((r, i) => {
        if (r[6] === READY && (req.customer == null || String(r[2]) === String(req.customer)))
          ps.getRange(i + 2, 7, 1, 2).setValues([[GONE, new Date()]]);
      });
    }
    return out_({ ok: true, version: 5, reports: reports_(rs), picks: picks_(ps), counts: counts_(cs) });
  } finally {
    lock.releaseLock();
  }
}

// 加密後的庫存資料：分成好幾格存在 A 欄
function dataPut_(text) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(DATA_SHEET) || ss.insertSheet(DATA_SHEET);
  sh.clear();
  const parts = [];
  for (let i = 0; i < text.length; i += CHUNK) parts.push([text.slice(i, i + CHUNK)]);
  sh.getRange(1, 1, parts.length, 1).setNumberFormat('@').setValues(parts);
}
function dataGet_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DATA_SHEET);
  if (!sh || sh.getLastRow() < 1) return null;
  const text = sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map(r => r[0]).join('');
  try { return JSON.parse(text); } catch (e) { return null; }
}

function sheet_(def) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(def.name);
  if (!sh) { sh = ss.insertSheet(def.name); sh.appendRow(def.cols); sh.setFrozenRows(1); }
  return sh;
}
function all_(sh) {
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
}
function setStatus_(sh, id, col, status) {
  const rows = all_(sh);
  const i = rows.findIndex(r => String(r[0]) === String(id));
  if (i >= 0) sh.getRange(i + 2, col, 1, 2).setValues([[status, new Date()]]);
}
const iso_ = v => v instanceof Date ? v.toISOString() : String(v);

// 只回傳「未處理」的回報
function reports_(sh) {
  return all_(sh).filter(r => r[0] && r[10] === OPEN)
    .map(r => ({ id: String(r[0]), at: iso_(r[1]), code: String(r[2]), name: String(r[3]),
      wh: String(r[4]).padStart(2, '0'), sys: Number(r[5]), actual: Number(r[6]),
      reason: String(r[7]), note: String(r[8]), dataDate: String(r[9]) }));
}
// 回傳「未備」與「已備」的備料（清掉的不回傳）
function picks_(sh) {
  return all_(sh).filter(r => r[0] && (r[6] === TODO || r[6] === READY))
    .map(r => ({ id: String(r[0]), at: iso_(r[1]), customer: String(r[2]), code: String(r[3]),
      name: String(r[4]), qty: Number(r[5]), done: r[6] === READY }));
}

// 還在盤點中的數字
function counts_(sh) {
  return all_(sh).filter(r => r[0] && r[8] === COUNTING)
    .map(r => ({ id: String(r[0]), at: iso_(r[1]), wh: String(r[2]).padStart(2, '0'), code: String(r[3]), name: String(r[4]),
      sys: Number(r[5]), actual: Number(r[6]) }));
}

function id_() { return Utilities.getUuid().slice(0, 8); }
// 文字最多 200 字；開頭是 = + - @ 的加上 ' 當成文字，避免被當成公式
function str_(v) {
  const s = String(v == null ? '' : v).slice(0, 200);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
// 一定存成文字（例如倉別 06、日期 2026-11-24），不讓試算表自動轉成數字或日期
function text_(v) { return "'" + String(v == null ? '' : v).slice(0, 200); }
function num_(v) { const n = Number(v); return isFinite(n) ? n : ''; }
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
