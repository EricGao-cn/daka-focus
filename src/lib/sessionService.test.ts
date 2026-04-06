import { beforeEach, describe, expect, it } from 'vitest'

import { clearDatabaseForTests } from './db'
import {
  confirmStartupCheck,
  endResearchSession,
  getSessionSnapshot,
  invalidateStartupSession,
  promptStartupCheck,
  startResearchSession,
} from './sessionService'

describe('sessionService', () => {
  beforeEach(async () => {
    await clearDatabaseForTests()
  })

  it('persists selected efficiency rating when ending a session', async () => {
    await startResearchSession('推进实验')
    const ended = await endResearchSession('完成关键步骤', 'high')

    expect(ended.efficiencyRating).toBe('high')

    const snapshot = await getSessionSnapshot()
    expect(snapshot.activeSession).toBeNull()
    expect(snapshot.sessions[0].efficiencyRating).toBe('high')
  })

  it('keeps efficiency rating as null when ending without a rating', async () => {
    await startResearchSession('阅读论文')
    const ended = await endResearchSession('完成阅读')

    expect(ended.efficiencyRating).toBeNull()

    const snapshot = await getSessionSnapshot()
    expect(snapshot.sessions[0].efficiencyRating).toBeNull()
  })

  it('supports startup confirmation flow', async () => {
    const started = await startResearchSession('准备开始')
    const prompted = await promptStartupCheck(started.id)
    const confirmed = await confirmStartupCheck(started.id)

    expect(prompted.startupCheckPromptedAt).not.toBeNull()
    expect(confirmed.startupCheckStatus).toBe('confirmed')
  })

  it('invalidates startup session and closes it', async () => {
    const started = await startResearchSession('开始但分心')
    const invalid = await invalidateStartupSession(started.id, 'self_reported')

    expect(invalid.startupCheckStatus).toBe('invalid')
    expect(invalid.endAt).not.toBeNull()

    const snapshot = await getSessionSnapshot()
    expect(snapshot.activeSession).toBeNull()
  })
})
