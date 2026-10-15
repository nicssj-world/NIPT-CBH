// VERIFIED PRINT PARITY ORACLE — Genomic-CBH physical 50 × 20 mm stock, corner sequence (2026-10-15).
// Only type import replaced; keep historical source fixture at label-print.ts untouched.
type SampleRow = { ln: string; lnHalos: string; patientName: string | null }

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] ?? char))
}

export function printBoxLabel(bkLabel: string, bcLabel: string): void {
  const backupLabel = escapeHtml(bkLabel)
  const buffyCoatLabel = escapeHtml(bcLabel)
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    @page { size: 50mm 20mm; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Courier New', Courier, monospace; }
    .sticker { width: 50mm; height: 20mm; display: flex; overflow: hidden; }
    .half { width: 25mm; height: 20mm; display: flex; flex-direction: column; justify-content: center; gap: 1.5mm; padding: 2mm 1mm 2mm 3mm; }
    .right { border-left: 0.5px dashed #555; padding-left: 3mm; }
    .box { font-size: 7pt; font-weight: 900; letter-spacing: -0.02em; line-height: 1; white-space: nowrap; }
    .type { font-size: 5pt; color: #333; white-space: nowrap; }
  </style></head><body>
    <div class="sticker">
      <div class="half">
        <div class="box">${backupLabel}</div>
        <div class="type">Backup Box</div>
      </div>
      <div class="half right">
        <div class="box">${buffyCoatLabel}</div>
        <div class="type">Buffy Coat Box</div>
      </div>
    </div>
  </body></html>`
  const win = window.open('', '_blank')
  if (!win) return
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => { win.print() }, 250)
}

/** Three digits from the issued LN Halos (not the tube suffix -1/-2/-3). */
function cornerSequence(lnHalos: string): string {
  return /^\d{2}B\d{6}(\d{3})D?$/.exec(lnHalos)?.[1] ?? ''
}

function half(lnHalos: string, ln: string, name: string | null, isRight: boolean, sequence: string): string {
  const corners = sequence
    ? `<div class="corner-set" aria-hidden="true">
      <span class="corner tl">${sequence}</span><span class="corner tr">${sequence}</span>
      <span class="corner bl">${sequence}</span><span class="corner br">${sequence}</span>
    </div>`
    : ''
  return `<div class="${isRight ? 'right' : 'left'} half">
    <div class="ln-halos">${escapeHtml(lnHalos)}</div>
    <div class="patient-ln">LN: ${escapeHtml(ln)}</div>
    ${name ? `<div class="name">${escapeHtml(name)}</div>` : ''}
    ${corners}
  </div>`
}

function sticker(leftCode: string, rightCode: string, ln: string, name: string | null, sequence: string): string {
  return `<div class="sticker">${half(leftCode, ln, name, false, sequence)}${half(rightCode, ln, name, true, sequence)}</div>`
}

/** Generates four 50×20 mm stickers (eight individual halves) per sample. */
export function buildTubeLabelsHtml(samples: Pick<SampleRow, 'ln' | 'lnHalos' | 'patientName'>[]): string {
  const body = samples.flatMap((sample) => {
    const code = sample.lnHalos
    const sequence = cornerSequence(code)
    const ln = sample.ln
    const name = sample.patientName
    return [
      sticker(code, code, ln, name, sequence),
      sticker(code, code, ln, name, sequence),
      sticker(code, `${code}-1`, ln, name, sequence),
      sticker(`${code}-2`, `${code}-3`, ln, name, sequence),
    ]
  }).join('')

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    @page { size: 50mm 20mm; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Courier New', Courier, monospace; }
    .sticker { width: 50mm; height: 20mm; display: flex; page-break-after: always; overflow: hidden; }
    .sticker:last-child { page-break-after: auto; }
    .half { position: relative; width: 25mm; height: 20mm; display: flex; flex-direction: column; justify-content: center; gap: 1mm; padding: 1.2mm 0.8mm 1.2mm 2.5mm; min-width: 0; flex: 0 0 25mm; overflow: hidden; }
    .right { border-left: 0.5px dashed #555; padding-left: 2.5mm; padding-right: 0.8mm; }
    .ln-halos { font-size: 7pt; font-weight: 900; letter-spacing: -0.02em; line-height: 1; white-space: nowrap; }
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

export function printTubeLabels(samples: SampleRow[]): void {
  const win = window.open('', '_blank')
  if (!win) return
  win.document.write(buildTubeLabelsHtml(samples))
  win.document.close()
  win.focus()
  setTimeout(() => { win.print() }, 250)
}
