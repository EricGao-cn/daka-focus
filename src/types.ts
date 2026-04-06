export type Period = 'morning' | 'afternoon' | 'evening'
export type EndReminderPeriod = Extract<Period, 'morning' | 'afternoon'>
export type EfficiencyRating = 'high' | 'medium' | 'low'
export type StartupCheckStatus = 'pending' | 'confirmed' | 'invalid'
export type StartupInvalidReason = 'timeout' | 'self_reported'

export interface PeriodRange {
  period: Period
  start: string
  end: string
}

export interface ResearchSession {
  id: string
  startAt: string
  endAt: string | null
  period: Period
  goalNote: string
  reviewNote: string
  efficiencyRating: EfficiencyRating | null
  startupCheckStatus: StartupCheckStatus
  startupCheckDueAt: string
  startupCheckPromptedAt: string | null
  startupInvalidReason: StartupInvalidReason | null
  interruptCount: number
  createdAt: string
  updatedAt: string
}

export interface UserSettings {
  timezone: string
  periodRanges: PeriodRange[]
  reminderTimes: Record<Period, string>
  dailyGoalMinutes: number
  weeklyGoalMinutes: number
  streakMinMinutes: number
  endReminderEnabled: boolean
  endReminderTimes: Record<EndReminderPeriod, string>
  mobilePush: MobilePushSettings
}

export interface MobilePushSettings {
  enabled: boolean
  channel: 'bark'
  barkServer: string
  barkDeviceKey: string
  barkGroup: string
}

export interface ReminderState {
  dateKey: string
  remindedPeriods: Period[]
  endReminderDonePeriods: EndReminderPeriod[]
  endReminderSnoozeUntil: Partial<Record<EndReminderPeriod, string>>
}

export interface DailySummary {
  dateKey: string
  totalMinutes: number
  periodMinutes: Record<Period, number>
  sessionCount: number
  startedSessionCount: number
  invalidStartCount: number
  effectiveStartCount: number
  effectiveStartRate: number | null
  validSessionCount: number
  hasValidSession: boolean
  goalReached: boolean
  interruptTotal: number
}

export interface WeeklySummary {
  weekStartKey: string
  weekEndKey: string
  totalMinutes: number
  periodMinutes: Record<Period, number>
  dailyGoalReachedDays: number
  weeklyGoalReached: boolean
  last7Days: Array<{ dateKey: string; minutes: number }>
  bestPeriod: Period | null
  currentStreak: number
  streakDelta: number
  interruptTotal: number
  startedSessionCount: number
  invalidStartCount: number
  effectiveStartCount: number
  effectiveStartRate: number | null
  ratingCounts: {
    high: number
    medium: number
    low: number
    unrated: number
  }
  ratedSessionCount: number
}
