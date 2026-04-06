import { describe, expect, it, beforeEach } from 'vitest'
import { openDB, type DBSchema } from 'idb'

import { clearDatabaseForTests, getSessionById, listSessions } from './db'

interface LegacyClockInDB extends DBSchema {
  sessions: {
    key: string
    value: {
      id: string
      startAt: string
      endAt: string | null
      period: 'morning' | 'afternoon' | 'evening'
      goalNote: string
      reviewNote: string
      interruptCount: number
      createdAt: string
      updatedAt: string
    }
    indexes: { byStartAt: string; byEndAt: string }
  }
  meta: {
    key: string
    value: { key: string; value: unknown }
  }
}

const DB_NAME = 'research-clockin'
const DB_VERSION = 1

describe('db compatibility', () => {
  beforeEach(async () => {
    await clearDatabaseForTests()
  })

  it('fills missing efficiencyRating as null for legacy session records', async () => {
    const db = await openDB<LegacyClockInDB>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        const sessionStore = database.createObjectStore('sessions', { keyPath: 'id' })
        sessionStore.createIndex('byStartAt', 'startAt')
        sessionStore.createIndex('byEndAt', 'endAt')
        database.createObjectStore('meta', { keyPath: 'key' })
      },
    })

    const startedAt = new Date('2026-04-01T09:00:00+08:00')
    const endedAt = new Date('2026-04-01T10:00:00+08:00')

    await db.put('sessions', {
      id: 'legacy-1',
      startAt: startedAt.toISOString(),
      endAt: endedAt.toISOString(),
      period: 'morning',
      goalNote: 'legacy goal',
      reviewNote: 'legacy review',
      interruptCount: 0,
      createdAt: startedAt.toISOString(),
      updatedAt: endedAt.toISOString(),
    })
    db.close()

    const sessions = await listSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].efficiencyRating).toBeNull()
    expect(sessions[0].startupCheckStatus).toBe('confirmed')

    const byId = await getSessionById('legacy-1')
    expect(byId?.efficiencyRating).toBeNull()
    expect(byId?.startupCheckStatus).toBe('confirmed')
  })
})
