import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { importShotProjectFolder, removeMultipleTasks, selectShotVideoImage, updateShotVideoDetails, useStore } from '../store'
import { ImportIcon, TrashIcon } from './icons'
import VideoProjectTitle from './VideoProjectTitle'
import type { TaskRecord, VideoShot } from '../types'
import VideoShotCard, { type VideoShotLayout } from './VideoShotCard'
import {
  readAccounts,
  availableAccounts,
  quotaDate,
  readDoubaoSettings,
  remainingQuota,
  writeAccounts,
  writeDoubaoSettings,
  VIDEO_RATIOS,
  type DoubaoAccount,
  type VideoRatio,
} from '../lib/doubaoAccounts'
import { DEFAULT_VIDEO_BASE_URL } from '../lib/doubaoVideo'
import { buildVideoPrompt, parseShotTemplate } from '../lib/shotTemplate'
import { groupTasksByProject } from '../lib/shotProjectExport'
import { setWorkMode } from '../lib/workMode'
import { runVideoBatch } from '../lib/videoBatch'
import { bindVideoProjectFolder, hasShotVideo, pickVideoProjectFolder, supportsVideoFolderSave, type VideoSource } from '../lib/videoFileSave'
import { useVideoTasks } from '../hooks/useVideoTasks'
import { generateVideoTask } from '../lib/videoGeneration'
import { updateVideoTask, useVideoTaskStore } from '../lib/videoTaskStore'

const VIDEO_SHARED_PROMPT_KEY = 'gpt-image-video-shared-prompt'
const VideoCanvas = lazy(() => import('./VideoCanvas'))

function newAccountId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

