'use strict';
// 庫存查詢共用：讀報表（PDF／Excel）與資料檔加密。上傳頁（upload.html）與查詢頁（index.html）都會用到。
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
const DATA_FILE = 'inventory-data.json';   // 放在 inventory/ 資料夾，手機從這裡同步

function loadScript(src) {
  return new Promise((ok, fail) => {
    if (document.querySelector(`script[src="${src}"]`)) return ok();
    const s = document.createElement('script'); s.src = src; s.onload = ok;
    s.onerror = () => fail(new Error('載入失敗：' + src)); document.head.appendChild(s);
  });
}
/* ---------- 解析：PDF（存貨異動統計表-分倉） ---------- */
// 一頁的文字依 y 座標分行，每行依 x 排序。
// 每行第一段是產品編號；右邊的數字依位置分成「結存數量」與「單重」；其餘是品名規格。
function parseReportPages(pages) {
  const rows = [], whNames = {}; let wh = null, date = null, cols = null, skipped = 0;
  for (const items of pages) {
    const lines = [];
    for (const it of items) {
      if (!it.str.trim()) continue;
      let L = lines.find(l => Math.abs(l.y - it.y) <= 2);
      if (!L) { L = { y: it.y, items: [] }; lines.push(L); }
      L.items.push(it);
    }
    lines.sort((a, b) => b.y - a.y); lines.forEach(l => l.items.sort((a, b) => a.x - b.x));
    let inBody = false;
    for (const l of lines) {
      const text = l.items.map(i => i.str).join(' ').replace(/\s+/g, ' ');
      let m;
      if ((m = text.match(/列印日期\s*[:：]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/)))
        date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
      if ((m = text.match(/倉庫名稱\s*[:：]\s*(.+?)\s*[(（]\s*([0-9A-Za-z]+)\s*[)）]/))) {
        wh = m[2]; whNames[wh] = m[1].trim(); continue;
      }
      if (/產品編號/.test(text) && /品名/.test(text)) {
        const f = re => l.items.find(i => re.test(i.str));
        const q = f(/結存|數量/), w = f(/單重/);
        cols = { qtyX: q ? q.x : 430, wtX: w ? w.x : 510 }; inBody = true; continue;
      }
      if (!inBody || !cols || /合\s*計|總\s*計/.test(text)) continue;
      const first = l.items[0];
      if (!/^[A-Za-z0-9]/.test(first.str.trim())) { skipped++; continue; }
      let qty = null, wt = null, name = '', prevEnd = null;
      for (const it of l.items.slice(1)) {
        const s = it.str.trim(), right = it.x + it.w;
        if (/^-?[\d,]+(\.\d+)?$/.test(s) && right > cols.qtyX) {
          const v = parseFloat(s.replace(/,/g, ''));
          if (right > cols.wtX) wt = v; else qty = v;
        } else {
          // 兩段字之間有明顯空隙才補空白（pdf.js 會把中英文切成好幾段）
          name += (prevEnd != null && it.x - prevEnd > 3 ? ' ' : '') + s;
          prevEnd = right;
        }
      }
      if (qty === null) { skipped++; continue; }
      rows.push([wh || '?', first.str.trim(), name.replace(/\s+/g, ' ').trim(), qty, wt]);
    }
  }
  return { rows, whNames, date, skipped };
}
async function readPdf(buf) {
  await loadScript(PDFJS);
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    pages.push(tc.items.map(i => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width })));
  }
  return parseReportPages(pages);
}

