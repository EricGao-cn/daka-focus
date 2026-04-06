import { format } from 'date-fns'

import type { Period, PeriodRange } from '../types'

export function timeToMinutes(time: string): number {
  const [hourPart, minutePart] = time.split(':')
  const hours = Number(hourPart)
  const minutes = Number(minutePart)
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return 0
  }
  if (hours === 24 && minutes === 0) {
    return 24 * 60
  }
  return hours * 60 + minutes
}

export function resolvePeriod(date: Date, ranges: PeriodRange[]): Period {
  const current = date.getHours() * 60 + date.getMinutes()
  for (const range of ranges) {
    const start = timeToMinutes(range.start)
    const end = timeToMinutes(range.end)
    if (current >= start && current < end) {
      return range.period
    }
  }
  return 'evening'
}

export function minutesBetween(startAt: string, endAt: string | null, now = new Date()): number {
  const start = new Date(startAt)
  const end = endAt ? new Date(endAt) : now
  const diff = end.getTime() - start.getTime()
  return Math.max(0, Math.floor(diff / 1000 / 60))
}

export function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${hours}h ${minutes.toString().padStart(2, '0')}m`
}

export function formatDateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

export function formatClock(date: Date): string {
  return format(date, 'HH:mm:ss')
}
