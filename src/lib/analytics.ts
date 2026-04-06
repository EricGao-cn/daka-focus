import {
  addDays,
  eachDayOfInterval,
  endOfDay,
  endOfWeek,
  isWithinInterval,
  startOfDay,
  startOfWeek,
  subDays,
} from 'date-fns'

import { PERIODS } from '../constants'
import { formatDateKey, minutesBetween } from './time'

import type { DailySummary, Period, ResearchSession, UserSettings, WeeklySummary } from '../types'

function initPeriodMinutes(): Record<Period, number> {
  return {
    morning: 0,
    afternoon: 0,
    evening: 0,
  }
}

function initRatingCounts(): WeeklySummary['ratingCounts'] {
  return {
    high: 0,
    medium: 0,
    low: 0,
    unrated: 0,
  }
}

function isInvalidStartupSession(session: ResearchSession): boolean {
  return session.startupCheckStatus === 'invalid'
}

export function sessionMinutes(session: ResearchSession, now = new Date()): number {
  return minutesBetween(session.startAt, session.endAt, now)
}

export function isValidSession(session: ResearchSession, minimumMinutes: number, now = new Date()): boolean {
  return sessionMinutes(session, now) >= minimumMinutes
}

function sessionsOnDate(sessions: ResearchSession[], date: Date): ResearchSession[] {
  const start = startOfDay(date)
  const end = endOfDay(date)
  return sessions.filter((session) => {
    const startedAt = new Date(session.startAt)
    return isWithinInterval(startedAt, { start, end })
  })
}

export function buildDailySummary(
  date: Date,
  sessions: ResearchSession[],
  settings: UserSettings,
  now = new Date(),
): DailySummary {
  const dailySessions = sessionsOnDate(sessions, date)
  const effectiveSessions = dailySessions.filter((session) => !isInvalidStartupSession(session))
  const periodMinutes = initPeriodMinutes()

  let totalMinutes = 0
  let validSessionCount = 0
  let interruptTotal = 0

  for (const session of effectiveSessions) {
    const minutes = sessionMinutes(session, now)
    totalMinutes += minutes
    periodMinutes[session.period] += minutes
    interruptTotal += session.interruptCount
    if (isValidSession(session, settings.streakMinMinutes, now)) {
      validSessionCount += 1
    }
  }

  const startedSessionCount = dailySessions.length
  const invalidStartCount = dailySessions.filter((session) => isInvalidStartupSession(session)).length
  const effectiveStartCount = startedSessionCount - invalidStartCount
  const effectiveStartRate = startedSessionCount > 0
    ? Math.round((effectiveStartCount / startedSessionCount) * 100)
    : null

  return {
    dateKey: formatDateKey(date),
    totalMinutes,
    periodMinutes,
    sessionCount: dailySessions.length,
    startedSessionCount,
    invalidStartCount,
    effectiveStartCount,
    effectiveStartRate,
    validSessionCount,
    hasValidSession: validSessionCount > 0,
    goalReached: totalMinutes >= settings.dailyGoalMinutes,
    interruptTotal,
  }
}

function streakAtDate(date: Date, sessions: ResearchSession[], settings: UserSettings, now = new Date()): number {
  let streak = 0
  let cursor = startOfDay(date)

  while (true) {
    const daily = buildDailySummary(cursor, sessions, settings, now)
    const passed = daily.hasValidSession && daily.totalMinutes >= settings.streakMinMinutes
    if (!passed) {
      break
    }
    streak += 1
    cursor = subDays(cursor, 1)
  }

  return streak
}

