import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { addMilliseconds } from 'date-fns'

import { DEFAULT_SETTINGS, STARTUP_CHECK_DELAY_MS } from '../constants'
import type {
  EfficiencyRating,
  EndReminderPeriod,
  ReminderState,
  ResearchSession,
  StartupCheckStatus,
  StartupInvalidReason,
  UserSettings,
} from '../types'

interface ClockInDB extends DBSchema {
  sessions: {
    key: string
    value: ResearchSession
    indexes: { byStartAt: string; byEndAt: string }
  }
  meta: {
    key: string
    value: {
      key: string
      value: unknown
    }
  }
}

const DB_NAME = 'research-clockin'
const DB_VERSION = 1
const SETTINGS_KEY = 'settings'

let dbPromise: Promise<IDBPDatabase<ClockInDB>> | null = null
const END_REMINDER_PERIODS: EndReminderPeriod[] = ['morning', 'afternoon']

function normalizeEfficiencyRating(value: unknown): EfficiencyRating | null {
  if (value === 'high' || value === 'medium' || value === 'low') {
    return value
  }
  return null
}

function normalizeStartupCheckStatus(value: unknown): StartupCheckStatus {
  if (value === 'pending' || value === 'confirmed' || value === 'invalid') {
    return value
  }
  return 'confirmed'
}

function normalizeStartupInvalidReason(value: unknown): StartupInvalidReason | null {
  if (value === 'timeout' || value === 'self_reported') {
    return value
  }
  return null
}

function normalizeSession(
  session: ResearchSession | (Omit<ResearchSession, 'efficiencyRating'> & { efficiencyRating?: unknown }),
): ResearchSession {
  const normalizedStatus = normalizeStartupCheckStatus((session as Partial<ResearchSession>).startupCheckStatus)
  const startupCheckDueAtRaw = (session as Partial<ResearchSession>).startupCheckDueAt
  const startupCheckPromptedAtRaw = (session as Partial<ResearchSession>).startupCheckPromptedAt
  const startupInvalidReasonRaw = (session as Partial<ResearchSession>).startupInvalidReason

  const startupCheckDueAt = typeof startupCheckDueAtRaw === 'string'
    ? startupCheckDueAtRaw
    : addMilliseconds(new Date(session.startAt), STARTUP_CHECK_DELAY_MS).toISOString()

  const startupCheckPromptedAt = typeof startupCheckPromptedAtRaw === 'string' ? startupCheckPromptedAtRaw : null

  return {
    ...session,
    efficiencyRating: normalizeEfficiencyRating(session.efficiencyRating),
    startupCheckStatus: normalizedStatus,
    startupCheckDueAt,
    startupCheckPromptedAt,
    startupInvalidReason: normalizedStatus === 'invalid' ? normalizeStartupInvalidReason(startupInvalidReasonRaw) : null,
  }
}

function mergeSettings(settings?: Partial<UserSettings>): UserSettings {
  const endReminderTimes = (settings as Partial<UserSettings> | undefined)?.endReminderTimes
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    periodRanges: settings?.periodRanges ?? DEFAULT_SETTINGS.periodRanges,
    reminderTimes: {
      ...DEFAULT_SETTINGS.reminderTimes,
      ...(settings?.reminderTimes ?? {}),
    },
    endReminderEnabled: settings?.endReminderEnabled ?? DEFAULT_SETTINGS.endReminderEnabled,
    endReminderTimes: {
      ...DEFAULT_SETTINGS.endReminderTimes,
      ...(endReminderTimes ?? {}),
    },
    mobilePush: {
      ...DEFAULT_SETTINGS.mobilePush,
      ...(settings?.mobilePush ?? {}),
    },
  }
}

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<ClockInDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const sessionStore = db.createObjectStore('sessions', { keyPath: 'id' })
        sessionStore.createIndex('byStartAt', 'startAt')
        sessionStore.createIndex('byEndAt', 'endAt')
        db.createObjectStore('meta', { keyPath: 'key' })
      },
    })
  }
  return dbPromise
}

export async function listSessions(): Promise<ResearchSession[]> {
  const db = await getDB()
  const all = (await db.getAll('sessions')).map((session) => normalizeSession(session))
  all.sort((a, b) => b.startAt.localeCompare(a.startAt))
  return all
}

export async function getSessionById(id: string): Promise<ResearchSession | undefined> {
  const db = await getDB()
  const session = await db.get('sessions', id)
  return session ? normalizeSession(session) : undefined
}

export async function getActiveSession(): Promise<ResearchSession | null> {
  const sessions = await listSessions()
  return sessions.find((session) => session.endAt === null) ?? null
}

export async function putSession(session: ResearchSession): Promise<void> {
  const db = await getDB()
  await db.put('sessions', normalizeSession(session))
}

export async function deleteSessionById(id: string): Promise<void> {
  const db = await getDB()
  await db.delete('sessions', id)
}

export async function getSettings(): Promise<UserSettings> {
  const db = await getDB()
  const record = await db.get('meta', SETTINGS_KEY)
  if (!record) {
    await saveSettings(DEFAULT_SETTINGS)
    return DEFAULT_SETTINGS
  }

  return mergeSettings(record.value as Partial<UserSettings>)
}

export async function saveSettings(settings: UserSettings): Promise<void> {
  const db = await getDB()
  const merged = mergeSettings(settings)
  await db.put('meta', {
    key: SETTINGS_KEY,
    value: merged,
  })
}

function reminderKey(dateKey: string) {
  return `reminder:${dateKey}`
}

export async function getReminderState(dateKey: string): Promise<ReminderState> {
  const db = await getDB()
  const record = await db.get('meta', reminderKey(dateKey))
  if (!record) {
    return {
      dateKey,
      remindedPeriods: [],
      endReminderDonePeriods: [],
      endReminderSnoozeUntil: {},
    }
  }

  const value = record.value as ReminderState
  const donePeriods = (value.endReminderDonePeriods ?? []).filter((period): period is EndReminderPeriod =>
    END_REMINDER_PERIODS.includes(period as EndReminderPeriod),
  )
  const snooze: Partial<Record<EndReminderPeriod, string>> = {}
  for (const period of END_REMINDER_PERIODS) {
    const raw = value.endReminderSnoozeUntil?.[period]
    if (raw) {
      snooze[period] = raw
    }
  }

  return {
    dateKey,
    remindedPeriods: value.remindedPeriods ?? [],
    endReminderDonePeriods: donePeriods,
    endReminderSnoozeUntil: snooze,
  }
}

export async function saveReminderState(state: ReminderState): Promise<void> {
  const db = await getDB()
  await db.put('meta', {
    key: reminderKey(state.dateKey),
    value: state,
  })
}

export async function clearDatabaseForTests(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise
    db.close()
  }
  dbPromise = null
  await deleteDB(DB_NAME)
}
