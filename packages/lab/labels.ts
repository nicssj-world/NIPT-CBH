// Tube label composition — Owner Lock 2026-10-12 (§12.11 addendum) and Genomic-CBH lib/nipt/label-print.ts @57de674 (owner size correction 2026-10-15).
// The HTML remains byte-identical to the current Genomic-CBH print layout (tested against a versioned fixture).
// No barcode bars and no QR: each 25 × 20 mm half prints LN Halos, `LN: <HIS LN>` and optionally an authorized name.
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

function cornerSequence(lnHalos: string): string {
  return /^\d{2}B\d{6}(\d{3})D?$/.exec(lnHalos)?.[1] ?? ''
}

function half(lnHalos: string, ln: string, name: string | null, isRight: boolean, sequence: string): string {
  const lnSize = Math.floor(Math.min(6, (20 * 72 / 25.4) / ((ln.length + 4) * 0.6)) * 10) / 10
  const lnStyle = lnSize < 6 ? ` style="font-size: ${lnSize}pt"` : ''
  const corners = sequence
    ? `<div class="corner-set" aria-hidden="true">
      <span class="corner tl">${sequence}</span><span class="corner tr">${sequence}</span>
      <span class="corner bl">${sequence}</span><span class="corner br">${sequence}</span>
    </div>`
    : ''
  return `<div class="${isRight ? 'right' : 'left'} half">
    <div class="ln-halos">${escapeHtml(lnHalos)}</div>
    <div class="patient-ln"${lnStyle}>LN: ${escapeHtml(ln)}</div>
    ${name ? `<div class="name">${escapeHtml(name)}</div>` : ''}
    ${corners}
  </div>`
}

function sticker(leftCode: string, rightCode: string, ln: string, name: string | null, sequence: string): string {
  return `<div class="sticker">${half(leftCode, ln, name, false, sequence)}${half(rightCode, ln, name, true, sequence)}</div>`
}

/** Generates four 50×20 mm stickers (eight individual halves) per sample. */
export function buildTubeLabelsHtml(samples: TubeLabelSample[]): string {
  const body = samples.flatMap((sample) => {
    const ln = sample.ln
    const name = sample.patientName
    const sequence = cornerSequence(sample.lnHalos)
    return tubeLabelStickers(sample.lnHalos).map(([left, right]) => sticker(left, right, ln, name, sequence))
  }).join('')

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    @page { size: 50mm 20mm; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Courier New', Courier, monospace; }
    .sticker { width: 50mm; height: 20mm; display: flex; page-break-after: always; overflow: hidden; }
    .sticker:last-child { page-break-after: auto; }
    .half { position: relative; width: 25mm; height: 20mm; display: flex; flex-direction: column; justify-content: center; gap: 1mm; padding: 1.2mm 1mm 1.2mm 3mm; overflow: hidden; }
    .right { border-left: 0.5px dashed #555; padding-left: 2.5mm; padding-right: 1mm; }
    .ln-halos { font-size: 6.5pt; font-weight: 900; letter-spacing: -0.02em; line-height: 1; white-space: nowrap; }
    .patient-ln { font-size: 6pt; font-weight: 700; letter-spacing: -0.02em; color: #222; line-height: 1.1; white-space: nowrap; }
    .name { font-size: 5pt; color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    /* Physical corner inset: at least 2.7mm from the centre cut on both sides. */
    .corner { position: absolute; display: flex; align-items: center; justify-content: center; width: 5.6mm; height: 2.6mm; font-size: 6.5pt; font-weight: 900; line-height: 1; white-space: nowrap; color: #111; transform: rotate(-90deg); }
    .corner.tl, .corner.bl { left: -0.6mm; }
    .corner.tr, .corner.br { right: -0.6mm; }
    .corner.tl, .corner.tr { top: 2.2mm; }
    .corner.bl, .corner.br { bottom: 2.2mm; }
    .left .corner.tr, .left .corner.br { right: 1.2mm; }
    .right .corner.tl, .right .corner.bl { left: 1.2mm; }
  </style></head><body>${body}</body></html>`
}