/* ---------- 解析：Excel／CSV ---------- */
// 找標題列（有「編號」和「品名」的那一列）決定欄位；
// 支援報表式（「倉庫名稱:新品倉 (02)」分段）與表格式（有「倉別」欄）。
function parseSheetRows(allRows) {
  const rows = [], whNames = {}; let wh = null, date = null, col = null, skipped = 0;
  const find = (cells, re) => cells.findIndex(c => re.test(String(c).replace(/\s+/g, '')));
  for (const raw of allRows) {
    const cells = raw.map(c => c == null ? '' : String(c).trim());
    const text = cells.join(' ');
    if (!text.trim()) continue;
    let m;
    if ((m = text.match(/列印日期\s*[:：]?\s*(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/)))
      date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    if ((m = text.match(/倉庫名稱\s*[:：]?\s*(.+?)\s*[(（]\s*([0-9A-Za-z]+)\s*[)）]/))) {
      wh = m[2]; whNames[wh] = m[1].trim(); continue;
    }
    // ERP 匯出的 Excel：「倉庫名稱:」和「新品倉(02)」在不同格（甚至不同列）
    const whCell = cells.map(c => c.match(/^(\S{1,12}?倉)\s*[(（]\s*([0-9A-Za-z]+)\s*[)）]$/)).find(Boolean);
    if (whCell) { wh = whCell[2]; whNames[wh] = whCell[1]; continue; }
    const iCode = find(cells, /^(產品編號|產品代號|料號|品號|編號)$/), iName = find(cells, /品名/);
    if (iCode >= 0 && iName >= 0) {
      col = {
        code: iCode, name: iName,
        spec: find(cells, /^規格$/),
        qty: find(cells, /結存|庫存數|現有|數量/),
        wt: find(cells, /單重/),
        wh: find(cells, /^(倉別|倉庫|倉庫代號|倉庫名稱)$/),
      };
      continue;
    }
    if (!col || /合\s*計|總\s*計/.test(text)) continue;
    const code = cells[col.code];
    if (!code) continue;                                   // 頁首、空白列
    if (!/^[A-Za-z0-9]/.test(code)) { skipped++; continue; }
    const num = v => { const n = parseFloat(String(v).replace(/,/g, '')); return isNaN(n) ? null : n; };
    const qty = col.qty >= 0 ? num(cells[col.qty]) : null;
    if (qty === null) { skipped++; continue; }
    let w = wh;
    if (col.wh >= 0 && cells[col.wh]) {
      const v = cells[col.wh], mm = v.match(/\d+/);
      w = mm ? mm[0].padStart(2, '0') : v;
      const nm = v.replace(/[(（]?\s*\d+\s*[)）]?/, '').trim();
      if (nm && !whNames[w]) whNames[w] = nm;
    }
    // 規格（熱浸、鍍鋅…）有時在沒有標題的欄位：品名和數量之間有字的格子都接起來
    const specs = col.spec >= 0 ? [cells[col.spec]]
      : cells.slice(col.name + 1, col.qty >= 0 ? col.qty : undefined).filter(c => c && c !== cells[col.code]);
    const name = [cells[col.name], ...specs].filter(Boolean).join(' ');
    rows.push([w || '?', code, name, qty, col.wt >= 0 ? num(cells[col.wt]) : null]);
  }
  return { rows, whNames, date, skipped };
}
async function readSheet(buf) {
  await loadScript(XLSX_URL);
  const wb = XLSX.read(buf, { type: 'array' });
  let all = [];
  for (const n of wb.SheetNames) all = all.concat(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' }));
  return parseSheetRows(all);
}

/* ---------- 讀檔：自動判斷 PDF 或 Excel ---------- */
async function readReportFile(f) {
  const buf = new Uint8Array(await f.arrayBuffer());
  const isPdf = /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
  const r = isPdf ? await readPdf(buf) : await readSheet(buf);
  const d = new Date(f.lastModified || Date.now());
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { date: r.date || iso, dateSource: r.date ? '列印日期' : '檔案日期', file: f.name, wh: r.whNames, rows: r.rows, skipped: r.skipped };
}

/* ---------- 加密：倉庫是公開的，資料檔一定要加密 ---------- */
// PBKDF2（SHA-256）把密碼變成金鑰，再用 AES-GCM 加密。檔案裡只有日期和筆數是明碼。
const toB64 = buf => { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function deriveKey(pass, salt, iter) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function encryptData(obj, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), iter = 200000;
  const key = await deriveKey(pass, salt, iter);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { format: 'inventory-data', v: 1, kdf: 'PBKDF2-SHA256', iter, cipher: 'AES-256-GCM',
    salt: toB64(salt), iv: toB64(iv), date: obj.date, count: obj.rows.length, uploadedAt: obj.uploadedAt, data: toB64(ct) };
}
async function decryptData(file, pass) {
  if (!file || file.format !== 'inventory-data') throw new Error('資料檔格式不對');
  const key = await deriveKey(pass, fromB64(file.salt), file.iter);
  let pt;
  try { pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(file.iv) }, key, fromB64(file.data)); }
  catch (e) { const err = new Error('密碼不對'); err.badPassword = true; throw err; }
  return JSON.parse(new TextDecoder().decode(pt));
}
