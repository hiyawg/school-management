import QRCode from "qrcode";

export type IdCard = {
  schoolName: string;
  schoolPhone: string | null;
  name: string;
  code: string;             // the student ID; also what the QR code holds
  className: string | null;
  year: string | null;
  dateOfBirth: string | null;
  guardianPhone: string | null;
  photoUrl: string | null;
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

async function cardHtml(c: IdCard) {
  const qr = await QRCode.toString(c.code, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
  const row = (label: string, value: string | null) => (value ? `<div class="row"><span>${label}</span>${esc(value)}</div>` : "");
  return `<div class="card">
    <div class="band"><div class="school">${esc(c.schoolName)}</div><div class="kind">STUDENT ID CARD</div></div>
    <div class="body">
      <div class="photo">${c.photoUrl ? `<img src="${esc(c.photoUrl)}" alt="">` : `<div class="initials">${esc(initials(c.name))}</div>`}</div>
      <div class="info">
        <div class="name">${esc(c.name)}</div>
        <div class="code">${esc(c.code)}</div>
        ${row("Class", c.className)}${row("Year", c.year)}${row("Born", c.dateOfBirth)}${row("Guardian", c.guardianPhone)}
      </div>
      <div class="qr">${qr}</div>
    </div>
    <div class="foot">If found, please return to ${esc(c.schoolName)}${c.schoolPhone ? ` · ${esc(c.schoolPhone)}` : ""}</div>
  </div>`;
}

// The print window must open straight from the click (browsers block pop-ups opened later), so callers open it
// first and fill it once the card data has loaded.
export function openPrintWindow() {
  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) throw new Error("Allow pop-ups for this site to print ID cards");
  w.document.write("<p style='font:14px system-ui;padding:24px'>Preparing ID cards…</p>");
  return w;
}

// Prints cards at bank-card size (85.6 × 54 mm), ten to an A4 page, with cutting guides.
export async function printIdCards(cards: IdCard[], w: Window) {
  const html = (await Promise.all(cards.map(cardHtml))).join("");
  w.document.open();
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Student ID cards</title><style>
    @page { size: A4; margin: 10mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 9pt/1.25 system-ui, -apple-system, "Segoe UI", sans-serif; color: #10233f;
           -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .sheet { display: grid; grid-template-columns: repeat(2, 85.6mm); gap: 4mm 6mm; justify-content: center; padding: 4mm 0; }
    .card { width: 85.6mm; height: 54mm; border: 0.3mm dashed #9aa9bd; border-radius: 3mm; overflow: hidden;
            display: flex; flex-direction: column; break-inside: avoid; background: #fff; }
    .band { background: linear-gradient(#2275c9, #1a5ba3); color: #fff; padding: 1.6mm 3mm; display: flex;
            justify-content: space-between; align-items: baseline; gap: 2mm; }
    .school { font-weight: 700; font-size: 9.5pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .kind { font-size: 6pt; letter-spacing: 0.4mm; opacity: 0.9; white-space: nowrap; }
    .body { flex: 1; display: flex; gap: 2.5mm; padding: 2.5mm 3mm 1mm; min-height: 0; }
    .photo { width: 20mm; height: 25mm; flex: none; border: 0.3mm solid #c9d4e2; border-radius: 1mm; overflow: hidden; background: #eef3f9; }
    .photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .initials { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 16pt; font-weight: 700; color: #1a5ba3; }
    .info { flex: 1; min-width: 0; }
    .name { font-weight: 700; font-size: 10pt; line-height: 1.15; margin-bottom: 0.6mm; }
    .code { font: 700 9pt ui-monospace, Menlo, monospace; color: #1a5ba3; margin-bottom: 1mm; }
    .row { font-size: 7.5pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .row span { color: #5b6b80; display: inline-block; width: 13mm; }
    .qr { width: 19mm; height: 19mm; flex: none; align-self: center; }
    .qr svg { width: 100%; height: 100%; display: block; }
    .foot { font-size: 5.8pt; color: #5b6b80; padding: 0 3mm 1.5mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  </style></head><body><div class="sheet">${html}</div></body></html>`);
  w.document.close();
  // Print only once every photo has loaded, so none comes out blank.
  await Promise.all([...w.document.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))));
  w.focus();
  w.print();
}
