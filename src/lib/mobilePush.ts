import type { UserSettings } from '../types'

export interface BarkPushInput {
  server: string
  deviceKey: string
  title: string
  body: string
  group?: string
}

function normalizeServer(server: string): string {
  return server.trim().replace(/\/+$/, '')
}

export function buildBarkPushUrl(input: BarkPushInput): string {
  const server = normalizeServer(input.server)
  const deviceKey = encodeURIComponent(input.deviceKey.trim())
  const title = encodeURIComponent(input.title)
  const body = encodeURIComponent(input.body)

  const path = `${server}/${deviceKey}/${title}/${body}`
  const query = input.group?.trim()
    ? `?group=${encodeURIComponent(input.group.trim())}`
    : ''

  return `${path}${query}`
}

export function validateBarkConfig(settings: UserSettings): { ok: boolean; message?: string } {
  if (!settings.mobilePush.enabled) {
    return { ok: true }
  }

  if (settings.mobilePush.channel !== 'bark') {
    return { ok: false, message: '当前仅支持 Bark 推送通道。' }
  }

  if (!settings.mobilePush.barkServer.trim()) {
    return { ok: false, message: '请填写 Bark 服务器地址。' }
  }

  if (!settings.mobilePush.barkDeviceKey.trim()) {
    return { ok: false, message: '启用手机提醒时，Bark Device Key 不能为空。' }
  }

  return { ok: true }
}

export async function sendBarkPush(input: BarkPushInput): Promise<void> {
  const url = buildBarkPushUrl(input)
  const response = await fetch(url, {
    method: 'GET',
    mode: 'no-cors',
    cache: 'no-store',
  })

  if (response.type !== 'opaque' && !response.ok) {
    throw new Error('Bark 推送请求失败。')
  }
}

export async function sendTestPush(settings: UserSettings): Promise<void> {
  if (!settings.mobilePush.barkServer.trim()) {
    throw new Error('请填写 Bark 服务器地址。')
  }

  if (!settings.mobilePush.barkDeviceKey.trim()) {
    throw new Error('测试推送前请先填写 Bark Device Key。')
  }

  if (settings.mobilePush.enabled) {
    const validation = validateBarkConfig(settings)
    if (!validation.ok) {
      throw new Error(validation.message ?? 'Bark 配置无效。')
    }
  }

  await sendBarkPush({
    server: settings.mobilePush.barkServer,
    deviceKey: settings.mobilePush.barkDeviceKey,
    group: settings.mobilePush.barkGroup,
    title: '科研打卡测试提醒',
    body: `测试消息：手机提醒配置已生效 (${new Date().toLocaleString('zh-CN', { hour12: false })})`,
  })
}
