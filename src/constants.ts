import type { Period, UserSettings } from './types'

export const PERIODS: Period[] = ['morning', 'afternoon', 'evening']

export const PERIOD_LABEL: Record<Period, string> = {
  morning: '上午',
  afternoon: '下午',
  evening: '晚上',
}

export const DEFAULT_SETTINGS: UserSettings = {
  timezone: 'Asia/Shanghai',
  periodRanges: [
    { period: 'morning', start: '06:00', end: '12:00' },
    { period: 'afternoon', start: '12:00', end: '18:00' },
    { period: 'evening', start: '18:00', end: '24:00' },
  ],
  reminderTimes: {
    morning: '09:00',
    afternoon: '14:00',
    evening: '20:00',
  },
  dailyGoalMinutes: 240,
  weeklyGoalMinutes: 1320,
  streakMinMinutes: 10,
  endReminderEnabled: true,
  endReminderTimes: {
    morning: '11:45',
    afternoon: '17:45',
  },
  mobilePush: {
    enabled: false,
    channel: 'bark',
    barkServer: 'https://api.day.app',
    barkDeviceKey: '',
    barkGroup: 'research-clockin',
  },
}

export const APP_TITLE = '科研打卡站'
