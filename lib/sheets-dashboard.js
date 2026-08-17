import { google } from 'googleapis';
import { getOAuthClient } from './drive.js';
import { PROPERTIES, SHEETS_DASHBOARD_ID } from '../config/properties.js';
import { formatDate, weekdayJa } from './dates.js';

const DASHBOARD_DAYS = 90;
const TOTAL_COLUMNS = 1 + DASHBOARD_DAYS; // 物件 + 日付

const COLOR = {
  title: { red: 0.102, green: 0.227, blue: 0.361 }, // #1a3a5c
  opportunity: { red: 0.945, green: 0.761, blue: 0.196 }, // #f1c232
  available: { red: 0.643, green: 0.761, blue: 0.957 }, // #a4c2f4 自社空き
  soldOut: { red: 0.918, green: 0.6, blue: 0.6 }, // #ea9999 自社満室・競合満室
  competitorAvailable: { red: 0.714, green: 0.843, blue: 0.659 }, // #b6d7a8 競合空き
  white: { red: 1, green: 1, blue: 1 },
  black: { red: 0, green: 0, blue: 0 },
  red: { red: 0.8, green: 0, blue: 0 },
};

function yenK(price) {
  return `¥${Math.round(price / 1000)}k`;
}

function buildDateColumns() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: DASHBOARD_DAYS }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    return d;
  });
}

function isWeekend(d) {
  return d.getDay() === 0 || d.getDay() === 6;
}

function cell(value, { bg, color, bold, center, wrap } = {}) {
  const c = { userEnteredValue: { stringValue: String(value ?? '') } };
  const format = {};
  if (bg) format.backgroundColor = bg;
  if (color || bold) {
    format.textFormat = {};
    if (color) format.textFormat.foregroundColor = color;
    if (bold) format.textFormat.bold = true;
  }
  if (center) format.horizontalAlignment = 'CENTER';
  if (wrap) format.wrapStrategy = 'WRAP';
  if (Object.keys(format).length) c.userEnteredFormat = format;
  return c;
}

function buildTitle(now) {
  const pad = (n) => String(n).padStart(2, '0');
  return `民泊競合カレンダー分析　取得: ${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

// 3列ぶんの凡例セル（結合はせず、真ん中のセルに中央揃えでラベルを入れる）
function legendTriple(label, bg) {
  return [cell('', { bg }), cell(label, { bg, color: COLOR.black, bold: true, center: true }), cell('', { bg })];
}

export async function updateSheetsDashboard(data, priceLookup) {
  const auth = getOAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEETS_DASHBOARD_ID });
  const firstSheet = meta.data.sheets[0];
  const sheetId = firstSheet.properties.sheetId;
  const sheetTitle = firstSheet.properties.title;

  const dateColumns = buildDateColumns();
  const rows = [];

  // Row 1: タイトル（全列結合・紺色）
  const titleRow = [cell(buildTitle(new Date()), { bg: COLOR.title, color: COLOR.white, bold: true })];
  for (let i = 1; i < TOTAL_COLUMNS; i++) titleRow.push(cell('', { bg: COLOR.title }));
  rows.push({ values: titleRow });

  // Row 2: 凡例
  const legendValues = [
    cell('', {}),
    ...legendTriple('需要↑機会', COLOR.opportunity),
    ...legendTriple('自社空き', COLOR.available),
    ...legendTriple('自社満室', COLOR.soldOut),
    ...legendTriple('競合空き', COLOR.competitorAvailable),
    ...legendTriple('競合満室', COLOR.soldOut),
    ...legendTriple('データなし', COLOR.white),
  ];
  while (legendValues.length < TOTAL_COLUMNS) legendValues.push(cell(''));
  rows.push({ values: legendValues });

  // Row 3: 日付ヘッダー（M/DD改行→曜日、土日は赤文字）
  const headerValues = [cell('物件', { bold: true })];
  for (const d of dateColumns) {
    const label = `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, '0')}\n${weekdayJa(d)}`;
    const style = { bold: true, center: true, wrap: true };
    if (isWeekend(d)) style.color = COLOR.red;
    headerValues.push(cell(label, style));
  }
  rows.push({ values: headerValues });

  // Row 4: 需要シグナル（競合の満室率が自社の満室率より高い日に⚠️）
  const signalValues = [cell('⚠️機会', { bold: true })];
  for (const d of dateColumns) {
    const dateStr = formatDate(d);
    let ownTotal = 0;
    let ownSoldOut = 0;
    let competitorTotal = 0;
    let competitorSoldOut = 0;
    for (const property of PROPERTIES) {
      const info = data.calendarData?.[property.name]?.[dateStr];
      if (!info) continue;
      if (property.own) {
        ownTotal++;
        if (!info.available) ownSoldOut++;
      } else {
        competitorTotal++;
        if (!info.available) competitorSoldOut++;
      }
    }
    const ownRate = ownTotal > 0 ? ownSoldOut / ownTotal : null;
    const competitorRate = competitorTotal > 0 ? competitorSoldOut / competitorTotal : null;
    const flagged = ownRate != null && competitorRate != null && competitorRate > ownRate;
    signalValues.push(cell(flagged ? '⚠️' : '', { center: true }));
  }
  rows.push({ values: signalValues });

  // Row 5+: 物件ごとの価格・空室状況
  for (const property of PROPERTIES) {
    const rowValues = [cell(`${property.own ? '★ ' : ''}${property.name}`, { bold: property.own })];
    const calendarMap = data.calendarData?.[property.name] ?? {};
    for (const d of dateColumns) {
      const dateStr = formatDate(d);
      const info = calendarMap[dateStr];
      const price = priceLookup.get(`${property.name}|${dateStr}`);

      let bg;
      if (!info) {
        bg = COLOR.white;
      } else if (info.available) {
        bg = property.own ? COLOR.available : COLOR.competitorAvailable;
      } else {
        bg = COLOR.soldOut;
      }
      rowValues.push(cell(price != null ? yenK(price) : '', { bg }));
    }
    rows.push({ values: rowValues });
  }

  await sheets.spreadsheets.values.clear({ spreadsheetId: SHEETS_DASHBOARD_ID, range: sheetTitle });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEETS_DASHBOARD_ID,
    requestBody: {
      requests: [
        {
          updateCells: {
            range: { sheetId, startRowIndex: 0, startColumnIndex: 0 },
            rows,
            fields:
              'userEnteredValue,userEnteredFormat.backgroundColor,userEnteredFormat.textFormat,userEnteredFormat.horizontalAlignment,userEnteredFormat.wrapStrategy',
          },
        },
        {
          updateDimensionProperties: {
            range: { sheetId, dimension: 'ROWS', startIndex: 2, endIndex: 3 },
            properties: { pixelSize: 38 },
            fields: 'pixelSize',
          },
        },
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 4 } },
            fields: 'gridProperties.frozenRowCount',
          },
        },
      ],
    },
  });

  return `https://docs.google.com/spreadsheets/d/${SHEETS_DASHBOARD_ID}/edit#gid=${sheetId}`;
}
