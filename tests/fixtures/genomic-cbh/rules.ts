// VENDORED READ-ONLY PARITY ORACLE — nicssj-world/Genomic-CBH@44ce3f4d413eb73e203247d43bb7d727f1f54d19 lib/nipt/rules.ts (unchanged). Do not edit; re-vendor instead.
export const BANGKOK_TIME_ZONE = 'Asia/Bangkok'

export const STAGES = ['Received', 'Extract', 'Pooling', 'Sequencing', 'Completed'] as const
export type SampleStage = (typeof STAGES)[number]

export const RUN_TYPES = ['Normal', 'Re-Library', 'Re-Sampling'] as const
export type RunType = (typeof RUN_TYPES)[number]

export const PREGNANCY_TYPES = ['Single', 'Twin'] as const
export type PregnancyType = (typeof PREGNANCY_TYPES)[number]

export const RUN_SUFFIX: Record<RunType, string> = {
  Normal: '-1',
  'Re-Library': '-2',
  'Re-Sampling': 'R',
}

export const CONTROL_SLOTS = {
  1: 'positive',
  25: 'negative',
  40: 'blank',
} as const

export type ControlType = (typeof CONTROL_SLOTS)[keyof typeof CONTROL_SLOTS]

export const PATIENT_SLOTS = Array.from({ length: 48 }, (_, index) => index + 1).filter(
  (slot) => !(slot in CONTROL_SLOTS),
)

export const STORAGE_BOX_CAPACITY = 81
export const STORAGE_WARNING_DAYS = 90

export const STORAGE_BOX_TYPES = ['buffy_coat', 'backup'] as const
export type StorageBoxType = (typeof STORAGE_BOX_TYPES)[number]
export const STORAGE_BOX_TYPE_LABEL: Record<StorageBoxType, string> = {
  buffy_coat: 'Buffy Coat',
  backup: 'Backup',
}

export const SHEET_SLOT_RANGES = {
  1: [1, 16],
  2: [17, 32],
  3: [33, 48],
} as const

export function formatBangkokDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BANGKOK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''

  return { year: get('year'), month: get('month'), day: get('day') }
}

export function formatBangkokIsoDate(date = new Date()) {
  const { year, month, day } = formatBangkokDateParts(date)
  return `${year}-${month}-${day}`
}

export function formatLnHalos(sequence: number, date = new Date()) {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 999) {
    throw new Error('LN Halos daily sequence must be between 1 and 999')
  }
  const { year, month, day } = formatBangkokDateParts(date)
  return `${year.slice(-2)}B${year.slice(-2)}${month}${day}${String(sequence).padStart(3, '0')}`
}

export function formatControlCode(type: ControlType, isoDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return ''
  const [year, month, day] = isoDate.split('-')
  const marker = type === 'positive' ? '1' : type === 'negative' ? '2' : '3'
  return `${year.slice(-2)}N${marker}${year}${month}${day}`
}

export function formatRunSampleId(lnHalos: string, runType: RunType) {
  return `${lnHalos}${RUN_SUFFIX[runType]}`
}

export function formatGestationalAge(weeks: number | null, days: number | null) {
  if (weeks === null && days === null) return '-'
  if (weeks === null) return `?W ${days}D`
  if (days === null) return `${weeks}W ?D`
  return `${weeks}W ${days}D`
}

export function isGestationalAgeComplete(weeks: number | null, days: number | null) {
  return (weeks === null) === (days === null)
}

export function isGestationalAgeWarning(weeks: number | null) {
  return weeks !== null && weeks >= 22
}

export function getSheetNumber(slot: number) {
  if (slot < 1 || slot > 48) throw new Error('Plate slot must be between 1 and 48')
  return slot <= 16 ? 1 : slot <= 32 ? 2 : 3
}

export function getPlatePosition(slot: number) {
  if (slot < 1 || slot > 48) throw new Error('Plate slot must be between 1 and 48')
  const letters = 'ABCDEFGH'
  return `${letters[(slot - 1) % 8]}${Math.floor((slot - 1) / 8) + 1}`
}

export function getStoragePosition(slot: number) {
  if (slot < 1 || slot > STORAGE_BOX_CAPACITY) throw new Error('Storage slot must be between 1 and 81')
  const letters = 'ABCDEFGHI'
  return `${letters[(slot - 1) % 9]}${Math.floor((slot - 1) / 9) + 1}`
}

export type StorageDueState = 'not-started' | 'scheduled' | 'due-soon' | 'due' | 'overdue'

export function getStorageDueState(dueDate: string | null, today = formatBangkokIsoDate()) {
  if (!dueDate) return { state: 'not-started' as const, daysRemaining: null }
  const millisecondsPerDay = 24 * 60 * 60 * 1000
  const daysRemaining = Math.round((Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / millisecondsPerDay)
  const state: StorageDueState =
    daysRemaining < 0 ? 'overdue' :
    daysRemaining === 0 ? 'due' :
    daysRemaining <= STORAGE_WARNING_DAYS ? 'due-soon' :
    'scheduled'
  return { state, daysRemaining }
}
