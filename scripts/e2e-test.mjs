/**
 * E2E test harness: generate 10 documents of each type and push them through the
 * real pipeline (Mistral OCR + classification + ABRA Flexi export) so they land
 * in the app for review. Run inside the worker container (has dist + pdfkit +
 * fonts + DB/Redis). One-off; not wired into the app.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { processIncomingFile } from '/srv/app/dist/queue/pipeline.js';

const COMPANY_ID = 'cmp_0f3l3ynt6uwohrcivbbn';
const SOURCE_ID = 'src_va574ndt659oaxrss9oz';
const TMP = '/tmp/foldera-v2';
const ASSETS = '/srv/app/assets';
const PER_TYPE = 10;
const CONCURRENCY = 1;          // serial — stay under the Mistral rate limit
const PACE_MS = 2500;           // gap between docs (2 Mistral calls each)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SUPPLIERS = [
  ['Alfa Trade s.r.o.', '27082440', 'CZ27082440', 'Korunní 810/104, 101 00 Praha 10'],
  ['Beta Servis a.s.', '45274649', 'CZ45274649', 'Brněnská 12, 602 00 Brno'],
  ['Gama Distribuce s.r.o.', '63078180', 'CZ63078180', 'Ostravská 55, 702 00 Ostrava'],
  ['Delta Logistik s.r.o.', '25596641', 'CZ25596641', 'Plzeňská 233, 301 00 Plzeň'],
  ['Epsilon Tech s.r.o.', '28198581', 'CZ28198581', 'Hradecká 9, 500 02 Hradec Králové'],
  ['Zeta Market s.r.o.', '49240901', 'CZ49240901', 'Olomoucká 71, 779 00 Olomouc'],
  ['Eta Nábytek s.r.o.', '60193336', 'CZ60193336', 'Liberecká 18, 460 01 Liberec'],
  ['Théta Kovo a.s.', '00177041', 'CZ00177041', 'Zlínská 4, 760 01 Zlín'],
  ['Jóta Stavby s.r.o.', '26185610', 'CZ26185610', 'Budějovická 6, 370 01 České Budějovice'],
  ['Kappa Energo s.r.o.', '24135091', 'CZ24135091', 'Pardubická 21, 530 02 Pardubice'],
];

const ITEMS = [
  ['Konzultační služby', 'hod', 1200, 21],
  ['Licence software (roční)', 'ks', 8400, 21],
  ['Kancelářský materiál', 'bal', 340, 21],
  ['Doprava a logistika', 'km', 18, 12],
  ['Montážní práce', 'hod', 650, 21],
  ['Údržba zařízení', 'měsíc', 2500, 21],
  ['Tiskové služby', 'ks', 95, 21],
  ['Stravovací služby', 'ks', 145, 12],
];

function font(doc) {
  doc.registerFont('r', path.join(ASSETS, 'DejaVuSans.ttf'));
  doc.registerFont('b', path.join(ASSETS, 'DejaVuSans-Bold.ttf'));
}
const czk = (n) => `${n.toLocaleString('cs-CZ')} Kč`;
const d = (off) => { const x = new Date(2026, 4, 1 + off); return x.toLocaleDateString('cs-CZ'); };

function header(doc, title, sub) {
  doc.font('b').fontSize(20).fillColor('#111').text(title, 50, 50);
  if (sub) doc.font('r').fontSize(10).fillColor('#555').text(sub, 50, 76);
  doc.moveTo(50, 96).lineTo(545, 96).lineWidth(1).stroke('#999');
}
function parties(doc, sup, y) {
  doc.font('b').fontSize(9).fillColor('#111').text('DODAVATEL', 50, y);
  doc.font('r').fontSize(10).fillColor('#222');
  doc.text(sup[0], 50, y + 14);
  doc.text(`IČO: ${sup[1]}   DIČ: ${sup[2]}`, 50, y + 28);
  doc.text(sup[3], 50, y + 42);
  doc.font('b').fontSize(9).fillColor('#111').text('ODBĚRATEL', 320, y);
  doc.font('r').fontSize(10).fillColor('#222');
  doc.text('Naše Firma s.r.o.', 320, y + 14);
  doc.text('IČO: 12345678   DIČ: CZ12345678', 320, y + 28);
  doc.text('Testovací 1, 110 00 Praha 1', 320, y + 42);
}
function itemsTable(doc, lines, y0) {
  let y = y0;
  doc.font('b').fontSize(9).fillColor('#111');
  doc.text('Popis', 50, y); doc.text('Množ.', 300, y); doc.text('Cena/MJ', 360, y); doc.text('DPH', 440, y); doc.text('Celkem', 490, y);
  y += 16; doc.moveTo(50, y - 4).lineTo(545, y - 4).lineWidth(0.5).stroke('#ccc');
  doc.font('r').fontSize(9).fillColor('#222');
  let base21 = 0, base12 = 0;
  for (const [desc, unit, price, vat, qty] of lines) {
    const total = price * qty;
    if (vat === 21) base21 += total; else if (vat === 12) base12 += total;
    doc.text(desc, 50, y, { width: 240 });
    doc.text(`${qty} ${unit}`, 300, y); doc.text(czk(price), 360, y); doc.text(`${vat}%`, 440, y); doc.text(czk(total), 490, y);
    y += 18;
  }
  return { y: y + 8, base21, base12 };
}
function recap(doc, base21, base12, y) {
  const vat21 = Math.round(base21 * 0.21), vat12 = Math.round(base12 * 0.12);
  const total = base21 + vat21 + base12 + vat12;
  doc.moveTo(50, y).lineTo(545, y).lineWidth(0.5).stroke('#ccc'); y += 8;
  doc.font('r').fontSize(9).fillColor('#222');
  if (base21) { doc.text(`Základ 21 %: ${czk(base21)}   DPH 21 %: ${czk(vat21)}`, 300, y); y += 14; }
  if (base12) { doc.text(`Základ 12 %: ${czk(base12)}   DPH 12 %: ${czk(vat12)}`, 300, y); y += 14; }
  doc.font('b').fontSize(12).fillColor('#111').text(`Celkem k úhradě: ${czk(total)}`, 300, y + 4);
  return total;
}
function payInfo(doc, vs, dueOff, y) {
  doc.font('r').fontSize(9).fillColor('#222');
  doc.text(`Bankovní účet: 19-2000145399/0800`, 50, y);
  doc.text(`Variabilní symbol: ${vs}`, 50, y + 14);
  doc.text(`Datum splatnosti: ${d(dueOff)}`, 50, y + 28);
}

function gen(type, i, seq) {
  const sup = SUPPLIERS[i % SUPPLIERS.length];
  const num = `2026${String(2000 + seq).padStart(4, '0')}`; // globally unique → no ABRA dedup
  const vs = `${60000 + seq}`;
  const li = [ITEMS[i % ITEMS.length], ITEMS[(i + 3) % ITEMS.length]].map(([a, b, c, v]) => [a, b, c, v, 1 + (i % 3)]);
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  font(doc);

  if (type === 'invoice') {
    header(doc, 'FAKTURA – daňový doklad', `Číslo: ${num}`);
    parties(doc, sup, 112);
    doc.font('r').fontSize(9).fillColor('#222');
    doc.text(`Datum vystavení: ${d(i)}    DUZP: ${d(i)}`, 50, 168);
    const t = itemsTable(doc, li, 200);
    recap(doc, t.base21, t.base12, t.y);
    payInfo(doc, vs, i + 14, t.y + 70);
  } else if (type === 'advance_invoice') {
    header(doc, 'ZÁLOHOVÁ FAKTURA', `Zálohový list č. ${num} — Toto není daňový doklad`);
    parties(doc, sup, 112);
    doc.font('r').fontSize(9).fillColor('#222');
    doc.text(`Datum vystavení: ${d(i)}`, 50, 168);
    const amount = 5000 + i * 1100;
    doc.font('r').fontSize(10).fillColor('#222').text(`Záloha na dodávku zboží a služeb dle objednávky.`, 50, 200);
    doc.font('b').fontSize(13).text(`K úhradě (záloha): ${czk(amount)}`, 50, 230);
    payInfo(doc, vs, i + 10, 270);
  } else if (type === 'tax_payment') {
    header(doc, 'DAŇOVÝ DOKLAD K PŘIJATÉ PLATBĚ', `Číslo: ${num} — k zálohové faktuře č. 2026${String(900 + i).padStart(4, '0')}`);
    parties(doc, sup, 112);
    const base = 4000 + i * 900, vat = Math.round(base * 0.21);
    doc.font('r').fontSize(9).fillColor('#222');
    doc.text(`Datum přijetí platby: ${d(i)}    DUZP: ${d(i)}`, 50, 168);
    doc.text(`Datum splatnosti: ${d(i)}`, 50, 182);
    doc.font('r').fontSize(10).text(`Daňový doklad vystavený po přijetí zálohové platby.`, 50, 210);
    doc.font('r').fontSize(9).text(`Základ 21 %: ${czk(base)}    DPH 21 %: ${czk(vat)}`, 50, 236);
    doc.font('b').fontSize(13).fillColor('#111').text(`Přijatá platba celkem: ${czk(base + vat)}`, 50, 256);
    doc.font('r').fontSize(9).fillColor('#222').text(`Variabilní symbol: ${vs}`, 50, 290);
  } else if (type === 'credit_note') {
    header(doc, 'DOBROPIS – opravný daňový doklad', `Číslo: ${num} — k faktuře č. 2026${String(800 + i).padStart(4, '0')}`);
    parties(doc, sup, 112);
    doc.font('r').fontSize(9).fillColor('#222');
    doc.text(`Datum vystavení: ${d(i)}    DUZP: ${d(i)}`, 50, 168);
    const li2 = [[`Vrácení zboží – ${ITEMS[i % ITEMS.length][0]}`, 'ks', -(800 + i * 120), 21, 1]];
    const t = itemsTable(doc, li2, 200);
    const base = -(800 + i * 120), vat = Math.round(base * 0.21);
    doc.font('b').fontSize(12).fillColor('#111').text(`Celkem (dobropis): ${czk(base + vat)}`, 300, t.y + 8);
    doc.font('r').fontSize(9).fillColor('#222').text(`Variabilní symbol: ${vs}`, 50, t.y + 8);
  } else if (type === 'receipt') {
    doc.font('b').fontSize(16).fillColor('#111').text('ÚČTENKA / PARAGON', 50, 50);
    doc.font('r').fontSize(10).fillColor('#222').text(sup[0], 50, 80);
    doc.text(`IČO: ${sup[1]}   DIČ: ${sup[2]}`, 50, 96);
    doc.text(`Datum: ${d(i)} 12:${String(10 + i).padStart(2, '0')}`, 50, 120);
    const amount = 120 + i * 37;
    const base = Math.round(amount / 1.21), vat = amount - base;
    doc.text(`Položka: ${ITEMS[i % ITEMS.length][0]}`, 50, 150);
    doc.text(`Základ DPH 21 %: ${czk(base)}`, 50, 168);
    doc.text(`DPH 21 %: ${czk(vat)}`, 50, 182);
    doc.font('b').fontSize(13).text(`CELKEM: ${czk(amount)}`, 50, 204);
    doc.font('r').fontSize(9).text('Platba: HOTOVOST', 50, 232);
    doc.text(`FIK: ${i}a1b2c3-4d5e-6f70-8901-abcdef01234${i}-ff`, 50, 250);
    doc.text(`BKP: 1A2B3C4${i}-5D6E7F80-90ABCDEF-12345678-9ABCDEF0`, 50, 264);
    doc.text('EET tržba evidována v běžném režimu', 50, 278);
  }
  // Uniqueness marker so each doc has a distinct content hash.
  doc.font('r').fontSize(7).fillColor('#999').text(`ref ${type}-${i}-${num}`, 50, 800);
  doc.end();
  return { buf: done, num, type, i };
}

async function runOne(type, i, seq) {
  const { buf, num } = gen(type, i, seq);
  const data = await buf;
  const fileName = `e2e-${type}-${String(i + 1).padStart(2, '0')}-${num}.pdf`;
  const filePath = path.join(TMP, fileName);
  await fs.mkdir(TMP, { recursive: true });
  await fs.writeFile(filePath, data);
  try {
    await processIncomingFile({
      companyId: COMPANY_ID,
      sourceId: SOURCE_ID,
      file: { filePath, fileName, mimeType: 'application/pdf', externalRef: `e2e-${type}-${i}-${num}` },
    });
    return { type, i, ok: true };
  } catch (e) {
    return { type, i, ok: false, err: e?.message };
  }
}

const ALL_TYPES = ['invoice', 'advance_invoice', 'tax_payment', 'credit_note', 'receipt'];
const TYPES = process.env.ONLY_TYPE ? process.env.ONLY_TYPE.split(',') : ALL_TYPES;
const jobs = [];
let seq = Number(process.env.SEQ_BASE || 0);
for (const type of TYPES) for (let i = 0; i < PER_TYPE; i++) jobs.push({ type, i, seq: seq++ });

let done = 0;
async function worker(queue) {
  while (queue.length) {
    const job = queue.shift();
    const r = await runOne(job.type, job.i, job.seq);
    done++;
    console.log(`[${done}/${jobs.length}] ${r.type} #${r.i + 1} ${r.ok ? 'sent' : 'ERR ' + r.err}`);
    if (queue.length) await sleep(PACE_MS);
  }
}
const q = [...jobs];
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(q)));
console.log('ALL DONE');
process.exit(0);