export default function VideoWorkspace() {
  const showToast = useStore((s) => s.showToast)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const tasks = useStore((s) => s.tasks)
  const [view, setView] = useState<'list' | 'canvas'>(() => {
    try { return localStorage.getItem('gpt-image-video-view') === 'canvas' ? 'canvas' : 'list' } catch { return 'list' }
  })
  const [canvasProject, setCanvasProject] = useState(() => {
    try { return localStorage.getItem('gpt-image-video-canvas-project') || '' } catch { return '' }
  })
  const folderInput = useRef<HTMLInputElement>(null)
  const importLock = useRef(false)
  const [importProgress, setImportProgress] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<DoubaoAccount[]>(() => readAccounts())
  const [baseUrl, setBaseUrl] = useState(() => readDoubaoSettings().baseUrl || DEFAULT_VIDEO_BASE_URL)
  const [ratio, setRatio] = useState(() => readDoubaoSettings().ratio)
  const [sharedPrompt, setSharedPrompt] = useState(() => localStorage.getItem(VIDEO_SHARED_PROMPT_KEY) || '')
  const [draftName, setDraftName] = useState('')
  const [draftSession, setDraftSession] = useState('')
  const [draftQuota, setDraftQuota] = useState(5)
  const videoState = useVideoTasks()
  const records = videoState.records
  const runningIds = new Set(Object.values(records).filter((record) => record.tracking).map((record) => record.id))
  const busy = runningIds.size > 0 || Object.values(records).some((record) => record.saveState === 'saving')
  const [shotSelection, setShotSelection] = useState<Record<string, boolean>>({})
  const [existingVideos, setExistingVideos] = useState<Record<string, boolean>>({})
  const [checkingVideos, setCheckingVideos] = useState(true)
  const [folderRevision, setFolderRevision] = useState(0)
  const savedVideos = Object.values(records).filter((record) => record.saveState === 'saved').map((record) => `${record.id}:${record.savedPath}`).join('|')
  const [projectSelectionMode, setProjectSelectionMode] = useState(false)
  const [selectedProjectKeys, setSelectedProjectKeys] = useState<Set<string>>(() => new Set())
  const [templateOpen, setTemplateOpen] = useState(false)
  const [templateText, setTemplateText] = useState('')
  const [templateProject, setTemplateProject] = useState('')
  const templateFileInput = useRef<HTMLInputElement>(null)
  const parsedTemplate = useMemo(() => parseShotTemplate(templateText), [templateText])

  useEffect(() => {
    const refresh = () => setAccounts(readAccounts())
    window.addEventListener('storage', refresh)
    window.addEventListener('focus', refresh)
    const timer = window.setInterval(refresh, 60000)
    return () => {
      window.removeEventListener('storage', refresh)
      window.removeEventListener('focus', refresh)
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let checking = false
    const check = async () => {
      if (checking) return
      checking = true
      setCheckingVideos(true)
      const results = await Promise.all(tasks.filter((task) => task.outputImages.length > 0).map(async (task) => [task.id, await hasShotVideo(task)] as const))
      if (cancelled) return
      setExistingVideos((previous) => ({ ...previous, ...Object.fromEntries(results.flatMap(([id, exists]) => exists === undefined ? [] : [[id, exists] as const])) }))
      setCheckingVideos(false)
      checking = false
    }
    void check()
    window.addEventListener('focus', check)
    return () => {
      cancelled = true
      window.removeEventListener('focus', check)
    }
  }, [tasks, folderRevision, savedVideos])

  function saveShotDetails(taskId: string, patch: Pick<TaskRecord, 'shotAction' | 'shotAudio' | 'shotDuration'>) {
    void updateShotVideoDetails([{ id: taskId, ...patch }]).catch(() => showToast('镜头设置保存失败，请重试', 'error'))
  }

  function setShotsSelected(taskIds: string[], selected: boolean) {
    setShotSelection((previous) => ({ ...previous, ...Object.fromEntries(taskIds.map((id) => [id, selected])) }))
  }

  async function openTaskWindow(windowId: string) {
    try {
      const response = await fetch('http://127.0.0.1:8787/task-window/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ windowId }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || '无法打开任务窗口')
      if (result.message) showToast(result.message, 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '请检查豆包本地服务', 'error')
    }
  }

  const groups = useMemo(() => {
    let templateShots: ReturnType<typeof parseShotTemplate> = []
    try {
      templateShots = parseShotTemplate(localStorage.getItem('gpt-image-shot-template') || '')
    } catch {
      templateShots = []
    }
    const frames = [...tasks]
      .filter((task) => (task.outputImages || []).length > 0)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((task) => {
        const parsed = task.shotIndex ? templateShots.find((shot) => shot.index === task.shotIndex) : undefined
        const action = task.shotAction ?? parsed?.action ?? ''
        const audio = task.shotAudio ?? parsed?.sound ?? ''
        const imageId = task.shotVideoImageId && task.outputImages.includes(task.shotVideoImageId)
          ? task.shotVideoImageId : task.outputImages[0]
        const shotDuration = task.shotDuration ?? parsed?.duration ?? 10
        return { ...task, imageId, action, audio, shotDuration, videoPrompt: buildVideoPrompt(action, audio, sharedPrompt, shotDuration, ratio) }
      })
    return groupTasksByProject(frames)
  }, [tasks, sharedPrompt, ratio])
  const frameCount = groups.reduce((count, group) => count + group.tasks.length, 0)
  const activeProject = groups.find((group) => (group.name || group.tasks[0].id) === canvasProject) || groups[0]
  const visibleGroups = view === 'canvas' && !projectSelectionMode ? groups.filter((group) => group === activeProject) : groups
  const selectedProjects = groups.filter((group) => selectedProjectKeys.has(group.name || group.tasks[0].id))
  const selectionDisabled = busy || importProgress !== null || checkingVideos
  const targetGroup = groups.find((group) => (group.name || group.tasks[0].id) === templateProject)
  const templateMatches = targetGroup?.tasks.filter((task) => parsedTemplate.some((shot) => shot.index === task.shotIndex)) || []

  function requestProjectDeletion(projects: typeof groups) {
    if (!projects.length || Object.values(useVideoTaskStore.getState().records).some((record) => record.tracking || record.saveState === 'saving') || importLock.current) return
    const names = new Set(projects.flatMap((group) => group.name ? [group.name] : []))
    const visibleIds = new Set(projects.flatMap((group) => group.tasks.map((task) => task.id)))
    const taskIds = tasks.filter((task) => visibleIds.has(task.id) || names.has(task.shotProjectName?.trim() || '')).map((task) => task.id)
    const label = projects.length === 1 ? `项目「${projects[0].name || '未命名项目'}」` : `所选的 ${projects.length} 个项目`
    setConfirmDialog({
      title: projects.length === 1 ? '删除项目' : '批量删除项目',
      message: `确定要删除${label}的全部 ${taskIds.length} 个任务吗？\n生图中的对应任务也会删除，未被其他任务引用的关联图片会被清理。已保存到原文件夹的图片和视频不受影响。`,
      confirmText: projects.length === 1 ? '删除项目' : '删除所选项目',
      awaitAction: true,
      action: async () => {
        if (Object.values(useVideoTaskStore.getState().records).some((record) => record.tracking || record.saveState === 'saving') || importLock.current) {
          showToast('请等待视频生成或导入完成后再删除项目', 'error')
          return false
        }
        try {
          await removeMultipleTasks(taskIds)
          setSelectedProjectKeys(new Set())
          setProjectSelectionMode(false)
        } catch (err) {
          console.error('删除视频项目失败', err)
          showToast('项目删除失败，请重试', 'error')
          return false
        }
      },
    })
  }

  async function applyTemplate() {
    if (!templateMatches.length || !targetGroup) return
    const byIndex = new Map(parsedTemplate.map((shot) => [shot.index, shot]))
    if (byIndex.size !== parsedTemplate.length) {
      showToast('模板中存在重复片段编号，请修改后重试', 'error')
      return
    }
    try {
      await updateShotVideoDetails(templateMatches.map((task) => {
        const shot = byIndex.get(task.shotIndex!)!
        return { id: task.id, shotAction: shot.action, shotAudio: shot.sound, shotDuration: shot.duration ?? task.shotDuration ?? 10 }
      }))
      setTemplateOpen(false)
      showToast(`已更新 ${templateMatches.length} 个镜头${parsedTemplate.length > templateMatches.length ? '，未匹配的片段已跳过' : ''}`, 'success')
    } catch {
      showToast('模板保存失败，请重试', 'error')
    }
  }

  async function handleImport(files: File[], sources?: Map<string, VideoSource>) {
    if (!files.length || importLock.current) return
    importLock.current = true
    setImportProgress('导入中…')
    try {
      const result = await importShotProjectFolder(files, (done, total) => setImportProgress(`导入 ${done}/${total}`), sources)
      const skipped = result.failedImages + result.ignoredImages
      showToast(`已导入 ${result.importedShots} 个镜头、${result.importedImages} 张图片${skipped ? `，跳过 ${skipped} 张不可用图片` : ''}`, 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '文件夹导入失败', 'error')
    } finally {
      importLock.current = false
      setImportProgress(null)
    }
  }

  async function pickImportFolder() {
    if (!supportsVideoFolderSave()) { folderInput.current?.click(); return }
    try {
      const { files, sources } = await pickVideoProjectFolder()
      await handleImport(files, sources)
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') showToast(error.message, 'error')
    }
  }

  async function bindOriginalFolder(items: TaskRecord[]) {
    try {
      const { files, sources } = await pickVideoProjectFolder()
      const count = await bindVideoProjectFolder(items, files, sources)
      setFolderRevision((previous) => previous + 1)
      showToast(count ? `已关联 ${count} 张原图片，视频将保存到对应目录` : '所选文件夹中未找到与本项目相同的原图片', count ? 'success' : 'error')
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') showToast(error.message, 'error')
    }
  }

  function selectFrame(taskId: string, imageId: string) {
    void selectShotVideoImage(taskId, imageId).catch(() => showToast('首帧保存失败，请重试', 'error'))
  }

  function saveAccountList(next: DoubaoAccount[]) {
    writeAccounts(next)
    setAccounts(readAccounts())
  }

  function addAccount(existing?: DoubaoAccount) {
    const name = existing?.name || draftName.trim() || `账户${accounts.length + 1}`
    if (!name) {
      showToast('请填写账户名称', 'error')
      return
    }
    void (async () => {
      try {
        const response = await fetch('http://127.0.0.1:8787/accounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: existing?.id || newAccountId(), name, dailyQuota: existing?.dailyQuota || Math.max(1, Math.floor(draftQuota) || 1) }),
        })
        const item = await response.json()
        if (!response.ok) throw new Error(item.message || '登录失败')
        saveAccountList([...readAccounts().filter((account) => account.id !== item.id), { ...item, sessionId: '', quotaDate: item.quotaDate || existing?.quotaDate || quotaDate() }])
        setDraftName('')
        setDraftSession('')
        showToast('登录成功，已添加豆包账户', 'success')
      } catch (error) {
        showToast(error instanceof Error ? error.message : '请先启动豆包本地服务', 'error')
      }
    })()
  }

  async function handleGenerate(items: (typeof groups)[number]['tasks'], retry = false) {
    const state = useVideoTaskStore.getState()
    if (state.storageError) {
      showToast(state.storageError, 'error')
      return
    }
    if (!retry && Object.values(state.records).some((record) => record.tracking || record.saveState === 'saving')) return
    if (checkingVideos) return
    const selected = items.filter((item) => (retry || (shotSelection[item.id] ?? !existingVideos[item.id])) && !state.records[item.id]?.tracking && state.records[item.id]?.saveState !== 'saving')
    if (!selected.length) return
    const ready = selected.filter((item) => item.action.trim() || item.audio.trim() || sharedPrompt.trim())
    if (!ready.length) {
      showToast('请先填写公共提示词或镜头动作、音频', 'error')
      return
    }
    if (!baseUrl.trim()) {
      showToast('请先在左侧填写视频接口地址', 'error')
      return
    }
    const saved = readAccounts()
    const available = availableAccounts(saved)
    setAccounts(saved)
    if (!available.length) {
      showToast(saved.length ? '豆包账户今日额度已用完，请明日再试或添加其他账户' : '尚未添加豆包账户，请先添加并扫码登录', 'error')
      return
    }
    if (ready.some((item) => state.records[item.id]?.uncertain || state.records[item.id]?.status === 'completed') &&
        !window.confirm('所选镜头可能已被豆包受理或已有视频，请先检查原对话。确认重新提交？重新提交可能产生重复视频并消耗额度。')) return
    const previousAccountId = retry ? state.records[ready[0].id]?.accountId : undefined
    const batchAccountId = available.find((account) => account.id === previousAccountId)?.id || available[0].id
    try {
      const { done, pending, failed, paused } = await runVideoBatch(ready, (item) => generateVideoTask({
        id: item.id, imageId: item.imageId, shotIndex: item.shotIndex, shotDuration: item.shotDuration,
        prompt: item.videoPrompt, accountId: batchAccountId, baseUrl, ratio,
      }), (remaining) => {
        for (const item of remaining) updateVideoTask(item.id, { statusText: '批次已暂停，前序镜头未完成；本镜头尚未发送' })
      })
      showToast(`完成 ${done}，待查看 ${pending}，失败 ${failed}，暂停未发送 ${paused}`, pending || failed || paused ? 'error' : 'success')
    } finally {
      setAccounts(readAccounts())
    }
  }

  function retryShot(task: (typeof groups)[number]['tasks'][number]) {
    void handleGenerate([task], true)
  }

  function renderShot(task: VideoShot, layout: VideoShotLayout) {
    return <VideoShotCard
      key={task.id}
      task={task}
      record={records[task.id]}
      layout={layout}
      running={runningIds.has(task.id)}
      selected={shotSelection[task.id] ?? !existingVideos[task.id]}
      hasVideo={existingVideos[task.id]}
      disabled={selectionDisabled}
      frameDisabled={busy}
      onSelect={(selected) => setShotsSelected([task.id], selected)}
      onEdit={(patch) => saveShotDetails(task.id, patch)}
      onSelectFrame={selectFrame}
      onRetry={() => retryShot(task)}
      onOpen={openTaskWindow}
    />
  }

  return (
    <main className="min-h-[calc(100vh-3.5rem)] bg-[#f7f8fa] pb-16 dark:bg-gray-950">
      <div className="mx-auto grid max-w-[1600px] grid-cols-1 gap-5 px-4 pb-6 pt-10 sm:py-6 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] lg:gap-8 lg:px-8">
        <aside className="h-fit w-full rounded-2xl border border-gray-200/80 bg-white/95 p-5 shadow-[0_12px_40px_rgba(15,23,42,0.05)] dark:border-white/[0.08] dark:bg-gray-900/90 dark:shadow-none lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.14em] text-blue-600 dark:text-blue-400">VIDEO STUDIO</p>
              <h2 className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">生成设置</h2>
            </div>
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">{accounts.length} 个账户 · {availableAccounts(accounts).length} 个可用</span>
          </div>

          <section className="mt-6">
            <div className="flex items-center justify-between border-b border-gray-100 pb-2 dark:border-white/[0.07]">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">豆包账户</h3>
              <span className="text-xs text-gray-400">自动轮换额度</span>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-white/[0.07]">
              {accounts.length ? accounts.map((account) => {
                const remaining = remainingQuota(account)
                const progress = account.dailyQuota ? Math.round((remaining / account.dailyQuota) * 100) : 0
                return (
                  <div key={account.id} className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">{account.name}</div>
                        <button type="button" onClick={() => addAccount(account)} className="text-xs text-blue-600">重新登录</button>
                        <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">今日剩余 {remaining}/{account.dailyQuota} 次</div>
                        {remaining === 0 && <p className="mt-1 text-xs text-amber-600">今日额度已用完</p>}
                      </div>
                      <button
                        type="button"
                        className="shrink-0 text-xs text-gray-400 transition-colors hover:text-red-500"
                        onClick={() => saveAccountList(accounts.filter((item) => item.id !== account.id))}
                      >
                        移除
                      </button>
                    </div>
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-gray-100 dark:bg-white/[0.08]">
                      <div className="h-full rounded-full bg-blue-500 transition-[width]" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                )
              }) : (
                <p className="py-4 text-sm text-gray-400">还没有账户，添加后即可自动轮换。</p>
              )}
            </div>
          </section>

          <section className="mt-5 border-t border-gray-100 pt-5 dark:border-white/[0.07]">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">添加账户</h3>
            <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">点击添加后，在本地服务中扫码登录豆包。</p>
            <div className="mt-3 space-y-2.5">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
                账户名称
                <input
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  placeholder="例如：豆包 1"
                  className="mt-1.5 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-800 outline-none transition-colors placeholder:text-gray-400 focus:border-blue-400 focus:bg-white dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100 dark:focus:bg-white/[0.07]"
                />
              </label>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
                登录备注
                <input
                  value={draftSession}
                  onChange={(event) => setDraftSession(event.target.value)}
                  placeholder="无需填写 API Key，添加后扫码登录"
                  className="mt-1.5 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-800 outline-none transition-colors placeholder:text-gray-400 focus:border-blue-400 focus:bg-white dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100 dark:focus:bg-white/[0.07]"
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-xs font-medium text-gray-500 dark:text-gray-400">
                每日免费次数
                <input
                  type="number"
                  min={1}
                  value={draftQuota}
                  onChange={(event) => setDraftQuota(Number(event.target.value))}
                  className="w-20 rounded-xl border border-gray-200 bg-gray-50 px-2.5 py-2 text-sm text-gray-800 outline-none transition-colors focus:border-blue-400 focus:bg-white dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100 dark:focus:bg-white/[0.07]"
                />
              </label>
              <button
                type="button"
                onClick={() => addAccount()}
                className="w-full rounded-xl bg-gray-900 px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
              >
                添加并扫码登录
              </button>
            </div>
          </section>

          <section className="mt-5 border-t border-gray-100 pt-5 dark:border-white/[0.07]">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
              视频接口地址
              <input
                value={baseUrl}
                onChange={(event) => {
                  const next = event.target.value
                  setBaseUrl(next)
                  writeDoubaoSettings({ baseUrl: next, ratio })
                }}
                placeholder={DEFAULT_VIDEO_BASE_URL}
                className="mt-1.5 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-800 outline-none transition-colors placeholder:text-gray-400 focus:border-blue-400 focus:bg-white dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100 dark:focus:bg-white/[0.07]"
              />
            </label>
            <p className="mt-2 text-xs leading-5 text-gray-400">生成时会把成图作为首帧，接口被浏览器拦截时可改成你的反代地址。</p>
          </section>

          <section className="mt-5 border-t border-gray-100 pt-5 dark:border-white/[0.07]">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
              视频比例
              <select
                value={ratio}
                disabled={busy}
                onChange={(event) => {
                  const next = event.target.value as VideoRatio
                  setRatio(next)
                  writeDoubaoSettings({ baseUrl, ratio: next })
                }}
                className="mt-1.5 h-10 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-800 outline-none focus:border-blue-400 disabled:opacity-50 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-100"
              >
                {VIDEO_RATIOS.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
          </section>

          <section className="mt-5 border-t border-gray-100 pt-5 dark:border-white/[0.07]">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
              公共提示词
              <textarea
                value={sharedPrompt}
                onChange={(event) => {
                  const next = event.target.value
                  setSharedPrompt(next)
                  localStorage.setItem(VIDEO_SHARED_PROMPT_KEY, next)
                }}
                placeholder="例如：保持画面风格一致，不添加字幕或水印……"
                rows={6}
                className="mt-1.5 w-full resize-y rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm leading-5 text-gray-800 outline-none transition-colors placeholder:text-gray-400 focus:border-blue-400 focus:bg-white dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100 dark:focus:bg-white/[0.07]"
              />
            </label>
            <p className="mt-2 text-xs leading-5 text-gray-400">会自动加到每个镜头的动作和音频提示词前。</p>
          </section>
        </aside>

        <section className="min-w-0">
          <header className="mb-6 flex flex-col gap-4 border-b border-gray-200/80 pb-5 dark:border-white/[0.08] sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.14em] text-blue-600 dark:text-blue-400">SHOT TO VIDEO</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">把成图变成视频</h2>
              <p className="mt-1.5 max-w-xl text-sm leading-6 text-gray-500 dark:text-gray-400">每个镜头沿用已生成的画面，再叠加模板动作和音频，按项目批量生成。长按项目名称可删除项目。</p>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400 sm:justify-end">
              <input
                ref={folderInput}
                type="file"
                multiple
                {...{ webkitdirectory: '', directory: '' }}
                aria-label="导入镜头文件夹"
                className="hidden"
                onChange={(event) => {
                  const files = Array.from(event.currentTarget.files || [])
                  event.currentTarget.value = ''
                  void handleImport(files)
                }}
              />
              <button
                type="button"
                onClick={() => {
                  setTemplateProject(groups[0] ? groups[0].name || groups[0].tasks[0].id : '')
                  setTemplateOpen((open) => !open)
                }}
                disabled={!groups.length || importProgress !== null || busy}
                aria-expanded={templateOpen}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200"
              >
                <ImportIcon className="h-4 w-4 shrink-0" />
                导入动作与音频
              </button>
              <button
                type="button"
                onClick={() => void pickImportFolder()}
                disabled={importProgress !== null || busy}
                title="导入镜头文件夹"
                className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200"
              >
                <ImportIcon className="h-4 w-4 shrink-0" />
                <span aria-live="polite">{importProgress || '导入文件夹'}</span>
              </button>
              {!projectSelectionMode && (
                <button
                  type="button"
                  onClick={() => setProjectSelectionMode(true)}
                  disabled={!groups.length || selectionDisabled}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-red-400 dark:hover:bg-red-500/10"
                >
                  <TrashIcon className="h-4 w-4 shrink-0" />
                  批量删除
                </button>
              )}
              <span className="rounded-full border border-gray-200 bg-white px-3 py-1.5 dark:border-white/[0.08] dark:bg-white/[0.04]">{groups.length} 个项目</span>
              <span className="rounded-full border border-gray-200 bg-white px-3 py-1.5 dark:border-white/[0.08] dark:bg-white/[0.04]">{frameCount} 个镜头</span>
            </div>
          </header>

          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div role="group" aria-label="视频工作区视图" className="inline-flex rounded-xl border border-gray-200 bg-gray-100/70 p-1 dark:border-white/[0.08] dark:bg-white/[0.04]">
              {(['list', 'canvas'] as const).map((mode) => (
                <button key={mode} type="button" aria-pressed={view === mode} onClick={() => {
                  setView(mode)
                  try { localStorage.setItem('gpt-image-video-view', mode) } catch (err) { console.warn('视频视图偏好保存失败', err) }
                }} className={`rounded-lg px-4 py-2 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${view === mode ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white' : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'}`}>
                  {mode === 'list' ? '列表视图' : '无限画布'}
                </button>
              ))}
            </div>
            {view === 'canvas' && groups.length > 0 && !projectSelectionMode && (
              <label className="flex min-w-0 items-center gap-2 text-xs text-gray-500 dark:text-gray-400">当前项目
                <select aria-label="画布项目" value={activeProject.name || activeProject.tasks[0].id} onChange={(event) => {
                  setCanvasProject(event.target.value)
                  try { localStorage.setItem('gpt-image-video-canvas-project', event.target.value) } catch (err) { console.warn('画布项目偏好保存失败', err) }
                }} className="min-w-0 max-w-60 rounded-lg border border-gray-200 bg-white px-3 py-2 text-gray-800 outline-none focus:border-blue-400 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-100">
                  {groups.map((group) => <option key={group.name || group.tasks[0].id} value={group.name || group.tasks[0].id}>{group.name || `未命名项目 · 镜头 ${group.tasks[0].shotIndex || '—'}`}</option>)}
                </select>
              </label>
            )}
          </div>

          {projectSelectionMode && (
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-white/[0.08] dark:bg-gray-900">
              <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-300">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    aria-label="全选项目用于删除"
                    checked={groups.length > 0 && selectedProjects.length === groups.length}
                    ref={(input) => { if (input) input.indeterminate = selectedProjects.length > 0 && selectedProjects.length < groups.length }}
                    disabled={selectionDisabled}
                    onChange={(event) => setSelectedProjectKeys(new Set(event.target.checked ? groups.map((group) => group.name || group.tasks[0].id) : []))}
                    className="h-4 w-4 accent-red-600 disabled:cursor-not-allowed"
                  />
                  全选项目
                </label>
                <span aria-live="polite" className="text-xs text-gray-500">已选 {selectedProjects.length} 个项目</span>
              </div>
              <div className="flex items-center gap-4">
                <button type="button" onClick={() => {
                  setProjectSelectionMode(false)
                  setSelectedProjectKeys(new Set())
                }} className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">取消多选</button>
                <button
                  type="button"
                  onClick={() => requestProjectDeletion(selectedProjects)}
                  disabled={selectionDisabled || !selectedProjects.length}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <TrashIcon className="h-4 w-4" />
                  删除所选项目 ({selectedProjects.length})
                </button>
              </div>
            </div>
          )}

          {templateOpen && (
            <section className="mb-6 border-y border-gray-200 py-4 dark:border-white/[0.08]">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <label className="flex min-w-0 items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                  项目
                  <select aria-label="模板目标项目" value={templateProject} onChange={(event) => setTemplateProject(event.target.value)} className="min-w-0 max-w-60 rounded-lg border border-gray-200 bg-white p-2 dark:border-white/[0.08] dark:bg-gray-900">
                    {groups.map((group) => <option key={group.name || group.tasks[0].id} value={group.name || group.tasks[0].id}>{group.name || `未命名项目 · 镜头 ${group.tasks[0].shotIndex || '—'}`}</option>)}
                  </select>
                </label>
                <input ref={templateFileInput} type="file" accept=".txt,.md,text/plain,text/markdown" className="hidden" aria-label="选择镜头模板文件" onChange={async (event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) {
                    try { setTemplateText(await file.text()) } catch { showToast('模板文件读取失败', 'error') }
                  }
                }} />
                <button type="button" onClick={() => templateFileInput.current?.click()} className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600"><ImportIcon className="h-4 w-4" />选择模板文件</button>
              </div>
              <textarea aria-label="动作与音频模板" value={templateText} onChange={(event) => setTemplateText(event.target.value)} rows={7} placeholder="片段 01&#10;建议时长：55 ÷ 6 = 9.2秒&#10;镜头：…&#10;动作：…&#10;音频：…" className="w-full resize-y rounded-lg border border-gray-200 bg-white p-3 text-sm leading-6 text-gray-800 outline-none focus:border-blue-400 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-100" />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <span aria-live="polite" className="text-xs text-gray-500">{parsedTemplate.length} 个片段 · 匹配 {templateMatches.length} 个镜头</span>
                <div className="flex items-center gap-4">
                  <button type="button" onClick={() => setTemplateOpen(false)} className="text-xs text-gray-500">取消</button>
                  <button type="button" onClick={() => void applyTemplate()} disabled={!templateMatches.length || busy} className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-40 dark:bg-white dark:text-gray-900">应用到项目镜头</button>
                </div>
              </div>
            </section>
          )}

          {videoState.storageError && <p role="alert" className="mb-4 text-sm text-red-600">{videoState.storageError}</p>}
          {groups.length ? visibleGroups.map((group) => {
            const projectKey = group.name || group.tasks[0].id
            const selectedCount = group.tasks.filter((task) => shotSelection[task.id] ?? !existingVideos[task.id]).length
            return (
            <section key={projectKey} className="mb-5 overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_8px_28px_rgba(15,23,42,0.04)] dark:border-white/[0.08] dark:bg-gray-900 dark:shadow-none">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-white/[0.07]">
                <div className="flex min-w-0 items-start gap-3">
                  {projectSelectionMode && (
                    <input
                      type="checkbox"
                      aria-label={`选择项目「${group.name || '未命名项目'}」用于删除`}
                      checked={selectedProjectKeys.has(projectKey)}
                      disabled={selectionDisabled}
                      onChange={(event) => {
                        const checked = event.target.checked
                        setSelectedProjectKeys((previous) => {
                          const next = new Set(previous)
                          if (checked) next.add(projectKey)
                          else next.delete(projectKey)
                          return next
                        })
                      }}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-red-600 disabled:cursor-not-allowed"
                    />
                  )}
                  <div className="min-w-0">
                    <VideoProjectTitle name={group.name} disabled={selectionDisabled} onDelete={() => requestProjectDeletion([group])} />
                    <p className="mt-0.5 text-xs text-gray-400" aria-live="polite">已选 {selectedCount} / {group.tasks.length} 个镜头</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                <button type="button" onClick={() => void bindOriginalFolder(group.tasks)} disabled={selectionDisabled} className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 disabled:opacity-40"><ImportIcon className="h-4 w-4" />关联原文件夹</button>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                  <input
                    type="checkbox"
                    aria-label={`${group.name || '未命名项目'}全选镜头`}
                    checked={selectedCount === group.tasks.length}
                    ref={(input) => { if (input) input.indeterminate = selectedCount > 0 && selectedCount < group.tasks.length }}
                    disabled={selectionDisabled}
                    onChange={(event) => setShotsSelected(group.tasks.map((task) => task.id), event.target.checked)}
                    className="h-4 w-4 shrink-0 accent-blue-600 disabled:cursor-not-allowed"
                  />
                  全选
                </label>
                <button
                  type="button"
                  onClick={() => void handleGenerate(group.tasks)}
                  disabled={selectionDisabled || selectedCount === 0}
                  className="shrink-0 rounded-xl bg-gray-900 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
                >
                  {busy ? '生成中…' : `生成所选视频 (${selectedCount})`}
                </button>
                </div>
              </div>
              {view === 'canvas' && !projectSelectionMode ? (
                <Suspense fallback={<p role="status" className="p-8 text-center text-sm text-gray-500">正在打开画布…</p>}>
                  <VideoCanvas key={projectKey} projectKey={projectKey} tasks={group.tasks} renderStage={(task, stage) => renderShot(task, stage)} />
                </Suspense>
              ) : (
              <div className={`grid gap-px bg-gray-100 dark:bg-white/[0.07] ${group.tasks.length > 1 ? 'min-[1900px]:grid-cols-2' : 'grid-cols-1'}`}>
                {group.tasks.map((task) => renderShot(task, group.tasks.length === 1 ? 'single' : 'list'))}
              </div>
              )}
            </section>
            )
          }) : (
            <div className="flex min-h-[430px] flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-white/65 px-6 py-12 text-center dark:border-white/[0.14] dark:bg-white/[0.03]">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-2xl text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">✦</div>
              <h3 className="mt-5 text-lg font-semibold text-gray-900 dark:text-gray-100">这里会出现你的镜头</h3>
              <p className="mt-2 max-w-sm text-sm leading-6 text-gray-500 dark:text-gray-400">先在「生图」里生成带有镜头编号的图片，回到这里就能按项目批量生成视频。</p>
              <button
                type="button"
                onClick={() => setWorkMode('image')}
                className="mt-5 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
              >
                去生图
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
