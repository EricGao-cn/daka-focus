import { PERIODS } from '../constants'
import { hasStartedSessionInPeriod } from './analytics'

import type { EndReminderPeriod, Period, ReminderState, ResearchSession, UserSettings } from '../types'

const END_REMINDER_PERIODS: EndReminderPeriod[] = ['morning', 'afternoon']

function currentHHmm(date: Date): string {
  const hh = `${date.getHours()}`.padStart(2, '0')
  const mm = `${date.getMinutes()}`.padStart(2, '0')
  return `${hh}:${mm}`
}

export function dueReminderPeriod(date: Date, settings: UserSettings): Period | null {
  const now = currentHHmm(date)
  for (const period of PERIODS) {
    if (settings.reminderTimes[period] === now) {
      return period
    }
  }
  return null
}

export function shouldNotifyReminder(
  date: Date,
  settings: UserSettings,
  reminderState: ReminderState,
  sessions: ResearchSession[],
): Period | null {
  const period = dueReminderPeriod(date, settings)
  if (!period) {
    return null
  }
  if (reminderState.remindedPeriods.includes(period)) {
    return null
  }
  if (hasStartedSessionInPeriod(date, period, sessions)) {
    return null
  }
  return period
}

export function markReminderSent(state: ReminderState, period: Period): ReminderState {
  if (state.remindedPeriods.includes(period)) {
    return state
  }
  return {
    ...state,
    remindedPeriods: [...state.remindedPeriods, period],
  }
}

export function shouldTriggerEndReminder(
  date: Date,
  settings: UserSettings,
  reminderState: ReminderState,
  activeSession: ResearchSession | null,
): EndReminderPeriod | null {
  if (!settings.endReminderEnabled || !activeSession) {
    return null
  }

  if (!END_REMINDER_PERIODS.includes(activeSession.period as EndReminderPeriod)) {
    return null
  }

  const period = activeSession.period as EndReminderPeriod
  if (reminderState.endReminderDonePeriods.includes(period)) {
    return null
  }

  const snoozeUntil = reminderState.endReminderSnoozeUntil[period]
  if (snoozeUntil) {
    return date >= new Date(snoozeUntil) ? period : null
  }

  const configured = settings.endReminderTimes[period]
  const [hourText, minuteText] = configured.split(':')
  const hours = Number(hourText)
  const minutes = Number(minuteText)
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null
  }

  const dueAt = new Date(date)
  dueAt.setHours(hours, minutes, 0, 0)

  return date >= dueAt ? period : null
}

export function markEndReminderDone(state: ReminderState, period: EndReminderPeriod): ReminderState {
  const nextSnooze = { ...state.endReminderSnoozeUntil }
  delete nextSnooze[period]

  return {
    ...state,
    endReminderDonePeriods: state.endReminderDonePeriods.includes(period)
      ? state.endReminderDonePeriods
      : [...state.endReminderDonePeriods, period],
    endReminderSnoozeUntil: nextSnooze,
  }
}

export function markEndReminderSnoozed(
  state: ReminderState,
  period: EndReminderPeriod,
  snoozeUntil: Date,
): ReminderState {
  return {
    ...state,
    endReminderSnoozeUntil: {
      ...state.endReminderSnoozeUntil,
      [period]: snoozeUntil.toISOString(),
    },
  }
}
