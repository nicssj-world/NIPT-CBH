// VENDORED READ-ONLY PARITY ORACLE — nicssj-world/Genomic-CBH@44ce3f4d413eb73e203247d43bb7d727f1f54d19 lib/nipt/label-print.ts
// Only change: the type-only import of SampleRow is replaced by a local structural type. Do not edit; re-vendor instead.
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
    @page { size: 60mm 20mm; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Courier New', Courier, monospace; }
    .sticker { width: 60mm; height: 20mm; display: flex; overflow: hidden; }
    .half { width: 30mm; height: 20mm; display: flex; flex-direction: column; justify-content: center; gap: 1.5mm; padding: 2mm 1.5mm 2mm 8mm; }
    .right { border-left: 0.5px dashed #555; padding-left: 5mm; }
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
export function buildTubeLabelsHtml(samples: Pick<SampleRow, 'ln' | 'lnHalos' | 'patientName'>[]): string {
  const body = samples.flatMap((sample) => {
    const code = sample.lnHalos
    const ln = sample.ln
    const name = sample.patientName
    return [
      sticker(code, code, ln, name),
      sticker(code, code, ln, name),
      sticker(code, `${code}-1`, ln, name),
      sticker(`${code}-2`, `${code}-3`, ln, name),
    ]
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

export function printTubeLabels(samples: SampleRow[]): void {
  const win = window.open('', '_blank')
  if (!win) return
  win.document.write(buildTubeLabelsHtml(samples))
  win.document.close()
  win.focus()
  setTimeout(() => { win.print() }, 250)
}
