import { describe, expect, it } from 'vitest'

import { DEFAULT_SETTINGS } from '../constants'
import { markEndReminderSnoozed, shouldNotifyReminder, shouldTriggerEndReminder } from './reminder'

import type { ReminderState, ResearchSession } from '../types'

const emptyState: ReminderState = {
  dateKey: '2026-04-01',
  remindedPeriods: [],
  endReminderDonePeriods: [],
  endReminderSnoozeUntil: {},
}

function makeMorningSession(): ResearchSession {
  return {
    id: 's1',
    startAt: new Date('2026-04-01T09:10:00+08:00').toISOString(),
    endAt: new Date('2026-04-01T09:40:00+08:00').toISOString(),
    period: 'morning',
    goalNote: '',
    reviewNote: '',
    efficiencyRating: null,
    startupCheckStatus: 'confirmed',
    startupCheckDueAt: new Date('2026-04-01T09:15:00+08:00').toISOString(),
    startupCheckPromptedAt: null,
    startupInvalidReason: null,
    interruptCount: 0,
    createdAt: new Date('2026-04-01T09:10:00+08:00').toISOString(),
    updatedAt: new Date('2026-04-01T09:40:00+08:00').toISOString(),
  }
}

describe('reminder', () => {
  it('returns due period when time matches and not reminded', () => {
    const result = shouldNotifyReminder(
      new Date('2026-04-01T09:00:00+08:00'),
      DEFAULT_SETTINGS,
      emptyState,
      [],
    )
    expect(result).toBe('morning')
  })

  it('deduplicates reminders in the same period', () => {
    const result = shouldNotifyReminder(
      new Date('2026-04-01T09:00:00+08:00'),
      DEFAULT_SETTINGS,
      { ...emptyState, remindedPeriods: ['morning'] },
      [],
    )
    expect(result).toBeNull()
  })

  it('skips reminder when session already started in that period', () => {
    const result = shouldNotifyReminder(
      new Date('2026-04-01T09:00:00+08:00'),
      DEFAULT_SETTINGS,
      emptyState,
      [makeMorningSession()],
    )
    expect(result).toBeNull()
  })

  it('triggers end reminder at configured morning reminder time', () => {
    const activeSession: ResearchSession = {
      ...makeMorningSession(),
      endAt: null,
    }
    const result = shouldTriggerEndReminder(
      new Date('2026-04-01T11:50:00+08:00'),
      DEFAULT_SETTINGS,
      emptyState,
      activeSession,
    )
    expect(result).toBe('morning')
  })

  it('respects end reminder snooze', () => {
    const activeSession: ResearchSession = {
      ...makeMorningSession(),
      endAt: null,
    }
    const snoozed = markEndReminderSnoozed(
      emptyState,
      'morning',
      new Date('2026-04-01T11:59:00+08:00'),
    )

    const before = shouldTriggerEndReminder(
      new Date('2026-04-01T11:50:00+08:00'),
      DEFAULT_SETTINGS,
      snoozed,
      activeSession,
    )
    expect(before).toBeNull()

    const after = shouldTriggerEndReminder(
      new Date('2026-04-01T12:00:00+08:00'),
      DEFAULT_SETTINGS,
      snoozed,
      activeSession,
    )
    expect(after).toBe('morning')
  })

  it('does not trigger end reminder for evening session', () => {
    const eveningSession: ResearchSession = {
      ...makeMorningSession(),
      period: 'evening',
      endAt: null,
    }
    const result = shouldTriggerEndReminder(
      new Date('2026-04-01T23:50:00+08:00'),
      DEFAULT_SETTINGS,
      emptyState,
      eveningSession,
    )
    expect(result).toBeNull()
  })
})
