import { beforeEach, describe, expect, it } from 'vitest'

import { clearDatabaseForTests } from './db'
import {
  endResearchSession,
  getSessionSnapshot,
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

  it('marks startup invalid when ending session with invalid toggle', async () => {
    await startResearchSession('阅读论文')
    const ended = await endResearchSession('本次状态不佳', 'low', true)

    expect(ended.startupCheckStatus).toBe('invalid')
    expect(ended.startupInvalidReason).toBe('self_reported')
  })
})
