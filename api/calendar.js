const crypto = require('node:crypto');

const SHEET_ID = process.env.SHEET_ID || '1W9GYhuTBgsJPN8b2SNHViPKZkyv0LGth66-MLEjLMZ4';
const SHEET_GID = process.env.SHEET_GID || '2000484438';

function parseCSV(input) {
  const out = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(cell); out.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (quoted) throw new Error('Malformed CSV: unmatched quote');
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).json({ok:false,message:'Method not allowed'});
  const sourceUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${encodeURIComponent(SHEET_GID)}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    let response;
    try { response = await fetch(sourceUrl, {redirect:'follow',cache:'no-store',signal:controller.signal}); }
    finally { clearTimeout(timeout); }
    if (!response.ok) throw new Error(`Google returned HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    const csv = await response.text();
    if (/html/i.test(contentType) || /^\s*</.test(csv)) throw new Error('Google returned a sign-in or error page, not CSV');
    const matrix = parseCSV(csv.replace(/^\uFEFF/, ''));
    const headerIndex = matrix.findIndex(r => r.some(x=>String(x).trim()==='Institution') && r.some(x=>String(x).trim()==='Exam Date'));
    if (headerIndex < 0) throw new Error('Expected admission-calendar headers not found');
    const header = matrix[headerIndex].map(x=>String(x).trim());
    const col = name => header.indexOf(name);
    const expected = ['Institution','Unit / Program','Exam Date','Exam Day','Application Start','Application End'];
    if (expected.some(x=>col(x)<0)) throw new Error('The sheet columns changed; cannot safely interpret dates');
    const rows = matrix.slice(headerIndex + 1).filter(r=>r[col('Institution')] && r[col('Exam Date')])
      .map(r=>expected.map(k=>String(r[col(k)]??'').trim()||null));
    if (!rows.length) throw new Error('Google returned no admission events');
    const hash = crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    res.setHeader('Cache-Control','no-store, max-age=0');
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.status(200).json({ok:true,source:'live-google-sheet',title:matrix[0]?.[0]||'Bangladesh University Admission Calendar 2026–27',verified:matrix[1]?.[0]||'',rows,hash,checkedAt:new Date().toISOString()});
  } catch (error) {
    res.setHeader('Cache-Control','no-store');
    res.status(503).json({ok:false,source:'unavailable',checkedAt:new Date().toISOString(),message:'লাইভ Google Sheet পাওয়া যায়নি',detail:error.message});
  }
};
