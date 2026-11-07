// Tiny dependency-free PDF writer for tests: one page per entry, each line drawn with Helvetica (ASCII only).
// Real-world PDFs are far messier; this only has to give pdf.js a valid file with known text on known pages.

const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);

/** @param {string[][]} pages lines of text per page  @param {{ title?: string }} [opts] */
export function makePdf(pages, opts = {}) {
  const objs = []; // objs[i] is the body of object i+1
  const add = (body) => objs.push(body) && objs.length;
  const catalog = add(""); // patched below
  const pagesObj = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const kids = [];
  for (const lines of pages) {
    const ops = ["BT", "/F1 12 Tf", "14 TL", "72 760 Td", ...lines.map((l) => `(${esc(l)}) Tj T*`), "ET"].join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(ops, "latin1")} >>\nstream\n${ops}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  const info = opts.title ? add(`<< /Title (${esc(opts.title)}) >>`) : 0;

  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R${info ? ` /Info ${info} 0 R` : ""} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
