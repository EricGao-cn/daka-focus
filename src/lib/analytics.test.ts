import { describe, expect, it } from 'vitest'

import { DEFAULT_SETTINGS } from '../constants'
import { buildWeeklySummary } from './analytics'

import type { EfficiencyRating, Period, ResearchSession } from '../types'

function makeSession(
  startAt: string,
  durationMinutes: number,
  period: Period,
  efficiencyRating: EfficiencyRating | null = null,
): ResearchSession {
  const start = new Date(startAt)
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000)
  return {
    id: `${startAt}-${period}`,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    period,
    goalNote: '',
    reviewNote: '',
    efficiencyRating,
    startupCheckStatus: 'confirmed',
    startupCheckDueAt: new Date(start.getTime() + 5 * 60 * 1000).toISOString(),
    startupCheckPromptedAt: null,
    startupInvalidReason: null,
    interruptCount: 1,
    createdAt: start.toISOString(),
    updatedAt: end.toISOString(),
  }
}

describe('analytics', () => {
  it('aggregates weekly minutes and period distribution', () => {
    const sessions: ResearchSession[] = [
      makeSession('2026-03-30T09:00:00+08:00', 120, 'morning', 'high'),
      makeSession('2026-03-31T14:00:00+08:00', 90, 'afternoon', 'medium'),
      makeSession('2026-04-02T20:00:00+08:00', 60, 'evening'),
    ]

    const summary = buildWeeklySummary(new Date('2026-04-03T12:00:00+08:00'), sessions, DEFAULT_SETTINGS)

    expect(summary.totalMinutes).toBe(270)
    expect(summary.periodMinutes.morning).toBe(120)
    expect(summary.periodMinutes.afternoon).toBe(90)
    expect(summary.periodMinutes.evening).toBe(60)
    expect(summary.bestPeriod).toBe('morning')
    expect(summary.interruptTotal).toBe(3)
    expect(summary.ratingCounts.high).toBe(1)
    expect(summary.ratingCounts.medium).toBe(1)
    expect(summary.ratingCounts.low).toBe(0)
    expect(summary.ratingCounts.unrated).toBe(1)
    expect(summary.ratedSessionCount).toBe(2)
    expect(summary.invalidStartCount).toBe(0)
    expect(summary.effectiveStartRate).toBe(100)
  })

  it('computes current streak and streak delta with break day', () => {
    const sessions: ResearchSession[] = [
      makeSession('2026-03-31T09:00:00+08:00', 20, 'morning'),
      makeSession('2026-04-01T09:10:00+08:00', 20, 'morning'),
      makeSession('2026-04-02T09:20:00+08:00', 20, 'morning'),
      // 2026-04-03 is empty to break streak
      makeSession('2026-04-04T09:00:00+08:00', 20, 'morning'),
    ]

    const summary = buildWeeklySummary(new Date('2026-04-04T20:00:00+08:00'), sessions, DEFAULT_SETTINGS)

    expect(summary.currentStreak).toBe(1)
    expect(summary.streakDelta).toBeGreaterThanOrEqual(0)
  })

  it('excludes invalid startup sessions from effective time and streak metrics', () => {
    const invalidSession = makeSession('2026-04-01T09:00:00+08:00', 120, 'morning')
    invalidSession.startupCheckStatus = 'invalid'
    invalidSession.startupInvalidReason = 'timeout'

    const validSession = makeSession('2026-04-02T09:00:00+08:00', 60, 'morning')

    const summary = buildWeeklySummary(new Date('2026-04-03T12:00:00+08:00'), [invalidSession, validSession], DEFAULT_SETTINGS)

    expect(summary.totalMinutes).toBe(60)
    expect(summary.invalidStartCount).toBe(1)
    expect(summary.startedSessionCount).toBe(2)
    expect(summary.effectiveStartCount).toBe(1)
    expect(summary.effectiveStartRate).toBe(50)
  })
})
