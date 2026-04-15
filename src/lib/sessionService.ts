import { deleteSessionById, getActiveSession, getSessionById, getSettings, listSessions, putSession } from './db'
import {
  bumpInterrupt,
  canStart,
  closeSession,
  createSession,
} from './sessionMachine'

import type { EfficiencyRating, ResearchSession } from '../types'

export async function startResearchSession(goalNote: string): Promise<ResearchSession> {
  const active = await getActiveSession()
  if (!canStart(active)) {
    throw new Error('你有一个未结束会话，请先结束后再开始。')
  }

  const settings = await getSettings()
  const session = createSession(goalNote, settings)
  await putSession(session)
  return session
}

export async function endResearchSession(
  reviewNote: string,
  efficiencyRating: EfficiencyRating | null = null,
  markInvalidStartup = false,
): Promise<ResearchSession> {
  const active = await getActiveSession()
  if (!active) {
    throw new Error('当前没有进行中的会话。')
  }

  const updated = closeSession(active, reviewNote, new Date(), efficiencyRating, markInvalidStartup)
  await putSession(updated)
  return updated
}

export async function incrementInterrupt(sessionId: string): Promise<ResearchSession> {
  const session = await getSessionById(sessionId)
  if (!session) {
    throw new Error('会话不存在。')
  }

  const updated = bumpInterrupt(session)
  await putSession(updated)
  return updated
}

export async function removeFinishedSession(sessionId: string): Promise<void> {
  const session = await getSessionById(sessionId)
  if (!session) {
    throw new Error('会话不存在。')
  }

  if (session.endAt === null) {
    throw new Error('进行中的会话不能删除，请先结束。')
  }

  await deleteSessionById(sessionId)
}

export async function getSessionSnapshot(): Promise<{
  sessions: ResearchSession[]
  activeSession: ResearchSession | null
}> {
  const sessions = await listSessions()
  const activeSession = sessions.find((session) => session.endAt === null) ?? null
  return { sessions, activeSession }
}
