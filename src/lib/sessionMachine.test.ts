import { describe, expect, it } from 'vitest'

import { DEFAULT_SETTINGS } from '../constants'
import { minutesBetween } from './time'
import {
  canStart,
  closeSession,
  createSession,
} from './sessionMachine'

describe('sessionMachine', () => {
  it('prevents starting when active session exists', () => {
    const active = createSession('task', DEFAULT_SETTINGS, new Date('2026-04-01T09:10:00+08:00'))
    expect(active.efficiencyRating).toBeNull()
    expect(active.startupCheckStatus).toBe('confirmed')
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

  it('can mark session as invalid startup during normal end flow', () => {
    const session = createSession('task', DEFAULT_SETTINGS, new Date('2026-04-01T10:00:00+08:00'))
    const closed = closeSession(session, 'done', new Date('2026-04-01T10:30:00+08:00'), 'medium', true)
    expect(closed.startupCheckStatus).toBe('invalid')
    expect(closed.startupInvalidReason).toBe('self_reported')
  })

  it('throws when closing an ended session twice', () => {
    const session = createSession('task', DEFAULT_SETTINGS, new Date('2026-04-01T10:00:00+08:00'))
    const closed = closeSession(session, 'done', new Date('2026-04-01T10:30:00+08:00'))
    expect(() => closeSession(closed, 'again', new Date('2026-04-01T11:00:00+08:00'))).toThrowError()
  })
})
