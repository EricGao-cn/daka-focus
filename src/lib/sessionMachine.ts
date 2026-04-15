import { resolvePeriod } from './time'

import type { EfficiencyRating, ResearchSession, UserSettings } from '../types'

export function createSession(goalNote: string, settings: UserSettings, now = new Date()): ResearchSession {
  const isoNow = now.toISOString()
  return {
    id: crypto.randomUUID(),
    startAt: isoNow,
    endAt: null,
    period: resolvePeriod(now, settings.periodRanges),
    goalNote: goalNote.trim(),
    reviewNote: '',
    efficiencyRating: null,
    startupCheckStatus: 'confirmed',
    startupCheckDueAt: isoNow,
    startupCheckPromptedAt: null,
    startupInvalidReason: null,
    interruptCount: 0,
    createdAt: isoNow,
    updatedAt: isoNow,
  }
}

export function canStart(activeSession: ResearchSession | null): boolean {
  return activeSession === null
}

export function closeSession(
  session: ResearchSession,
  reviewNote: string,
  now = new Date(),
  efficiencyRating: EfficiencyRating | null = null,
  markInvalidStartup = false,
): ResearchSession {
  if (session.endAt) {
    throw new Error('会话已经结束，不能重复结束。')
  }

  const shouldMarkInvalid = markInvalidStartup || session.startupCheckStatus === 'invalid'

  return {
    ...session,
    endAt: now.toISOString(),
    reviewNote: reviewNote.trim(),
    efficiencyRating: efficiencyRating ?? session.efficiencyRating ?? null,
    startupCheckStatus: shouldMarkInvalid ? 'invalid' : 'confirmed',
    startupCheckPromptedAt: shouldMarkInvalid ? session.startupCheckPromptedAt ?? now.toISOString() : session.startupCheckPromptedAt,
    startupInvalidReason: shouldMarkInvalid
      ? (session.startupInvalidReason ?? 'self_reported')
      : null,
    updatedAt: now.toISOString(),
  }
}

export function bumpInterrupt(session: ResearchSession): ResearchSession {
  if (session.endAt) {
    throw new Error('会话已结束，不能增加中断次数。')
  }

  return {
    ...session,
    interruptCount: session.interruptCount + 1,
    updatedAt: new Date().toISOString(),
  }
}
