import { PROPERTIES } from '../config/properties.js';

const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];

function yen(price) {
  if (!price) return '';
  return price >= 10000 ? `¥${Math.round(price / 1000)}k` : `¥${price.toLocaleString()}`;
}

export function buildDashboardHtml(data) {
  const { calendarData, dayRecords, scrapedAt } = data;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dates = Array.from({ length: 90 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });

  // 価格ルックアップ: "物件名|日付" -> price
  const priceLookup = new Map();
  for (const r of dayRecords || []) {
    if (r.status === 'available' && r.price) {
      priceLookup.set(`${r.name}|${r.date}`, r.price);
    }
  }

  const ownProps = PROPERTIES.filter((p) => p.own);
  const compProps = PROPERTIES.filter((p) => !p.own);

  // 自社が空いている日の競合状況を計算
  // oppData: { "物件名|日付": { soldOut, available } }
  const oppData = {};
  for (const own of ownProps) {
    const ownCal = calendarData[own.name] || {};
    const sameGroupComps = compProps.filter((c) => c.group === own.group);
    for (const date of dates) {
      if (!ownCal[date]?.available) continue;
      let soldOut = 0, available = 0;
      for (const comp of sameGroupComps) {
        const v = (calendarData[comp.name] || {})[date]?.available;
        if (v === true) available++;
        else if (v === false) soldOut++;
      }
      oppData[`${own.name}|${date}`] = { soldOut, available };
    }
  }

  // サマリー計算
  const summaries = ownProps.map((own) => {
    const ownCal = calendarData[own.name] || {};
    let availDays = 0, oppDays = 0;
    for (const date of dates) {
      if (!ownCal[date]?.available) continue;
      availDays++;
      const o = oppData[`${own.name}|${date}`];
      if (o && o.soldOut > o.available) oppDays++;
    }
    return { name: own.name, group: own.group, availDays, oppDays };
  });

  // 日付ヘッダー
  const dateHeaders = dates.map((date) => {
    const d = new Date(date + 'T00:00:00');
    const dow = DOW_JA[d.getDay()];
    const cls = d.getDay() === 6 ? 'sat' : d.getDay() === 0 ? 'sun' : '';
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `<th class="dh ${cls}" data-date="${date}"><div>${mm}/${dd}</div><div class="dow">${dow}</div></th>`;
  }).join('');

  // テーブル行
  const allProps = [...ownProps, ...compProps];
  const tableRows = allProps.map((prop) => {
    const isOwn = prop.own;
    const cal = calendarData[prop.name] || {};

    const cells = dates.map((date) => {
      const entry = cal[date];
      const avail = entry?.available;
      const price = priceLookup.get(`${prop.name}|${date}`);

      let cls = 'c';
      let content = '';
      let title = '';

      if (avail === undefined) {
        cls += ' nd';
      } else if (!avail) {
        cls += isOwn ? ' so-own' : ' so';
      } else {
        if (isOwn) {
          const o = oppData[`${prop.name}|${date}`];
          cls += o && o.soldOut > o.available ? ' opp' : ' av-own';
          if (o) title = `競合満室:${o.soldOut} 空き:${o.available}`;
        } else {
          cls += ' av';
        }
        if (price) content = `<span class="p">${yen(price)}</span>`;
      }

      return `<td class="${cls}" data-date="${date}" title="${title}">${content}</td>`;
    }).join('');

    const rowCls = isOwn ? 'pr own' : 'pr';
    const prefix = isOwn ? '★ ' : '';
    const badge = `<span class="gb ${prop.group === '大箱' ? 'ob' : 'kb'}">${prop.group}</span>`;
    return `<tr class="${rowCls}" data-group="${prop.group}" data-own="${isOwn}">
      <td class="pn">${prefix}${prop.name}${badge}</td>${cells}</tr>`;
  }).join('');

  // サマリーカード
  const summaryCards = summaries.map((s) => `
    <div class="sc">
      <div class="sc-name">★ ${s.name} <span class="gb ${s.group === '大箱' ? 'ob' : 'kb'}">${s.group}</span></div>
      <div class="sc-stats">
        <div class="st"><div class="sn">${s.availDays}</div><div class="sl">空き日数</div></div>
        <div class="st opp-st"><div class="sn">${s.oppDays}</div><div class="sl">需要↑機会</div></div>
      </div>
    </div>`).join('');

  const scrapedDate = new Date(scrapedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const oppDataJson = JSON.stringify(oppData);
  const datesJson = JSON.stringify(dates);

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>競合カレンダー分析</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Hiragino Sans','Hiragino Kaku Gothic ProN',Meiryo,sans-serif;background:#f5f5f5;color:#222;font-size:13px}
.hdr{background:#1a3a5c;color:#fff;padding:16px 20px;display:flex;align-items:center;justify-content:space-between}
.hdr h1{font-size:18px}
.upd{font-size:11px;opacity:.8}
.sc-wrap{display:flex;gap:12px;padding:16px 20px;flex-wrap:wrap}
.sc{background:#fff;border-radius:8px;padding:14px 18px;min-width:160px;box-shadow:0 1px 3px rgba(0,0,0,.1)}
.sc-name{font-weight:bold;margin-bottom:8px;font-size:13px}
.sc-stats{display:flex;gap:16px}
.st{text-align:center}
.sn{font-size:22px;font-weight:bold;color:#1a3a5c}
.sl{font-size:10px;color:#888}
.opp-st .sn{color:#d97706}
.ctrl{background:#fff;padding:10px 20px;display:flex;gap:20px;align-items:center;flex-wrap:wrap;border-bottom:1px solid #e5e5e5;position:sticky;top:0;z-index:10;box-shadow:0 2px 4px rgba(0,0,0,.05)}
.ctrl-group{display:flex;gap:6px;align-items:center}
.ctrl-label{font-size:12px;color:#666;white-space:nowrap}
.btn{padding:4px 10px;border:1px solid #ccc;border-radius:4px;background:#fff;cursor:pointer;font-size:12px}
.btn.active{background:#1a3a5c;color:#fff;border-color:#1a3a5c}
.cb-label{font-size:12px;cursor:pointer;display:flex;align-items:center;gap:4px}
.legend{padding:8px 20px;display:flex;gap:14px;flex-wrap:wrap;background:#fafafa;border-bottom:1px solid #eee}
.li{display:flex;align-items:center;gap:4px;font-size:11px;color:#555}
.lb{width:14px;height:14px;border-radius:2px;display:inline-block}
.lb.opp{background:#fcd34d}
.lb.av-own{background:#bfdbfe}
.lb.so-own{background:#fca5a5}
.lb.av{background:#bbf7d0}
.lb.so{background:#fecaca}
.lb.nd{background:#e5e7eb}
.tw{overflow-x:auto;padding:0 0 20px}
table{border-collapse:collapse;white-space:nowrap}
.pn{position:sticky;left:0;background:#fff;z-index:5;padding:6px 10px;font-weight:500;min-width:140px;border-right:2px solid #e5e5e5;border-bottom:1px solid #eee}
.own .pn{background:#eff6ff}
.dh{padding:4px 2px;text-align:center;min-width:38px;font-size:11px;border-bottom:2px solid #ddd;position:sticky;top:0;background:#f8f8f8;z-index:4}
.dh.sat{color:#2563eb}
.dh.sun{color:#dc2626}
.dow{font-size:10px;opacity:.8}
.c{width:38px;min-width:38px;height:36px;text-align:center;border-bottom:1px solid #f0f0f0;border-right:1px solid #f5f5f5;vertical-align:middle;position:relative}
.nd{background:#f3f4f6}
.so-own{background:#fca5a5}
.so{background:#fecaca}
.opp{background:#fcd34d}
.av-own{background:#bfdbfe}
.av{background:#bbf7d0}
.p{font-size:9px;font-weight:bold;color:#333;display:block;line-height:1.2}
.gb{font-size:9px;padding:1px 4px;border-radius:3px;margin-left:4px;font-weight:normal}
.ob{background:#dbeafe;color:#1d4ed8}
.kb{background:#dcfce7;color:#166534}
.pr-hdr th{background:#f8f8f8;font-size:11px;padding:6px 10px;text-align:left;position:sticky;top:0}
</style>
<style id="fs"></style>
</head>
<body>
<div class="hdr">
  <h1>競合カレンダー分析</h1>
  <div class="upd">データ取得: ${scrapedDate}</div>
</div>
<div class="sc-wrap">${summaryCards}</div>
<div class="ctrl">
  <div class="ctrl-group">
    <span class="ctrl-label">グループ:</span>
    <button class="btn active" onclick="setGroup('all',this)">全て</button>
    <button class="btn" onclick="setGroup('大箱',this)">大箱</button>
    <button class="btn" onclick="setGroup('小箱',this)">小箱</button>
  </div>
  <div class="ctrl-group">
    <span class="ctrl-label">期間:</span>
    <button class="btn active" onclick="setDays(30,this)">30日</button>
    <button class="btn" onclick="setDays(60,this)">60日</button>
    <button class="btn" onclick="setDays(90,this)">90日</button>
  </div>
  <div class="ctrl-group">
    <label class="cb-label"><input type="checkbox" id="oppCb" onchange="setOpp(this)"> 需要↑機会の日のみ表示</label>
  </div>
</div>
<div class="legend">
  <div class="li"><span class="lb opp"></span>需要↑機会（競合が多く満室）</div>
  <div class="li"><span class="lb av-own"></span>自社空き</div>
  <div class="li"><span class="lb so-own"></span>自社満室</div>
  <div class="li"><span class="lb av"></span>競合空き</div>
  <div class="li"><span class="lb so"></span>競合満室</div>
  <div class="li"><span class="lb nd"></span>データなし</div>
</div>
<div class="tw">
<table id="t">
<thead><tr><th class="pn" style="z-index:6;top:0">物件</th>${dateHeaders}</tr></thead>
<tbody>${tableRows}</tbody>
</table>
</div>
<script>
const dates=${datesJson};
const oppData=${oppDataJson};
let days=30,group='all',oppOnly=false;

function render(){
  const cutoff=dates[days-1];
  const hidden=new Set();
  for(const d of dates){
    if(d>cutoff){hidden.add(d);continue;}
    if(oppOnly){
      const hasOpp=Object.entries(oppData).some(([k,v])=>k.endsWith('|'+d)&&v.soldOut>v.available);
      if(!hasOpp)hidden.add(d);
    }
  }
  const css=Array.from(hidden).map(d=>'[data-date="'+d+'"]{display:none}').join('\\n');
  document.getElementById('fs').textContent=css;
  document.querySelectorAll('.pr').forEach(r=>{
    r.style.display=(group==='all'||r.dataset.group===group)?'':'none';
  });
}

function setGroup(g,btn){
  group=g;
  document.querySelectorAll('[onclick^="setGroup"]').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  render();
}
function setDays(d,btn){
  days=d;
  document.querySelectorAll('[onclick^="setDays"]').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  render();
}
function setOpp(cb){oppOnly=cb.checked;render();}
render();
</script>
</body>
</html>`;
}
