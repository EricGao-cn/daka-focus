import { describe, expect, it } from 'vitest'

import { DEFAULT_SETTINGS } from '../constants'
import { minutesBetween } from './time'
import {
  canStart,
  closeSession,
  confirmStartupCheck,
  createSession,
  invalidateStartupSession,
  markStartupCheckPrompted,
} from './sessionMachine'

describe('sessionMachine', () => {
  it('prevents starting when active session exists', () => {
    const active = createSession('task', DEFAULT_SETTINGS, new Date('2026-04-01T09:10:00+08:00'))
    expect(active.efficiencyRating).toBeNull()
    expect(active.startupCheckStatus).toBe('pending')
    expect(canStart(active)).toBe(false)
    expect(canStart(null)).toBe(true)
  })

  it('closes a cross-day session correctly', () => {
    const start = new Date('2026-04-01T23:55:00+08:00')
    const end = new Date('2026-04-02T00:10:00+08:00')
    const session = createSession('night task', DEFAULT_SETTINGS, start)
    const closed = closeSession(session, 'done', end, 'high')

    expect(closed.endAt).not.toBeNull()
    expect(closed.reviewNote).toBe('done')
    expect(closed.efficiencyRating).toBe('high')
    expect(minutesBetween(closed.startAt, closed.endAt)).toBe(15)
  })

  it('keeps rating as null when closeSession has no efficiency input', () => {
    const session = createSession('task', DEFAULT_SETTINGS, new Date('2026-04-01T10:00:00+08:00'))
    const closed = closeSession(session, 'done', new Date('2026-04-01T10:30:00+08:00'))
    expect(closed.efficiencyRating).toBeNull()
    expect(closed.startupCheckStatus).toBe('confirmed')
  })

  it('throws when closing an ended session twice', () => {
    const session = createSession('task', DEFAULT_SETTINGS, new Date('2026-04-01T10:00:00+08:00'))
    const closed = closeSession(session, 'done', new Date('2026-04-01T10:30:00+08:00'))
    expect(() => closeSession(closed, 'again', new Date('2026-04-01T11:00:00+08:00'))).toThrowError()
  })

  it('marks pending session as prompted then confirmed', () => {
    const session = createSession('task', DEFAULT_SETTINGS, new Date('2026-04-01T10:00:00+08:00'))
    const prompted = markStartupCheckPrompted(session, new Date('2026-04-01T10:05:00+08:00'))
    const confirmed = confirmStartupCheck(prompted, new Date('2026-04-01T10:05:10+08:00'))

    expect(prompted.startupCheckPromptedAt).not.toBeNull()
    expect(confirmed.startupCheckStatus).toBe('confirmed')
    expect(confirmed.startupInvalidReason).toBeNull()
  })

  it('invalidates pending session and closes it', () => {
    const session = createSession('task', DEFAULT_SETTINGS, new Date('2026-04-01T10:00:00+08:00'))
    const invalid = invalidateStartupSession(session, 'timeout', new Date('2026-04-01T10:06:00+08:00'))

    expect(invalid.endAt).not.toBeNull()
    expect(invalid.startupCheckStatus).toBe('invalid')
    expect(invalid.startupInvalidReason).toBe('timeout')
  })
})
