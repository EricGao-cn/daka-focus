import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_SETTINGS } from '../constants'
import { buildBarkPushUrl, sendBarkPush, sendTestPush, validateBarkConfig } from './mobilePush'

describe('mobilePush', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('builds bark url with encoded Chinese text and trimmed server', () => {
    const url = buildBarkPushUrl({
      server: 'https://api.day.app/',
      deviceKey: 'abc123',
      title: '上午科研提醒',
      body: '现在开始做实验',
      group: 'research clock-in',
    })

    expect(url).toContain('https://api.day.app/abc123')
    expect(url).toContain(encodeURIComponent('上午科研提醒'))
    expect(url).toContain(encodeURIComponent('现在开始做实验'))
    expect(url).toContain(`group=${encodeURIComponent('research clock-in')}`)
  })

  it('validates bark config when enabled', () => {
    const invalid = validateBarkConfig({
      ...DEFAULT_SETTINGS,
      mobilePush: {
        ...DEFAULT_SETTINGS.mobilePush,
        enabled: true,
        barkDeviceKey: '',
      },
    })
    expect(invalid.ok).toBe(false)

    const valid = validateBarkConfig({
      ...DEFAULT_SETTINGS,
      mobilePush: {
        ...DEFAULT_SETTINGS.mobilePush,
        enabled: true,
        barkDeviceKey: 'key123',
      },
    })
    expect(valid.ok).toBe(true)
  })

  it('sends bark push with no-cors mode', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await sendBarkPush({
      server: 'https://api.day.app',
      deviceKey: 'dev-key',
      title: '测试',
      body: '内容',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/dev-key/'),
      expect.objectContaining({
        method: 'GET',
        mode: 'no-cors',
      }),
    )
  })

  it('rejects test push when device key is missing', async () => {
    await expect(sendTestPush(DEFAULT_SETTINGS)).rejects.toThrow('Bark Device Key')
  })
})