export function buildWeeklySummary(
  referenceDate: Date,
  sessions: ResearchSession[],
  settings: UserSettings,
  now = new Date(),
): WeeklySummary {
  const start = startOfWeek(referenceDate, { weekStartsOn: 1 })
  const end = endOfWeek(referenceDate, { weekStartsOn: 1 })
  const days = eachDayOfInterval({ start, end })

  const periodMinutes = initPeriodMinutes()
  const ratingCounts = initRatingCounts()
  let totalMinutes = 0
  let dailyGoalReachedDays = 0
  let interruptTotal = 0
  let startedSessionCount = 0
  let invalidStartCount = 0
  let effectiveStartCount = 0

  for (const day of days) {
    const summary = buildDailySummary(day, sessions, settings, now)
    totalMinutes += summary.totalMinutes
    interruptTotal += summary.interruptTotal
    startedSessionCount += summary.startedSessionCount
    invalidStartCount += summary.invalidStartCount
    effectiveStartCount += summary.effectiveStartCount
    if (summary.goalReached) {
      dailyGoalReachedDays += 1
    }
    for (const period of PERIODS) {
      periodMinutes[period] += summary.periodMinutes[period]
    }
  }

  const bestPeriod = PERIODS.reduce<Period | null>((current, period) => {
    if (current === null || periodMinutes[period] > periodMinutes[current]) {
      return period
    }
    return current
  }, null)

  const last7Days = eachDayOfInterval({ start: subDays(referenceDate, 6), end: referenceDate }).map((day) => ({
    dateKey: formatDateKey(day),
    minutes: buildDailySummary(day, sessions, settings, now).totalMinutes,
  }))

  const weekEndStreak = streakAtDate(end, sessions, settings, now)
  const beforeWeek = subDays(start, 1)
  const streakBeforeWeek = streakAtDate(beforeWeek, sessions, settings, now)
  let ratedSessionCount = 0

  for (const session of sessions) {
    const startedAt = new Date(session.startAt)
    if (!isWithinInterval(startedAt, { start, end }) || isInvalidStartupSession(session)) {
      continue
    }

    if (session.efficiencyRating === null) {
      ratingCounts.unrated += 1
    } else {
      ratingCounts[session.efficiencyRating] += 1
      ratedSessionCount += 1
    }
  }

  const effectiveStartRate = startedSessionCount > 0
    ? Math.round((effectiveStartCount / startedSessionCount) * 100)
    : null

  return {
    weekStartKey: formatDateKey(start),
    weekEndKey: formatDateKey(end),
    totalMinutes,
    periodMinutes,
    dailyGoalReachedDays,
    weeklyGoalReached: totalMinutes >= settings.weeklyGoalMinutes,
    last7Days,
    bestPeriod,
    currentStreak: streakAtDate(referenceDate, sessions, settings, now),
    streakDelta: weekEndStreak - streakBeforeWeek,
    interruptTotal,
    startedSessionCount,
    invalidStartCount,
    effectiveStartCount,
    effectiveStartRate,
    ratingCounts,
    ratedSessionCount,
  }
}

export function hasStartedSessionInPeriod(date: Date, period: Period, sessions: ResearchSession[]): boolean {
  const start = startOfDay(date)
  const end = endOfDay(date)
  return sessions.some((session) => {
    if (session.period !== period) {
      return false
    }
    const startedAt = new Date(session.startAt)
    return isWithinInterval(startedAt, { start, end })
  })
}

export function getWeeklyReportSentence(summary: WeeklySummary): string {
  const streakSign = summary.streakDelta >= 0 ? '+' : ''
  const highRatio = summary.ratedSessionCount > 0
    ? Math.round((summary.ratingCounts.high / summary.ratedSessionCount) * 100)
    : 0
  return `本周总时长 ${summary.totalMinutes} 分钟，最佳时段 ${summary.bestPeriod ?? '无'}，连续天数变化 ${streakSign}${summary.streakDelta}，高效占比 ${highRatio}%，未评 ${summary.ratingCounts.unrated} 次。`
}

export function getReportWindow(referenceDate: Date): { start: Date; end: Date } {
  const start = startOfWeek(referenceDate, { weekStartsOn: 1 })
  const end = addDays(start, 6)
  return { start, end }
}
