import { STARTUP_CHECK_DELAY_MS } from '../constants'
import { resolvePeriod } from './time'

import type { EfficiencyRating, ResearchSession, StartupInvalidReason, UserSettings } from '../types'

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
    startupCheckStatus: 'pending',
    startupCheckDueAt: new Date(now.getTime() + STARTUP_CHECK_DELAY_MS).toISOString(),
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
): ResearchSession {
  if (session.endAt) {
    throw new Error('会话已经结束，不能重复结束。')
  }

  return {
    ...session,
    endAt: now.toISOString(),
    reviewNote: reviewNote.trim(),
    efficiencyRating: efficiencyRating ?? session.efficiencyRating ?? null,
    startupCheckStatus: session.startupCheckStatus === 'invalid' ? 'invalid' : 'confirmed',
    startupInvalidReason: session.startupCheckStatus === 'invalid' ? session.startupInvalidReason : null,
    updatedAt: now.toISOString(),
  }
}

export function markStartupCheckPrompted(session: ResearchSession, now = new Date()): ResearchSession {
  if (session.endAt) {
    throw new Error('会话已结束，不能再触发二次确认。')
  }
  if (session.startupCheckStatus !== 'pending') {
    throw new Error('当前会话不是待确认状态。')
  }
  if (session.startupCheckPromptedAt) {
    return session
  }

  return {
    ...session,
    startupCheckPromptedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }
}

export function confirmStartupCheck(session: ResearchSession, now = new Date()): ResearchSession {
  if (session.endAt) {
    throw new Error('会话已结束，不能确认二次检查。')
  }
  if (session.startupCheckStatus !== 'pending') {
    return session
  }

  return {
    ...session,
    startupCheckStatus: 'confirmed',
    startupInvalidReason: null,
    updatedAt: now.toISOString(),
  }
}

export function invalidateStartupSession(
  session: ResearchSession,
  reason: StartupInvalidReason,
  now = new Date(),
): ResearchSession {
  if (session.endAt) {
    throw new Error('会话已结束，不能标记无效启动。')
  }
  if (session.startupCheckStatus !== 'pending') {
    throw new Error('当前会话不是待确认状态，不能标记无效启动。')
  }

  return {
    ...session,
    endAt: now.toISOString(),
    reviewNote: reason === 'timeout' ? '二次确认超时：系统自动结束并记为无效启动。' : '用户自报分心：结束并记为无效启动。',
    startupCheckStatus: 'invalid',
    startupCheckPromptedAt: session.startupCheckPromptedAt ?? now.toISOString(),
    startupInvalidReason: reason,
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
