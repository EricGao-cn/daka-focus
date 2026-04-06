import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { clearDatabaseForTests, putSession } from './lib/db'
import * as shareLib from './lib/share'
import { getSessionSnapshot } from './lib/sessionService'

const EXPECTED_SHARE_URL = 'https://daka-tan.vercel.app'

describe('App integration', () => {
  beforeEach(async () => {
    await clearDatabaseForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('completes start -> end flow and updates summary', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByText('科研启动区')

    await user.type(screen.getByPlaceholderText('例如：先复现实验 A 的结果'), '实验推进')
    await user.click(screen.getByRole('button', { name: '开始科研' }))
    await screen.findByText('当前会话进行中')

    await user.click(screen.getByRole('button', { name: '结束科研' }))
    await screen.findByText('结束科研并写一句复盘')
    await user.type(screen.getByPlaceholderText('例如：今天完成了方法复现，明天开始调参。'), '完成复现')
    await user.click(screen.getByRole('radio', { name: '高' }))
    await user.click(screen.getByRole('button', { name: '确认结束' }))

    await screen.findByText('会话已结束，复盘已保存。')
    await user.click(screen.getByRole('tab', { name: '记录' }))
    expect(screen.getByText(/实验推进/)).toBeInTheDocument()
    expect(screen.getByText(/完成复现/)).toBeInTheDocument()
    expect(screen.getByText('效率：高效')).toBeInTheDocument()
  })

  it('allows ending session without selecting efficiency rating', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByText('科研启动区')
    await user.type(screen.getByPlaceholderText('例如：先复现实验 A 的结果'), '写作整理')
    await user.click(screen.getByRole('button', { name: '开始科研' }))
    await screen.findByText('当前会话进行中')

    await user.click(screen.getByRole('button', { name: '结束科研' }))
    await screen.findByText('结束科研并写一句复盘')
    await user.click(screen.getByRole('button', { name: '确认结束' }))
    await screen.findByText('会话已结束，复盘已保存。')

    await user.click(screen.getByRole('tab', { name: '记录' }))
    expect(screen.getByText('效率：未评')).toBeInTheDocument()
  })

  it('shows startup second-check modal and continues when confirmed', async () => {
    const user = userEvent.setup()
    const firstRender = render(<App />)

    await screen.findByText('科研启动区')
    await user.click(screen.getByRole('button', { name: '开始科研' }))
    await screen.findByText('当前会话进行中')

    const snapshot = await getSessionSnapshot()
    const active = snapshot.activeSession
    expect(active).not.toBeNull()
    await putSession({
      ...active!,
      startupCheckStatus: 'pending',
      startupCheckDueAt: new Date(Date.now() - 10_000).toISOString(),
      startupCheckPromptedAt: new Date().toISOString(),
      startupInvalidReason: null,
    })

    firstRender.unmount()
    render(<App />)

    await screen.findByText('开始后 5 分钟二次确认')
    await user.click(screen.getByRole('button', { name: '我在科研（继续）' }))
    await screen.findByText('已确认继续科研。')
    expect(screen.getByText('当前会话进行中')).toBeInTheDocument()
  })

  it('marks startup as invalid when second-check times out', async () => {
    const user = userEvent.setup()
    const firstRender = render(<App />)

    await screen.findByText('科研启动区')
    await user.click(screen.getByRole('button', { name: '开始科研' }))
    await screen.findByText('当前会话进行中')

    const snapshot = await getSessionSnapshot()
    const active = snapshot.activeSession
    expect(active).not.toBeNull()
    await putSession({
      ...active!,
      startupCheckStatus: 'pending',
      startupCheckDueAt: new Date(Date.now() - 120_000).toISOString(),
      startupCheckPromptedAt: new Date(Date.now() - 70_000).toISOString(),
      startupInvalidReason: null,
    })

    firstRender.unmount()
    render(<App />)

    await screen.findByText('二次确认超时：本次已记为无效启动。')
    expect(screen.queryByText('当前会话进行中')).not.toBeInTheDocument()
    expect(screen.getByText(/今日已有 1 次无效启动/)).toBeInTheDocument()
    const qualityCard = screen.getByRole('heading', { name: '启动质量统计' }).closest('article')
    expect(qualityCard).not.toBeNull()
    expect(within(qualityCard as HTMLElement).getByText('今日无效启动')).toBeInTheDocument()
    expect(within(qualityCard as HTMLElement).getAllByText('1 次')).toHaveLength(2)
  })

  it('marks startup as invalid when user self-reports distraction', async () => {
    const user = userEvent.setup()
    const firstRender = render(<App />)

    await screen.findByText('科研启动区')
    await user.click(screen.getByRole('button', { name: '开始科研' }))
    await screen.findByText('当前会话进行中')

    const snapshot = await getSessionSnapshot()
    const active = snapshot.activeSession
    expect(active).not.toBeNull()
    await putSession({
      ...active!,
      startupCheckStatus: 'pending',
      startupCheckDueAt: new Date(Date.now() - 10_000).toISOString(),
      startupCheckPromptedAt: new Date().toISOString(),
      startupInvalidReason: null,
    })

    firstRender.unmount()
    render(<App />)

    await screen.findByText('开始后 5 分钟二次确认')
    await user.click(screen.getByRole('button', { name: '我分心了（结束并记无效）' }))

    await screen.findByText('已记录无效启动，会话已结束。')
    expect(screen.queryByText('当前会话进行中')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '记录' }))
    expect(screen.getByText('无效启动')).toBeInTheDocument()
  })

  it('hides low-frequency blocks by default and reveals them by tab switch', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByText('科研启动区')

    expect(screen.queryByText('最近 7 天趋势')).not.toBeInTheDocument()
    expect(screen.queryByText('本周科研周报卡片')).not.toBeInTheDocument()
    expect(screen.queryByText('最近会话')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '趋势' }))
    expect(await screen.findByText('最近 7 天趋势')).toBeInTheDocument()
    expect(screen.getByText('本周科研周报卡片')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '记录' }))
    expect(await screen.findByText('最近会话')).toBeInTheDocument()
  })

  it('shows efficiency mini-card expanded by default when rated sessions exist', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByText('科研启动区')
    await user.type(screen.getByPlaceholderText('例如：先复现实验 A 的结果'), '效率测试')
    await user.click(screen.getByRole('button', { name: '开始科研' }))
    await screen.findByText('当前会话进行中')
    await user.click(screen.getByRole('button', { name: '结束科研' }))
    await screen.findByText('结束科研并写一句复盘')
    await user.click(screen.getByRole('radio', { name: '高' }))
    await user.click(screen.getByRole('button', { name: '确认结束' }))
    await screen.findByText('会话已结束，复盘已保存。')

    await user.click(screen.getByRole('tab', { name: '趋势' }))
    expect(await screen.findByRole('heading', { name: '本周效率' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '收起效率图' })).toBeInTheDocument()
    expect(screen.getByText('高效占比')).toBeInTheDocument()
    expect(screen.getByText('高效 1')).toBeInTheDocument()
  })

  it('keeps efficiency card collapsed by default when no rated sessions and shows empty hint after expand', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByText('科研启动区')
    await user.click(screen.getByRole('tab', { name: '趋势' }))

    expect(await screen.findByRole('heading', { name: '本周效率' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '展开效率图' })).toBeInTheDocument()
    expect(screen.queryByText('本周还没有评分数据，结束会话时可选择效率评分。')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '展开效率图' }))
    expect(await screen.findByText('本周还没有评分数据，结束会话时可选择效率评分。')).toBeInTheDocument()
  })

  it('renders efficiency legend counts from weekly rating summary', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByText('科研启动区')

    await user.type(screen.getByPlaceholderText('例如：先复现实验 A 的结果'), '高效会话')
    await user.click(screen.getByRole('button', { name: '开始科研' }))
    await screen.findByText('当前会话进行中')
    await user.click(screen.getByRole('button', { name: '结束科研' }))
    await screen.findByText('结束科研并写一句复盘')
    await user.click(screen.getByRole('radio', { name: '高' }))
    await user.click(screen.getByRole('button', { name: '确认结束' }))
    await screen.findByText('会话已结束，复盘已保存。')

    await user.type(screen.getByPlaceholderText('例如：先复现实验 A 的结果'), '未评会话')
    await user.click(screen.getByRole('button', { name: '开始科研' }))
    await screen.findByText('当前会话进行中')
    await user.click(screen.getByRole('button', { name: '结束科研' }))
    await screen.findByText('结束科研并写一句复盘')
    await user.click(screen.getByRole('button', { name: '确认结束' }))
    await screen.findByText('会话已结束，复盘已保存。')

    await user.click(screen.getByRole('tab', { name: '趋势' }))
    expect(screen.getByRole('button', { name: '收起效率图' })).toBeInTheDocument()
    expect(screen.getByText('高效 1')).toBeInTheDocument()
    expect(screen.getByText('中等 0')).toBeInTheDocument()
    expect(screen.getByText('低效 0')).toBeInTheDocument()
    expect(screen.getByText('未评 1')).toBeInTheDocument()
  })

  it('deletes a finished session after confirmation', async () => {
    const confirmMock = vi.fn().mockReturnValue(true)
    vi.stubGlobal('confirm', confirmMock)

    const user = userEvent.setup()
    render(<App />)

    await screen.findByText('科研启动区')
    await user.type(screen.getByPlaceholderText('例如：先复现实验 A 的结果'), '待删除会话')
    await user.click(screen.getByRole('button', { name: '开始科研' }))
    await screen.findByText('当前会话进行中')
    await user.click(screen.getByRole('button', { name: '结束科研' }))
    await screen.findByText('结束科研并写一句复盘')
    await user.click(screen.getByRole('button', { name: '确认结束' }))
    await screen.findByText('会话已结束，复盘已保存。')

    await user.click(screen.getByRole('tab', { name: '记录' }))
    expect(screen.getByText(/待删除会话/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '移除' }))

    expect(confirmMock).toHaveBeenCalledTimes(1)
    await screen.findByText('已删除会话。')
    expect(screen.queryByText(/待删除会话/)).not.toBeInTheDocument()
  })

  it('keeps a finished session when deletion is cancelled', async () => {
    const confirmMock = vi.fn().mockReturnValue(false)
    vi.stubGlobal('confirm', confirmMock)

    const user = userEvent.setup()
    render(<App />)

    await screen.findByText('科研启动区')
    await user.type(screen.getByPlaceholderText('例如：先复现实验 A 的结果'), '保留会话')
    await user.click(screen.getByRole('button', { name: '开始科研' }))
    await screen.findByText('当前会话进行中')
    await user.click(screen.getByRole('button', { name: '结束科研' }))
    await screen.findByText('结束科研并写一句复盘')
    await user.click(screen.getByRole('button', { name: '确认结束' }))

    await user.click(screen.getByRole('tab', { name: '记录' }))
    await user.click(screen.getByRole('button', { name: '移除' }))

    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/保留会话/)).toBeInTheDocument()
  })

  it('does not show delete button for active session', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByText('科研启动区')
    await user.click(screen.getByRole('button', { name: '开始科研' }))
    await screen.findByText('当前会话进行中')

    await user.click(screen.getByRole('tab', { name: '记录' }))
    expect(screen.queryByRole('button', { name: '移除' })).not.toBeInTheDocument()
  })

  it('shows current-session card after start, updates interrupt count, and hides after end', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByText('科研启动区')
    expect(screen.queryByText('开始时间')).not.toBeInTheDocument()
    expect(screen.queryByText('已持续')).not.toBeInTheDocument()
    expect(screen.queryByText('所属时段')).not.toBeInTheDocument()
    expect(screen.queryByText('中断次数')).not.toBeInTheDocument()

    await user.type(screen.getByPlaceholderText('例如：先复现实验 A 的结果'), '实验推进')
    await user.click(screen.getByRole('button', { name: '开始科研' }))

    await screen.findByText('当前会话进行中')
    expect(screen.getByText('开始时间')).toBeInTheDocument()
    expect(screen.getByText('已持续')).toBeInTheDocument()
    expect(screen.getByText('所属时段')).toBeInTheDocument()
    expect(screen.getByText('本次目标')).toBeInTheDocument()
    expect(screen.getByText('中断次数')).toBeInTheDocument()
    expect(screen.getByText('实验推进')).toBeInTheDocument()
    const currentSessionCard = screen.getByText('当前会话进行中').closest('article')
    expect(currentSessionCard).not.toBeNull()
    expect(within(currentSessionCard as HTMLElement).getByText('0 次')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '记录一次刷手机中断' }))
    await waitFor(() => {
      expect(within(currentSessionCard as HTMLElement).getByText('1 次')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: '结束科研' }))
    await screen.findByText('结束科研并写一句复盘')
    await user.click(screen.getByRole('button', { name: '确认结束' }))
    await screen.findByText('会话已结束，复盘已保存。')

    expect(screen.queryByText('当前会话进行中')).not.toBeInTheDocument()
    expect(screen.queryByText('开始时间')).not.toBeInTheDocument()
  })

  it('restores active session after remount', async () => {
    const user = userEvent.setup()
    const firstRender = render(<App />)
    await screen.findByText('科研启动区')

    await user.click(screen.getByRole('button', { name: '开始科研' }))
    await screen.findByText(/会话已开始/)

    firstRender.unmount()
    render(<App />)

    await screen.findByText('科研启动区')
    expect(screen.getByText('当前会话进行中')).toBeInTheDocument()
    expect(screen.getByText('已持续')).toBeInTheDocument()
  })

  it('sends bark test push after config', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    render(<App />)

    await screen.findByText('科研启动区')
    await user.click(screen.getByRole('button', { name: '设置' }))
    await screen.findByRole('heading', { name: '设置' })
    await user.click(screen.getByRole('checkbox', { name: '启用手机提醒' }))
    await user.type(screen.getByPlaceholderText('填入 Bark Device Key'), 'my-device-key')
    await user.click(screen.getByRole('button', { name: '发送测试到手机' }))

    await screen.findByText('测试消息已发送到手机。')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shows share and install panel in settings', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByText('科研启动区')
    await user.click(screen.getByRole('button', { name: '设置' }))
    await screen.findByRole('heading', { name: '分享链接' })
    expect(screen.getByRole('button', { name: '复制分享链接' })).toBeInTheDocument()
  })

  it('copies share link to clipboard', async () => {
    const copySpy = vi.spyOn(shareLib, 'copyToClipboard').mockResolvedValue(undefined)

    const user = userEvent.setup()
    render(<App />)

    await screen.findByText('科研启动区')
    await user.click(screen.getByRole('button', { name: '设置' }))
    await screen.findByRole('heading', { name: '分享链接' })
    await waitFor(() => {
      expect(screen.getByLabelText('分享链接')).toHaveValue(EXPECTED_SHARE_URL)
    })
    await user.click(screen.getByRole('button', { name: '复制分享链接' }))

    expect(copySpy).toHaveBeenCalledWith(EXPECTED_SHARE_URL)
    await screen.findByText('分享链接已复制，可直接发给同学。')
  })
})
