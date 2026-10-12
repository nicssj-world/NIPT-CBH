// Tube label composition — Owner Lock 2026-10-12 (§12.11 addendum) and Genomic-CBH lib/nipt/label-print.ts @44ce3f4.
// The HTML string is kept byte-identical to the legacy buildTubeLabelsHtml (tests/unit/p4-labels.test.ts compares them).
// No barcode bars and no QR: each 30 × 20 mm half prints LN Halos, `LN: <HIS LN>` and optionally an authorized name.
// The `-1/-2/-3` strings are label composition only; they are never analytical attempts or Printed Sample IDs.
export type TubeLabelSample = { ln: string; lnHalos: string; patientName: string | null };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] ?? char));
}

/** The eight halves of one sample in print order: (BASE,BASE) (BASE,BASE) (BASE,BASE-1) (BASE-2,BASE-3). */
export function tubeLabelStickers(code: string): [string, string][] {
  return [[code, code], [code, code], [code, `${code}-1`], [`${code}-2`, `${code}-3`]];
}

function half(lnHalos: string, ln: string, name: string | null, isRight: boolean): string {
  return `<div class="${isRight ? 'right' : 'left'} half">
    <div class="ln-halos">${escapeHtml(lnHalos)}</div>
    <div class="patient-ln">LN: ${escapeHtml(ln)}</div>
    ${name ? `<div class="name">${escapeHtml(name)}</div>` : ''}
  </div>`
}

function sticker(leftCode: string, rightCode: string, ln: string, name: string | null): string {
  return `<div class="sticker">${half(leftCode, ln, name, false)}${half(rightCode, ln, name, true)}</div>`
}

/** Generates four 60×20 mm stickers (eight individual halves) per sample. */
export function buildTubeLabelsHtml(samples: TubeLabelSample[]): string {
  const body = samples.flatMap((sample) => {
    const ln = sample.ln
    const name = sample.patientName
    return tubeLabelStickers(sample.lnHalos).map(([left, right]) => sticker(left, right, ln, name))
  }).join('')

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    @page { size: 60mm 20mm; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Courier New', Courier, monospace; }
    .sticker { width: 60mm; height: 20mm; display: flex; page-break-after: always; overflow: hidden; }
    .sticker:last-child { page-break-after: auto; }
    .half { width: 30mm; height: 20mm; display: flex; flex-direction: column; justify-content: center; gap: 1mm; padding: 1.2mm 1mm 1.2mm 3mm; }
    .right { border-left: 0.5px dashed #555; padding-left: 2.5mm; padding-right: 1mm; }
    .ln-halos { font-size: 7pt; font-weight: 900; letter-spacing: -0.02em; line-height: 1; white-space: nowrap; }
    .patient-ln { font-size: 6pt; font-weight: 700; letter-spacing: -0.02em; color: #222; line-height: 1.1; white-space: nowrap; }
    .name { font-size: 5pt; color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  </style></head><body>${body}</body></html>`
}
