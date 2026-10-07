/**
 * A plain, text-only PDF: a title and lines of text on A4 pages, in Helvetica. Enough for a
 * statement, with nothing to install, and its text can be read by a screen reader and searched.
 */

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 56;
const SIZE = 11;
const LEADING = 16;
const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - 2 * MARGIN - 40) / LEADING);
const WRAP = 92;

/** Characters Helvetica's standard encoding can show; anything else becomes something close. */
function plain(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E£]/g, '?');
}

function escape(text: string): string {
  return plain(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrap(line: string): string[] {
  if (line.length <= WRAP) return [line];
  const out: string[] = [];
  let current = '';
  for (const word of line.split(' ')) {
    if ((current + ' ' + word).trim().length > WRAP) {
      out.push(current);
      current = word;
    } else {
      current = (current + ' ' + word).trim();
    }
  }
  if (current) out.push(current);
  return out;
}

export function textPdf(title: string, lines: string[]): Buffer {
  const all = lines.flatMap(wrap);
  const pages: string[][] = [];
  for (let index = 0; index < Math.max(1, all.length); index += LINES_PER_PAGE) {
    pages.push(all.slice(index, index + LINES_PER_PAGE));
  }

  const objects: string[] = [];
  const add = (body: string): number => {
    objects.push(body);
    return objects.length;
  };
  const catalog = add('');
  const pagesRef = add('');
  const font = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  );
  const bold = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  );
  const kids: number[] = [];
  pages.forEach((pageLines, pageIndex) => {
    let stream = `BT /F2 16 Tf ${MARGIN} ${PAGE_HEIGHT - MARGIN} Td (${escape(title)}) Tj ET\n`;
    stream += `BT /F1 ${SIZE} Tf ${LEADING} TL ${MARGIN} ${PAGE_HEIGHT - MARGIN - 32} Td\n`;
    for (const line of pageLines) stream += `(${escape(line)}) Tj T*\n`;
    stream += 'ET\n';
    stream += `BT /F1 9 Tf ${MARGIN} ${MARGIN - 20} Td (Page ${pageIndex + 1} of ${pages.length}) Tj ET\n`;
    const content = add(
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream`,
    );
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
          `/Resources << /Font << /F1 ${font} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesRef} 0 R /Lang (en-GB) >>`;
  objects[pagesRef - 1] =
    `<< /Type /Pages /Kids [${kids.map((kid) => `${kid} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const info = add(`<< /Title (${escape(title)}) >>`);

  let output = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(output, 'latin1'));
    output += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output, 'latin1');
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) output += `${String(offset).padStart(10, '0')} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, 'latin1');
}
