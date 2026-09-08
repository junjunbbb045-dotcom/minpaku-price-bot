import { google } from 'googleapis';
import { getOAuthClient } from './drive.js';
import { PROPERTIES, SHEETS_DASHBOARD_ID } from '../config/properties.js';
import { formatDate, weekdayJa } from './dates.js';

const DASHBOARD_DAYS = 90;
const VISIBLE_DAYS = 30; // 31日目以降は列グループで折りたたむ
const FIXED_COLUMNS = ['物件', 'グループ', '空き日数', '需要↑機会'];
const DATE_COL_START = FIXED_COLUMNS.length;
const TOTAL_COLUMNS = DATE_COL_START + DASHBOARD_DAYS;
const HEADER_ROWS = 3; // タイトル・凡例・見出し

const rgb = (hex) => ({
  red: parseInt(hex.slice(1, 3), 16) / 255,
  green: parseInt(hex.slice(3, 5), 16) / 255,
  blue: parseInt(hex.slice(5, 7), 16) / 255,
});

const COLOR = {
  title: rgb('#1a3a5c'),
  opportunity: rgb('#f9d64a'),
  ownAvailable: rgb('#b9d2f7'),
  ownSoldOut: rgb('#f4a3a3'),
  competitorAvailable: rgb('#b8ecc9'),
  competitorSoldOut: rgb('#f8d0d0'),
  noData: rgb('#e8e8e8'),
  ownName: rgb('#e8f0fa'),
  ownNameText: rgb('#0c447c'),
  groupBig: rgb('#dbe7f5'),
  groupBigText: rgb('#1a3a5c'),
  groupSmall: rgb('#dcefe1'),
  groupSmallText: rgb('#1f5a34'),
  header: rgb('#f3f3f3'),
  opportunityText: rgb('#c77700'),
  white: rgb('#ffffff'),
  black: rgb('#222222'),
  red: rgb('#cc0000'),
  blue: rgb('#1a56c4'),
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

function cell(value, { bg, color, bold, center, wrap, overflow } = {}) {
  const format = {
    horizontalAlignment: center ? 'CENTER' : 'LEFT',
    verticalAlignment: 'MIDDLE',
    wrapStrategy: wrap ? 'WRAP' : overflow ? 'OVERFLOW_CELL' : 'CLIP',
    textFormat: { bold: Boolean(bold), foregroundColor: color ?? COLOR.black },
  };
  if (bg) format.backgroundColor = bg;
  return { userEnteredValue: { stringValue: String(value ?? '') }, userEnteredFormat: format };
}

// 値を持たない空セル（隣のセルのはみ出し表示を妨げない）
function blank(bg) {
  const c = cell('', bg ? { bg } : {});
  delete c.userEnteredValue;
  return c;
}

function buildTitle(now) {
  const pad = (n) => String(n).padStart(2, '0');
  return `民泊競合カレンダー分析　取得: ${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

// 凡例は3セル1組（後で結合するため、先頭セルにラベルを置く）
const LEGEND_ITEMS = 6;
function legendTriple(label, bg) {
  return [cell(label, { bg, bold: true, center: true }), blank(bg), blank(bg)];
}

// 自社が空室の日に、同グループの競合の満室数が空室数を上回っていれば「需要↑機会」
function isOpportunity(property, dateStr, calendarData) {
  if (!property.own) return false;
  let soldOut = 0;
  let available = 0;
  for (const c of PROPERTIES) {
    if (c.own || c.group !== property.group) continue;
    const v = calendarData?.[c.name]?.[dateStr]?.available;
    if (v === true) available++;
    else if (v === false) soldOut++;
  }
  return soldOut > available;
}

function summarize(property, dateColumns, calendarData) {
  let availableDays = 0;
  let opportunityDays = 0;
  for (const d of dateColumns) {
    const dateStr = formatDate(d);
    if (calendarData?.[property.name]?.[dateStr]?.available !== true) continue;
    availableDays++;
    if (isOpportunity(property, dateStr, calendarData)) opportunityDays++;
  }
  return { availableDays, opportunityDays };
}

function dateCellBackground(property, dateStr, calendarData) {
  const available = calendarData?.[property.name]?.[dateStr]?.available;
  if (available === undefined) return COLOR.noData;
  if (available === false) return property.own ? COLOR.ownSoldOut : COLOR.competitorSoldOut;
  if (isOpportunity(property, dateStr, calendarData)) return COLOR.opportunity;
  return property.own ? COLOR.ownAvailable : COLOR.competitorAvailable;
}

function buildRows(data, priceLookup, dateColumns) {
  const { calendarData } = data;
  const rows = [];

  const titleRow = [cell(buildTitle(new Date()), { bg: COLOR.title, color: COLOR.white, bold: true, overflow: true })];
  while (titleRow.length < TOTAL_COLUMNS) titleRow.push(blank(COLOR.title));
  rows.push({ values: titleRow });

  const legendRow = Array.from({ length: DATE_COL_START }, () => blank());
  legendRow.push(
    ...legendTriple('需要↑機会', COLOR.opportunity),
    ...legendTriple('自社空き', COLOR.ownAvailable),
    ...legendTriple('自社満室', COLOR.ownSoldOut),
    ...legendTriple('競合空き', COLOR.competitorAvailable),
    ...legendTriple('競合満室', COLOR.competitorSoldOut),
    ...legendTriple('データなし', COLOR.noData),
  );
  while (legendRow.length < TOTAL_COLUMNS) legendRow.push(blank());
  rows.push({ values: legendRow });

  const headerRow = FIXED_COLUMNS.map((label, i) => cell(label, { bg: COLOR.header, bold: true, center: i > 0, wrap: true }));
  for (const d of dateColumns) {
    const dow = d.getDay();
    const color = dow === 0 ? COLOR.red : dow === 6 ? COLOR.blue : COLOR.black;
    const label = `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, '0')}\n${weekdayJa(d)}`;
    headerRow.push(cell(label, { bg: COLOR.header, bold: true, center: true, wrap: true, color }));
  }
  rows.push({ values: headerRow });

  const ordered = [...PROPERTIES.filter((p) => p.own), ...PROPERTIES.filter((p) => !p.own)];
  for (const property of ordered) {
    const { availableDays, opportunityDays } = summarize(property, dateColumns, calendarData);
    const nameBg = property.own ? COLOR.ownName : COLOR.white;
    const isBig = property.group === '大箱';
    const values = [
      cell(`${property.own ? '★ ' : ''}${property.name}`, {
        bg: nameBg,
        bold: property.own,
        color: property.own ? COLOR.ownNameText : COLOR.black,
      }),
      cell(property.group, {
        bg: isBig ? COLOR.groupBig : COLOR.groupSmall,
        color: isBig ? COLOR.groupBigText : COLOR.groupSmallText,
        bold: true,
        center: true,
      }),
      cell(availableDays, { bg: nameBg, bold: true, center: true, color: COLOR.title }),
      cell(property.own ? opportunityDays : '', { bg: nameBg, bold: true, center: true, color: COLOR.opportunityText }),
    ];
    for (const d of dateColumns) {
      const dateStr = formatDate(d);
      const price = priceLookup.get(`${property.name}|${dateStr}`);
      values.push(cell(price != null ? yenK(price) : '', { bg: dateCellBackground(property, dateStr, calendarData), center: true }));
    }
    rows.push({ values });
  }

  return rows;
}

function columnRange(sheetId, startIndex, endIndex) {
  return { sheetId, dimension: 'COLUMNS', startIndex, endIndex };
}

export async function updateSheetsDashboard(data, priceLookup) {
  const auth = getOAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SHEETS_DASHBOARD_ID,
    fields: 'sheets(properties,columnGroups)',
  });
  const firstSheet = meta.data.sheets[0];
  const sheetId = firstSheet.properties.sheetId;
  const sheetTitle = firstSheet.properties.title;
  const grid = firstSheet.properties.gridProperties ?? {};

  const dateColumns = buildDateColumns();
  const rows = buildRows(data, priceLookup, dateColumns);
  const dataRowCount = rows.length;
  const rowCount = Math.max(grid.rowCount ?? 0, dataRowCount + 10);
  const columnCount = Math.max(grid.columnCount ?? 0, TOTAL_COLUMNS);

  // 隣接する同じ深さのグループは結合されてしまうため、31〜90日（深さ1）の中に61〜90日（深さ2）を入れ子にする
  const collapsedGroups = [
    { range: columnRange(sheetId, DATE_COL_START + VISIBLE_DAYS, TOTAL_COLUMNS), depth: 1 },
    { range: columnRange(sheetId, DATE_COL_START + VISIBLE_DAYS * 2, TOTAL_COLUMNS), depth: 2 },
  ];

  const requests = [
    {
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: { rowCount, columnCount, frozenRowCount: HEADER_ROWS, frozenColumnCount: DATE_COL_START },
        },
        fields: 'gridProperties(rowCount,columnCount,frozenRowCount,frozenColumnCount)',
      },
    },
    // 前回作った列グループを一旦すべて削除し、非表示になっていた列を戻す（毎回同じ状態から組み直す）
    ...(firstSheet.columnGroups ?? []).map((g) => ({ deleteDimensionGroup: { range: { ...g.range, sheetId } } })),
    {
      updateDimensionProperties: {
        range: columnRange(sheetId, 0, columnCount),
        properties: { hiddenByUser: false },
        fields: 'hiddenByUser',
      },
    },
    // 書式・結合を全面リセットしてから書き込む（レイアウト変更で残る古い色を消す）
    {
      unmergeCells: {
        range: { sheetId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: columnCount },
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: columnCount },
        cell: { userEnteredFormat: {} },
        fields: 'userEnteredFormat',
      },
    },
    {
      updateCells: {
        range: { sheetId, startRowIndex: 0, startColumnIndex: 0 },
        rows,
        fields: 'userEnteredValue,userEnteredFormat',
      },
    },
    // 凡例を3セルずつ結合
    ...Array.from({ length: LEGEND_ITEMS }, (_, i) => ({
      mergeCells: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: 2,
          startColumnIndex: DATE_COL_START + i * 3,
          endColumnIndex: DATE_COL_START + i * 3 + 3,
        },
        mergeType: 'MERGE_ALL',
      },
    })),
    { updateDimensionProperties: { range: columnRange(sheetId, 0, 1), properties: { pixelSize: 150 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: columnRange(sheetId, 1, 2), properties: { pixelSize: 72 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: columnRange(sheetId, 2, 4), properties: { pixelSize: 78 }, fields: 'pixelSize' } },
    {
      updateDimensionProperties: {
        range: columnRange(sheetId, DATE_COL_START, TOTAL_COLUMNS),
        properties: { pixelSize: 54 },
        fields: 'pixelSize',
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'ROWS', startIndex: 2, endIndex: 3 },
        properties: { pixelSize: 40 },
        fields: 'pixelSize',
      },
    },
    // フィルタはA〜D列のみ（日付列に▼アイコンが付いて見出しが崩れるのを防ぐ）。行の絞り込みは全列に効く
    {
      setBasicFilter: {
        filter: {
          range: { sheetId, startRowIndex: HEADER_ROWS - 1, endRowIndex: dataRowCount, startColumnIndex: 0, endColumnIndex: DATE_COL_START },
        },
      },
    },
    ...collapsedGroups.map(({ range }) => ({ addDimensionGroup: { range } })),
    ...collapsedGroups.map(({ range, depth }) => ({
      updateDimensionGroup: { dimensionGroup: { range, depth, collapsed: true }, fields: 'collapsed' },
    })),
  ];

  await sheets.spreadsheets.values.clear({ spreadsheetId: SHEETS_DASHBOARD_ID, range: sheetTitle });
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEETS_DASHBOARD_ID, requestBody: { requests } });

  return `https://docs.google.com/spreadsheets/d/${SHEETS_DASHBOARD_ID}/edit#gid=${sheetId}`;
}
