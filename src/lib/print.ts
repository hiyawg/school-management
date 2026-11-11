// Opens a document (payslip, invoice, receipt) alone in a new window and prints it, so the app's layout never ends up on paper.
export function printNode(node: HTMLElement, title: string) {
  const w = window.open("", "_blank", "width=720,height=900");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
    body { font: 13px/1.45 system-ui, sans-serif; color: #111; margin: 32px; }
    h2 { margin: 0 0 4px; font-size: 18px; } table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    td { padding: 4px 0; border-bottom: 1px solid #ddd; } td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
    .muted { color: #555; } .total td { font-weight: 700; border-bottom: 2px solid #111; } .section td { padding-top: 12px; font-weight: 600; border: 0; }
    button { display: none; }
  </style></head><body>${node.innerHTML}</body></html>`);
  w.document.close();
  w.focus();
  w.print();
}
