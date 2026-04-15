import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'

import './App.css'
import {
  APP_TITLE,
  DEFAULT_SETTINGS,
  PERIOD_LABEL,
  PERIODS,
} from './constants'
import { buildDailySummary, buildWeeklySummary, getWeeklyReportSentence, sessionMinutes } from './lib/analytics'
import { getReminderState, getSettings, putSession, saveReminderState, saveSettings } from './lib/db'
import { sendBarkPush, sendTestPush, validateBarkConfig } from './lib/mobilePush'
import { markReminderSent, shouldNotifyReminder } from './lib/reminder'
import {
  endResearchSession,
  getSessionSnapshot,
  incrementInterrupt,
  removeFinishedSession,
  startResearchSession,
} from './lib/sessionService'
import { buildShareUrl, copyToClipboard } from './lib/share'
import { formatClock, formatDateKey, formatMinutes, resolvePeriod } from './lib/time'

import type { EfficiencyRating, Period, ReminderState, ResearchSession, UserSettings } from './types'

function App() {
  type Screen = 'dashboard' | 'settings'
  type DashboardTab = 'overview' | 'trend' | 'records'

  const [loading, setLoading] = useState(true)
  const [sessions, setSessions] = useState<ResearchSession[]>([])
  const [activeSession, setActiveSession] = useState<ResearchSession | null>(null)
  const [settings, setSettingsState] = useState<UserSettings>(DEFAULT_SETTINGS)
  const [goalDraft, setGoalDraft] = useState('')
  const [reviewDraft, setReviewDraft] = useState('')
  const [reviewEfficiencyRating, setReviewEfficiencyRating] = useState<EfficiencyRating | null>(null)
  const [reviewMarkInvalidStartup, setReviewMarkInvalidStartup] = useState(false)
  const [showReviewModal, setShowReviewModal] = useState(false)
  const [flashMessage, setFlashMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [now, setNow] = useState(new Date())
  const [reminderState, setReminderState] = useState<ReminderState>({
    dateKey: formatDateKey(new Date()),
    remindedPeriods: [],
    endReminderDonePeriods: [],
    endReminderSnoozeUntil: {},
  })
  const [screen, setScreen] = useState<Screen>('dashboard')
  const [dashboardTab, setDashboardTab] = useState<DashboardTab>('overview')
  const [showMobilePushFields, setShowMobilePushFields] = useState(false)
  const [showEfficiencyViz, setShowEfficiencyViz] = useState(false)
  const [efficiencyVizTouched, setEfficiencyVizTouched] = useState(false)
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported',
  )
  const [shareUrl, setShareUrl] = useState('')

  const todaySummary = useMemo(() => buildDailySummary(now, sessions, settings, now), [now, sessions, settings])
  const weeklySummary = useMemo(() => buildWeeklySummary(now, sessions, settings, now), [now, sessions, settings])

  const todayDateKey = formatDateKey(now)
  const currentPeriod = resolvePeriod(now, settings.periodRanges)
  const activeMinutes = activeSession ? sessionMinutes(activeSession, now) : 0

  const dailyProgress = settings.dailyGoalMinutes > 0 ? Math.min(100, (todaySummary.totalMinutes / settings.dailyGoalMinutes) * 100) : 0
  const weeklyProgress = settings.weeklyGoalMinutes > 0 ? Math.min(100, (weeklySummary.totalMinutes / settings.weeklyGoalMinutes) * 100) : 0
  const hasInvalidStarts = todaySummary.invalidStartCount > 0 || weeklySummary.invalidStartCount > 0
  const todayEffectiveRateLabel = todaySummary.effectiveStartRate === null ? '--' : `${todaySummary.effectiveStartRate}%`
  const weeklyEffectiveRateLabel = weeklySummary.effectiveStartRate === null ? '--' : `${weeklySummary.effectiveStartRate}%`
  const formatHours = (minutes: number) => `${(minutes / 60).toFixed(1)} 小时`
  const efficiencyLabel: Record<EfficiencyRating, string> = {
    high: '高效',
    medium: '中等',
    low: '低效',
  }

  async function tryRepairSpecificSession(snapshotSessions: ResearchSession[]): Promise<boolean> {
    const targetStartAt = '2026-04-07T10:47:00+08:00'
    const targetEndAt = '2026-04-07T12:07:00+08:00'
    const targetStartDate = new Date(targetStartAt)
    const targetReview = 'pairwise 推完了，文章润色 TODO'

    const target = snapshotSessions
      .filter((session) => {
        if (!session.endAt) {
          return false
        }
        const containsPairwise = session.goalNote.includes('pairwise') || session.reviewNote.includes('pairwise')
        const isStartupTimeoutInvalid = session.startupCheckStatus === 'invalid' && session.startupInvalidReason === 'timeout'
        return containsPairwise && isStartupTimeoutInvalid
      })
      .sort((a, b) => {
        const deltaA = Math.abs(new Date(a.startAt).getTime() - targetStartDate.getTime())
        const deltaB = Math.abs(new Date(b.startAt).getTime() - targetStartDate.getTime())
        return deltaA - deltaB
      })[0]

    if (!target) {
      return false
    }

    const noChangeNeeded = (
      new Date(target.startAt).getTime() === targetStartDate.getTime()
      && target.endAt === new Date(targetEndAt).toISOString()
      && target.reviewNote === targetReview
      && target.efficiencyRating === 'high'
      && target.startupCheckStatus === 'confirmed'
      && target.startupInvalidReason === null
    )
    if (noChangeNeeded) {
      return false
    }

    await putSession({
      ...target,
      startAt: new Date(targetStartAt).toISOString(),
      endAt: new Date(targetEndAt).toISOString(),
      period: 'morning',
      reviewNote: targetReview,
      efficiencyRating: 'high',
      startupCheckStatus: 'confirmed',
      startupCheckDueAt: new Date(new Date(targetStartAt).getTime() + 5 * 60 * 1000).toISOString(),
      startupCheckPromptedAt: null,
      startupInvalidReason: null,
      updatedAt: new Date().toISOString(),
    })
    return true
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date())
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    async function loadInitialState() {
      try {
        const [loadedSettings, initialSnapshot] = await Promise.all([getSettings(), getSessionSnapshot()])
        const state = await getReminderState(formatDateKey(new Date()))
        const repaired = await tryRepairSpecificSession(initialSnapshot.sessions)
        const snapshot = repaired ? await getSessionSnapshot() : initialSnapshot

        setSettingsState(loadedSettings)
        setSessions(snapshot.sessions)
        setActiveSession(snapshot.activeSession)
        setReminderState(state)
        if (repaired) {
          setFlashMessage('已修复 04-07 10:47 这条会话数据。')
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : '初始化失败。')
      } finally {
        setLoading(false)
      }
    }

    void loadInitialState()
  }, [])

  useEffect(() => {
    async function syncReminderState() {
      const loaded = await getReminderState(todayDateKey)
      setReminderState(loaded)
    }

    void syncReminderState()
  }, [todayDateKey])

  useEffect(() => {
    const ticker = window.setInterval(() => {
      const current = new Date()
      const period = shouldNotifyReminder(current, settings, reminderState, sessions)
      if (!period) {
        return
      }

      const nextState = markReminderSent(reminderState, period)
      setReminderState(nextState)
      void saveReminderState(nextState)

      const title = `${PERIOD_LABEL[period]}科研提醒`
      const body = `现在是 ${settings.reminderTimes[period]}，可以开始这一时段科研。`

      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body })
      } else {
        setFlashMessage(`${title}：${body}`)
      }

      if (settings.mobilePush.enabled) {
        const validation = validateBarkConfig(settings)
        if (!validation.ok) {
          setFlashMessage(validation.message ?? 'Bark 配置无效，已跳过手机提醒。')
          return
        }

        void sendBarkPush({
          server: settings.mobilePush.barkServer,
          deviceKey: settings.mobilePush.barkDeviceKey,
          group: settings.mobilePush.barkGroup,
          title,
          body,
        }).catch(() => {
          setFlashMessage('手机推送失败，请检查 Bark 配置和网络。')
        })
      }
    }, 30000)

    return () => window.clearInterval(ticker)
  }, [settings, reminderState, sessions])

  useEffect(() => {
    if (settings.mobilePush.enabled) {
      setShowMobilePushFields(true)
    }
  }, [settings.mobilePush.enabled])

  useEffect(() => {
    setShareUrl(buildShareUrl())
  }, [])

  useEffect(() => {
    if (loading || efficiencyVizTouched) {
      return
    }
    setShowEfficiencyViz(weeklySummary.ratedSessionCount > 0)
  }, [loading, weeklySummary.ratedSessionCount, efficiencyVizTouched])

  async function refreshSnapshot() {
    const snapshot = await getSessionSnapshot()
    setSessions(snapshot.sessions)
    setActiveSession(snapshot.activeSession)
  }

  async function onStart() {
    setErrorMessage('')
    try {
      await startResearchSession(goalDraft)
      setGoalDraft('')
      await refreshSnapshot()
      setFlashMessage('会话已开始，进入专注状态。')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '开始失败。')
    }
  }

  async function onEndConfirm() {
    setErrorMessage('')
    try {
      await endResearchSession(reviewDraft, reviewEfficiencyRating, reviewMarkInvalidStartup)
      setReviewDraft('')
      setReviewEfficiencyRating(null)
      setReviewMarkInvalidStartup(false)
      setShowReviewModal(false)
      await refreshSnapshot()
      setFlashMessage('会话已结束，复盘已保存。')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '结束失败。')
    }
  }

  async function onInterrupt() {
    if (!activeSession) {
      return
    }
    try {
      await incrementInterrupt(activeSession.id)
      await refreshSnapshot()
      setFlashMessage('已记录一次中断。')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '记录失败。')
    }
  }

  async function onDeleteSession(session: ResearchSession) {
    if (session.endAt === null) {
      setErrorMessage('进行中的会话不能删除，请先结束。')
      return
    }

    const startLabel = format(new Date(session.startAt), 'MM-dd HH:mm')
    const confirmed = window.confirm(`确认删除 ${startLabel} 这条会话吗？`)
    if (!confirmed) {
      return
    }

    try {
      await removeFinishedSession(session.id)
      await refreshSnapshot()
      setErrorMessage('')
      setFlashMessage('已删除会话。')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '删除失败。')
    }
  }

  async function onSaveSettings() {
    try {
      const validation = validateBarkConfig(settings)
      if (!validation.ok) {
        setErrorMessage(validation.message ?? 'Bark 配置无效。')
        return
      }
      await saveSettings(settings)
      setErrorMessage('')
      setFlashMessage('设置已保存。')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '保存设置失败。')
    }
  }

  async function onSendTestPush() {
    try {
      await sendTestPush(settings)
      setErrorMessage('')
      setFlashMessage('测试消息已发送到手机。')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '测试发送失败。')
    }
  }

  async function onCopyShareLink() {
    if (!shareUrl) {
      setErrorMessage('当前无法生成分享链接。')
      return
    }

    try {
      await copyToClipboard(shareUrl)
      setErrorMessage('')
      setFlashMessage('分享链接已复制，可直接发给同学。')
    } catch {
      setErrorMessage('复制失败，请手动复制上方链接。')
    }
  }

  function onOpenReviewModal() {
    setReviewEfficiencyRating(null)
    setReviewMarkInvalidStartup(false)
    setShowReviewModal(true)
  }

  function onCloseReviewModal() {
    setReviewEfficiencyRating(null)
    setReviewMarkInvalidStartup(false)
    setShowReviewModal(false)
  }

  async function onRequestNotificationPermission() {
    if (!('Notification' in window)) {
      setNotificationPermission('unsupported')
      setFlashMessage('当前浏览器不支持系统通知。')
      return
    }

    const result = await Notification.requestPermission()
    setNotificationPermission(result)
    if (result !== 'granted') {
      setFlashMessage('未授予通知权限，将使用页面内温和提醒。')
    } else {
      setFlashMessage('通知权限已开启。')
    }
  }

  function updateReminderTime(period: Period, value: string) {
    setSettingsState((prev) => ({
      ...prev,
      reminderTimes: {
        ...prev.reminderTimes,
        [period]: value,
      },
    }))
  }

  function updatePeriodRange(period: Period, field: 'start' | 'end', value: string) {
    setSettingsState((prev) => ({
      ...prev,
      periodRanges: prev.periodRanges.map((item) => {
        if (item.period !== period) {
          return item
        }
        return {
          ...item,
          [field]: value,
        }
      }),
    }))
  }

  function updateNumberSetting(
    key: 'dailyGoalMinutes' | 'weeklyGoalMinutes' | 'streakMinMinutes',
    value: number,
  ) {
    setSettingsState((prev) => ({
      ...prev,
      [key]: Number.isNaN(value) ? 0 : Math.max(0, value),
    }))
  }

  function updateMobilePushSetting(
    key: 'enabled' | 'barkServer' | 'barkDeviceKey' | 'barkGroup',
    value: boolean | string,
  ) {
    setSettingsState((prev) => ({
      ...prev,
      mobilePush: {
        ...prev.mobilePush,
        [key]: value,
      },
    }))
  }

  if (loading) {
    return <main className="page"><section className="card">正在加载数据...</section></main>
  }

  const trendMax = Math.max(...weeklySummary.last7Days.map((item) => item.minutes), 1)
  const efficiencyTotalCount =
    weeklySummary.ratingCounts.high
    + weeklySummary.ratingCounts.medium
    + weeklySummary.ratingCounts.low
    + weeklySummary.ratingCounts.unrated
  const efficiencyHighRatio = weeklySummary.ratedSessionCount > 0
    ? Math.round((weeklySummary.ratingCounts.high / weeklySummary.ratedSessionCount) * 100)
    : null
  const efficiencySegments: Array<{ key: 'high' | 'medium' | 'low' | 'unrated'; label: string; count: number }> = [
    { key: 'high', label: '高效', count: weeklySummary.ratingCounts.high },
    { key: 'medium', label: '中等', count: weeklySummary.ratingCounts.medium },
    { key: 'low', label: '低效', count: weeklySummary.ratingCounts.low },
    { key: 'unrated', label: '未评', count: weeklySummary.ratingCounts.unrated },
  ]

  return (
    <main className="page">
      {screen === 'dashboard' && (
        <>
          <header className="header header-row">
            <div>
              <h1>{APP_TITLE}</h1>
              <p>{format(now, 'yyyy-MM-dd')} | 当前时间 {formatClock(now)} | 当前时段 {PERIOD_LABEL[currentPeriod]}</p>
            </div>
            <button type="button" className="button-secondary" onClick={() => setScreen('settings')}>
              设置
            </button>
          </header>

          {flashMessage && <p className="flash">{flashMessage}</p>}
          {errorMessage && <p className="error">{errorMessage}</p>}
          {todaySummary.invalidStartCount > 0 && (
            <p className="warning-banner">
              今日已有 {todaySummary.invalidStartCount} 次无效启动。建议下一段开始后尽快进入任务。
            </p>
          )}

          <section className="card hero">
            <div>
              <h2>科研启动区</h2>
              <p>{activeSession ? '当前会话进行中，可结束打卡或记录中断。' : '先写一句目标，再开始本次科研。'}</p>
            </div>

            {!activeSession && (
              <>
                <label className="field">
                  开始前一句目标（可选）
                  <input
                    placeholder="例如：先复现实验 A 的结果"
                    value={goalDraft}
                    onChange={(event) => setGoalDraft(event.target.value)}
                  />
                </label>

                <div className="actions">
                  <button type="button" onClick={onStart}>
                    开始科研
                  </button>
                </div>
              </>
            )}

            {activeSession && (
              <>
                <article className="current-session-card">
                  <div className="current-session-top">
                    <div>
                      <h3>当前会话进行中</h3>
                      <p className="session-timer-label">已持续</p>
                      <p className="session-timer">{formatMinutes(activeMinutes)}</p>
                    </div>

                    <div className="current-session-actions">
                      <button type="button" onClick={onOpenReviewModal}>
                        结束科研
                      </button>
                      <button type="button" onClick={onInterrupt}>
                        记录一次刷手机中断
                      </button>
                    </div>
                  </div>

                  <div className="session-chip-row">
                    <div className="session-chip">
                      <span>开始时间</span>
                      <strong>{format(new Date(activeSession.startAt), 'MM-dd HH:mm')}</strong>
                    </div>
                    <div className="session-chip">
                      <span>所属时段</span>
                      <strong>{PERIOD_LABEL[activeSession.period]}</strong>
                    </div>
                    <div className="session-chip">
                      <span>中断次数</span>
                      <strong>{activeSession.interruptCount} 次</strong>
                    </div>
                  </div>

                  <p className="session-goal-row">
                    <span>本次目标</span>
                    <strong>{activeSession.goalNote || '未填写'}</strong>
                  </p>
                </article>
              </>
            )}
          </section>

          <section className="card">
            <div className="tab-header">
              <div className="tab-title-row">
                <h2>信息面板</h2>
                <span className="panel-badge">连续 {weeklySummary.currentStreak} 天</span>
              </div>
              <div className="tab-list" role="tablist" aria-label="科研信息视图">
                <button
                  type="button"
                  role="tab"
                  aria-selected={dashboardTab === 'overview'}
                  className={dashboardTab === 'overview' ? 'tab-button active' : 'tab-button'}
                  onClick={() => setDashboardTab('overview')}
                >
                  总览
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={dashboardTab === 'trend'}
                  className={dashboardTab === 'trend' ? 'tab-button active' : 'tab-button'}
                  onClick={() => setDashboardTab('trend')}
                >
                  趋势
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={dashboardTab === 'records'}
                  className={dashboardTab === 'records' ? 'tab-button active' : 'tab-button'}
                  onClick={() => setDashboardTab('records')}
                >
                  记录
                </button>
              </div>
            </div>

            {dashboardTab === 'overview' && (
              <div className="overview-grid">
                <article className="surface-block">
                  <h3>目标进度</h3>
                  <p>
                    日目标：{todaySummary.totalMinutes}/{settings.dailyGoalMinutes} 分钟
                    （{formatHours(todaySummary.totalMinutes)}/{formatHours(settings.dailyGoalMinutes)}）
                  </p>
                  <div className="progress"><span style={{ width: `${dailyProgress}%` }} /></div>
                  <p>
                    周目标：{weeklySummary.totalMinutes}/{settings.weeklyGoalMinutes} 分钟
                    （{formatHours(weeklySummary.totalMinutes)}/{formatHours(settings.weeklyGoalMinutes)}）
                  </p>
                  <div className="progress"><span style={{ width: `${weeklyProgress}%` }} /></div>
                  <p>本日有效会话数：{todaySummary.validSessionCount}</p>
                </article>

                <article className="surface-block">
                  <h3>时段分布</h3>
                  {PERIODS.map((period) => (
                    <p key={period}>
                      {PERIOD_LABEL[period]}：{formatMinutes(weeklySummary.periodMinutes[period])}
                    </p>
                  ))}
                  <p>本周中断总数：{weeklySummary.interruptTotal}</p>
                </article>

                <article className={`surface-block invalid-summary-card${hasInvalidStarts ? ' has-invalid' : ''}`}>
                  <div className="invalid-summary-head">
                    <h3>启动质量统计</h3>
                    <span className="invalid-summary-rate">本周有效率 {weeklyEffectiveRateLabel}</span>
                  </div>
                  <div className="invalid-summary-grid">
                    <div className="invalid-summary-item">
                      <span>今日无效启动</span>
                      <strong>{todaySummary.invalidStartCount} 次</strong>
                    </div>
                    <div className="invalid-summary-item">
                      <span>本周无效启动</span>
                      <strong>{weeklySummary.invalidStartCount} 次</strong>
                    </div>
                    <div className="invalid-summary-item">
                      <span>今日有效启动率</span>
                      <strong>{todayEffectiveRateLabel}</strong>
                    </div>
                    <div className="invalid-summary-item">
                      <span>本周有效启动率</span>
                      <strong>{weeklyEffectiveRateLabel}</strong>
                    </div>
                  </div>
                  <p className="invalid-summary-note">统计说明：无效启动不计入有效时长、目标达成与连续天数。</p>
                </article>
              </div>
            )}

            {dashboardTab === 'trend' && (
              <div className="stack-block">
                <article className="surface-block report">
                  <h3>本周科研周报卡片</h3>
                  <p>
                    周区间：{weeklySummary.weekStartKey} 至 {weeklySummary.weekEndKey}，
                    每日目标达成 {weeklySummary.dailyGoalReachedDays}/7 天。
                  </p>
                  <p>{getWeeklyReportSentence(weeklySummary)}</p>
                </article>

                <article className="surface-block">
                  <h3>最近 7 天趋势</h3>
                  <div className="trend">
                    {weeklySummary.last7Days.map((item) => {
                      const height = Math.max(8, (item.minutes / trendMax) * 96)
                      return (
                        <div key={item.dateKey} className="bar-wrap" title={`${item.dateKey} ${item.minutes} 分钟`}>
                          <div className="bar" style={{ height }} />
                          <span>{item.dateKey.slice(5)}</span>
                        </div>
                      )
                    })}
                  </div>
                </article>

                <article className="surface-block efficiency-card">
                  <div className="efficiency-head">
                    <h3>本周效率</h3>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => {
                        setEfficiencyVizTouched(true)
                        setShowEfficiencyViz((prev) => !prev)
                      }}
                    >
                      {showEfficiencyViz ? '收起效率图' : '展开效率图'}
                    </button>
                  </div>

                  <p className="efficiency-summary">
                    高{weeklySummary.ratingCounts.high} 中{weeklySummary.ratingCounts.medium} 低{weeklySummary.ratingCounts.low} 未评{weeklySummary.ratingCounts.unrated}
                    {' | '}高效占比 {efficiencyHighRatio === null ? '--' : `${efficiencyHighRatio}%`}
                  </p>

                  {showEfficiencyViz && (
                    <>
                      {weeklySummary.ratedSessionCount > 0 ? (
                        <div className="efficiency-viz">
                          <div className="efficiency-kpi">
                            <span>高效占比</span>
                            <strong>{efficiencyHighRatio}%</strong>
                            <small>已评 {weeklySummary.ratedSessionCount}</small>
                          </div>

                          <div className="efficiency-stack">
                            <div className="efficiency-bar" role="img" aria-label="本周效率分布">
                              {efficiencySegments.map((segment) => {
                                const width = efficiencyTotalCount > 0 ? (segment.count / efficiencyTotalCount) * 100 : 0
                                return (
                                  <span
                                    key={segment.key}
                                    className={`efficiency-segment efficiency-segment-${segment.key}`}
                                    style={{ width: `${width}%` }}
                                    title={`${segment.label} ${segment.count}`}
                                  />
                                )
                              })}
                            </div>

                            <div className="efficiency-legend">
                              {efficiencySegments.map((segment) => (
                                <span key={`legend-${segment.key}`} className="efficiency-legend-item">
                                  <i className={`efficiency-dot efficiency-dot-${segment.key}`} />
                                  {segment.label} {segment.count}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <p className="hint">本周还没有评分数据，结束会话时可选择效率评分。</p>
                      )}
                    </>
                  )}
                </article>
              </div>
            )}

            {dashboardTab === 'records' && (
              <article className="surface-block">
                <h3>最近会话</h3>
                <ul className="session-list">
                  {sessions.slice(0, 5).map((session) => {
                    const ratingKey = session.efficiencyRating ?? 'unrated'
                    const ratingText = session.efficiencyRating ? efficiencyLabel[session.efficiencyRating] : '未评'

                    return (
                      <li key={session.id}>
                      <div className="session-head-row">
                        <div className="session-head-main">
                          <strong>
                            {format(new Date(session.startAt), 'MM-dd HH:mm')} → {session.endAt ? format(new Date(session.endAt), 'MM-dd HH:mm') : '进行中'}
                          </strong>
                          <span>{PERIOD_LABEL[session.period]}</span>
                          <span className={`session-efficiency session-efficiency-${ratingKey}`}>
                            效率：{ratingText}
                          </span>
                          {session.startupCheckStatus === 'invalid' && (
                            <span className="startup-invalid-badge">无效启动</span>
                          )}
                        </div>
                        {session.endAt && (
                          <button
                            type="button"
                            className="session-delete-button"
                            onClick={() => {
                              void onDeleteSession(session)
                            }}
                          >
                            移除
                          </button>
                        )}
                      </div>
                      <div>
                        <span>{formatMinutes(sessionMinutes(session, now))}</span>
                        <span>中断 {session.interruptCount} 次</span>
                      </div>
                      <p>{session.goalNote || '无目标备注'} | {session.reviewNote || '无复盘备注'}</p>
                      </li>
                    )
                  })}
                  {sessions.length === 0 && <li>还没有任何打卡记录。</li>}
                </ul>
              </article>
            )}
          </section>
        </>
      )}

      {screen === 'settings' && (
        <>
          <header className="header header-row">
            <div>
              <h1>设置</h1>
              <p>配置提醒时间、目标阈值与手机推送。</p>
            </div>
            <button type="button" className="button-secondary" onClick={() => setScreen('dashboard')}>
              返回主屏
            </button>
          </header>

          {flashMessage && <p className="flash">{flashMessage}</p>}
          {errorMessage && <p className="error">{errorMessage}</p>}

          <section className="card">
            <h2>提醒设置</h2>
            <div className="grid-three">
              {PERIODS.map((period) => (
                <label className="field" key={`reminder-${period}`}>
                  {PERIOD_LABEL[period]}开始提醒
                  <input
                    type="time"
                    value={settings.reminderTimes[period]}
                    onChange={(event) => updateReminderTime(period, event.target.value)}
                  />
                </label>
              ))}
            </div>
          </section>

          <section className="card">
            <h2>基础设置</h2>
            <div className="grid-three">
              {PERIODS.map((period) => {
                const range = settings.periodRanges.find((item) => item.period === period) ?? settings.periodRanges[0]
                return (
                  <div key={`range-${period}`} className="period-range">
                    <span>{PERIOD_LABEL[period]}范围</span>
                    <input type="time" value={range.start} onChange={(event) => updatePeriodRange(period, 'start', event.target.value)} />
                    <input type="time" value={range.end} onChange={(event) => updatePeriodRange(period, 'end', event.target.value)} />
                  </div>
                )
              })}
            </div>

            <div className="grid-three">
              <label className="field">
                每日目标(分钟)
                <input
                  type="number"
                  min={0}
                  value={settings.dailyGoalMinutes}
                  onChange={(event) => updateNumberSetting('dailyGoalMinutes', Number(event.target.value))}
                />
                <small className="field-note">≈ {formatHours(settings.dailyGoalMinutes)}</small>
              </label>
              <label className="field">
                每周目标(分钟)
                <input
                  type="number"
                  min={0}
                  value={settings.weeklyGoalMinutes}
                  onChange={(event) => updateNumberSetting('weeklyGoalMinutes', Number(event.target.value))}
                />
                <small className="field-note">≈ {formatHours(settings.weeklyGoalMinutes)}</small>
              </label>
              <label className="field">
                有效会话阈值(分钟)
                <input
                  type="number"
                  min={1}
                  value={settings.streakMinMinutes}
                  onChange={(event) => updateNumberSetting('streakMinMinutes', Number(event.target.value))}
                />
                <small className="field-note">低于该时长不计入有效会话</small>
              </label>
            </div>
          </section>

          <section className="card">
            <div className="section-head">
              <h2>手机提醒（Bark）</h2>
              <button
                type="button"
                className="button-secondary"
                onClick={() => setShowMobilePushFields((prev) => !prev)}
              >
                {showMobilePushFields ? '收起详情' : '展开详情'}
              </button>
            </div>
            <p className="hint">仅在 app 打开运行时触发。app 关闭后不会自动发送手机提醒。</p>

            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={settings.mobilePush.enabled}
                onChange={(event) => {
                  const checked = event.target.checked
                  updateMobilePushSetting('enabled', checked)
                  if (checked) {
                    setShowMobilePushFields(true)
                  }
                }}
              />
              启用手机提醒
            </label>

            {showMobilePushFields && (
              <div className="grid-three">
                <label className="field">
                  Bark Server
                  <input
                    value={settings.mobilePush.barkServer}
                    onChange={(event) => updateMobilePushSetting('barkServer', event.target.value)}
                    placeholder="https://api.day.app"
                  />
                </label>
                <label className="field">
                  Bark Device Key
                  <input
                    value={settings.mobilePush.barkDeviceKey}
                    onChange={(event) => updateMobilePushSetting('barkDeviceKey', event.target.value)}
                    placeholder="填入 Bark Device Key"
                  />
                </label>
                <label className="field">
                  推送分组
                  <input
                    value={settings.mobilePush.barkGroup}
                    onChange={(event) => updateMobilePushSetting('barkGroup', event.target.value)}
                    placeholder="research-clockin"
                  />
                </label>
              </div>
            )}
          </section>

          <section className="card">
            <h2>分享链接</h2>

            <label className="field">
              分享链接
              <input value={shareUrl} readOnly />
            </label>

            <div className="actions">
              <button type="button" onClick={onCopyShareLink}>复制分享链接</button>
            </div>
          </section>

          <section className="card">
            <div className="actions">
              <button type="button" onClick={onSaveSettings}>保存设置</button>
              <button type="button" className="button-secondary" onClick={onRequestNotificationPermission}>
                通知权限: {notificationPermission}
              </button>
              <button type="button" className="button-secondary" onClick={onSendTestPush}>发送测试到手机</button>
            </div>
          </section>
        </>
      )}

      {showReviewModal && (
        <section className="modal-mask">
          <article className="modal">
            <h3>结束科研并写一句复盘</h3>
            <textarea
              value={reviewDraft}
              onChange={(event) => setReviewDraft(event.target.value)}
              placeholder="例如：今天完成了方法复现，明天开始调参。"
            />
            <div className="review-meta-row">
              <section className="rating-panel">
                <p className="rating-title">本段效率（可跳过）</p>
                <div className="rating-options">
                  <label className={`rating-option rating-option-pill${reviewEfficiencyRating === 'high' ? ' is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="efficiency-rating"
                      checked={reviewEfficiencyRating === 'high'}
                      onChange={() => setReviewEfficiencyRating('high')}
                    />
                    <span>高</span>
                  </label>
                  <label className={`rating-option rating-option-pill${reviewEfficiencyRating === 'medium' ? ' is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="efficiency-rating"
                      checked={reviewEfficiencyRating === 'medium'}
                      onChange={() => setReviewEfficiencyRating('medium')}
                    />
                    <span>中</span>
                  </label>
                  <label className={`rating-option rating-option-pill${reviewEfficiencyRating === 'low' ? ' is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="efficiency-rating"
                      checked={reviewEfficiencyRating === 'low'}
                      onChange={() => setReviewEfficiencyRating('low')}
                    />
                    <span>低</span>
                  </label>
                </div>
              </section>
              <section className="review-invalid-panel">
                <label
                  className="checkbox-field review-invalid-toggle"
                  aria-label="标记为无效启动（不计入有效统计）"
                >
                  <input
                    type="checkbox"
                    checked={reviewMarkInvalidStartup}
                    onChange={(event) => setReviewMarkInvalidStartup(event.target.checked)}
                  />
                  <span className="review-invalid-copy">
                    <span className="review-invalid-title">标记为无效启动</span>
                    <span className="review-invalid-desc">不计入有效统计</span>
                  </span>
                </label>
              </section>
            </div>
            <div className="actions">
              <button type="button" onClick={onCloseReviewModal}>取消</button>
              <button type="button" onClick={onEndConfirm}>确认结束</button>
            </div>
          </article>
        </section>
      )}
    </main>
  )
}

export default App
