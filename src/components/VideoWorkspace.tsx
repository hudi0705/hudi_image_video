import { useEffect, useMemo, useRef, useState } from 'react'
import { importShotProjectFolder, selectShotVideoImage, updateShotVideoDetails, useStore } from '../store'
import { ImportIcon, RefreshIcon } from './icons'
import type { TaskRecord } from '../types'
import { ensureImageCached, getCachedImage } from '../lib/imageCache'
import {
  readAccounts,
  availableAccounts,
  readDoubaoSettings,
  remainingQuota,
  writeAccounts,
  writeDoubaoSettings,
  VIDEO_RATIOS,
  type DoubaoAccount,
  type VideoRatio,
} from '../lib/doubaoAccounts'
import { DEFAULT_VIDEO_BASE_URL, DEFAULT_VIDEO_MODEL, generateWithAccountRotation } from '../lib/doubaoVideo'
import { buildVideoPrompt, parseShotTemplate } from '../lib/shotTemplate'
import { groupTasksByProject } from '../lib/shotProjectExport'
import { setWorkMode } from '../lib/workMode'
import { runVideoBatch } from '../lib/videoBatch'
import { bindVideoProjectFolder, pickVideoProjectFolder, prepareVideoSave, saveVideoBesideImage, supportsVideoFolderSave, type VideoSource } from '../lib/videoFileSave'

const VIDEO_SHARED_PROMPT_KEY = 'gpt-image-video-shared-prompt'
type VideoTask = TaskRecord & {
  action?: string
  audio?: string
  imageId: string
}

function newAccountId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

function FrameThumb({ imageId }: { imageId: string }) {
  const [src, setSrc] = useState(() => getCachedImage(imageId) || '')

  useEffect(() => {
    let cancelled = false
    setSrc(getCachedImage(imageId) || '')
    void ensureImageCached(imageId).then((url) => {
      if (!cancelled && url) setSrc(url)
    })
    return () => {
      cancelled = true
    }
  }, [imageId])

  return src
    ? <img src={src} alt="" className="h-full w-full object-cover" />
    : <span className="block h-full w-full bg-gray-100 dark:bg-white/[0.04]" />
}

export default function VideoWorkspace() {
  const showToast = useStore((s) => s.showToast)
  const tasks = useStore((s) => s.tasks)
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
  const [runningId, setRunningId] = useState<string | null>(null)
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set())
  const generationLock = useRef(false)
  const activeRuns = useRef(0)
  const inFlightTasks = useRef(new Set<string>())
  const taskAccountIds = useRef(new Map<string, string>())
  const [retryableIds, setRetryableIds] = useState<Set<string>>(new Set())
  const [uncertainIds, setUncertainIds] = useState<Set<string>>(new Set())
  const [videos, setVideos] = useState<Record<string, string>>({})
  const [videoDownloads, setVideoDownloads] = useState<Record<string, string>>({})
  const [unsavedIds, setUnsavedIds] = useState<Set<string>>(new Set())
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set())
  const [responses, setResponses] = useState<Record<string, string>>({})
  const [requests, setRequests] = useState<Record<string, string>>({})
  const [taskLinks, setTaskLinks] = useState<Record<string, string>>({})
  const [taskWindows, setTaskWindows] = useState<Record<string, string>>({})
  const [taskStatuses, setTaskStatuses] = useState<Record<string, string>>({})
  const [excludedTaskIds, setExcludedTaskIds] = useState<Set<string>>(() => new Set())
  const [templateOpen, setTemplateOpen] = useState(false)
  const [templateText, setTemplateText] = useState('')
  const [templateProject, setTemplateProject] = useState('')
  const templateFileInput = useRef<HTMLInputElement>(null)
  const parsedTemplate = useMemo(() => parseShotTemplate(templateText), [templateText])

  function saveShotDetails(taskId: string, patch: Pick<TaskRecord, 'shotAction' | 'shotAudio' | 'shotDuration'>) {
    void updateShotVideoDetails([{ id: taskId, ...patch }]).catch(() => showToast('镜头设置保存失败，请重试', 'error'))
  }

  function setShotsSelected(taskIds: string[], selected: boolean) {
    setExcludedTaskIds((previous) => {
      const next = new Set(previous)
      for (const id of taskIds) {
        if (selected) next.delete(id)
        else next.add(id)
      }
      return next
    })
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
  const targetGroup = groups.find((group) => (group.name || group.tasks[0].id) === templateProject)
  const templateMatches = targetGroup?.tasks.filter((task) => parsedTemplate.some((shot) => shot.index === task.shotIndex)) || []

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
      showToast(count ? `已关联 ${count} 张原图片，视频将保存到对应目录` : '所选文件夹中未找到与本项目相同的原图片', count ? 'success' : 'error')
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') showToast(error.message, 'error')
    }
  }

  async function saveTaskVideo(task: VideoTask, url: string, source?: VideoSource) {
    setSavingIds(prev => new Set(prev).add(task.id))
    try {
      source ||= await prepareVideoSave(task.id, task.imageId)
      if (!source) throw new Error('请先关联原图片文件夹，再点击保存视频')
      setTaskStatuses(prev => ({ ...prev, [task.id]: '视频已生成，正在保存到原图片文件夹…' }))
      const savedPath = await saveVideoBesideImage(source, url, task.shotIndex)
      setTaskStatuses(prev => ({ ...prev, [task.id]: `已保存：${savedPath}` }))
      setUnsavedIds(prev => { const next = new Set(prev); next.delete(task.id); return next })
    } catch (error) {
      setUnsavedIds(prev => new Set(prev).add(task.id))
      setTaskStatuses(prev => ({ ...prev, [task.id]: `视频已生成，未保存：${error instanceof Error ? error.message : '保存失败'}` }))
    } finally {
      setSavingIds(prev => { const next = new Set(prev); next.delete(task.id); return next })
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
        saveAccountList([...readAccounts().filter((account) => account.id !== item.id), { ...item, sessionId: '', quotaDate: existing?.quotaDate || '' }])
        setDraftName('')
        setDraftSession('')
        showToast('登录成功，已添加豆包账户', 'success')
      } catch (error) {
        showToast(error instanceof Error ? error.message : '请先启动豆包本地服务', 'error')
      }
    })()
  }

  async function handleGenerate(items: (typeof groups)[number]['tasks'], retry = false) {
    if (generationLock.current && !retry) return
    const selected = items.filter((item) => (retry || !excludedTaskIds.has(item.id)) && !inFlightTasks.current.has(item.id))
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
    generationLock.current = true
    activeRuns.current++
    for (const item of ready) inFlightTasks.current.add(item.id)
    const batchAccountId = (retry ? taskAccountIds.current.get(ready[0].id) : undefined) || availableAccounts(readAccounts())[0]?.id
    if (batchAccountId) for (const item of ready) taskAccountIds.current.set(item.id, batchAccountId)
    setTaskStatuses((prev) => ({ ...prev, ...Object.fromEntries(ready.map(item => [item.id, '已排队，等待账号发送锁'])) }))
    try {
      const { done, pending, failed, paused } = await runVideoBatch(ready, async item => {
        setRunningId(item.id)
        setRunningIds(prev => new Set(prev).add(item.id))
        setRetryableIds(prev => { const next = new Set(prev); next.delete(item.id); return next })
        setUncertainIds(prev => { const next = new Set(prev); next.delete(item.id); return next })
        setTaskStatuses((prev) => ({ ...prev, [item.id]: '正在上传图片并发送消息…' }))
        setVideos((prev) => ({ ...prev, [item.id]: '' }))
        setUnsavedIds(prev => { const next = new Set(prev); next.delete(item.id); return next })
        setResponses((prev) => ({ ...prev, [item.id]: '' }))
        setRequests((prev) => ({ ...prev, [item.id]: item.videoPrompt }))
        try {
          const dataUrl = await ensureImageCached(item.imageId)
          if (!dataUrl) throw new Error('找不到生成好的图片')
          const source = await prepareVideoSave(item.id, item.imageId).catch(() => undefined)
          const result = await generateWithAccountRotation({
            accountId: batchAccountId,
            baseUrl,
            prompt: item.videoPrompt,
            imageDataUrl: dataUrl,
            duration: item.shotDuration,
            ratio,
            model: DEFAULT_VIDEO_MODEL,
            onProgress: (progress) => {
              const status = progress.status === 'queued' ? '尚未发送，等待该账号前序镜头开始生成'
                : progress.status === 'confirming' ? '已识别参数确认，正在自动回复并等待豆包受理…'
                : progress.status === 'failed' ? progress.responseText || '任务失败，请查看豆包窗口'
                : progress.status === 'needs_attention' ? '等待你在豆包窗口确认，正在继续跟踪'
                : progress.status === 'waiting' ? '消息已保存，等待豆包明确开始生成…'
                : progress.status === 'generating' ? '豆包已受理，正在生成视频…'
                : '正在上传图片并发送消息…'
              setTaskStatuses((prev) => ({ ...prev, [item.id]: status }))
              if (progress.responseText) setResponses((prev) => ({ ...prev, [item.id]: progress.responseText! }))
              if (progress.taskUrl) setTaskLinks((prev) => ({ ...prev, [item.id]: progress.taskUrl! }))
            },
            onTaskWindow: (id) => {
              setTaskWindows((prev) => ({ ...prev, [item.id]: id }))
              setTaskLinks((prev) => ({ ...prev, [item.id]: '' }))
            },
          })
          setVideos((prev) => ({ ...prev, [item.id]: result.url }))
          setVideoDownloads(prev => ({ ...prev, [item.id]: result.downloadUrl || result.url }))
          setResponses((prev) => ({ ...prev, [item.id]: result.responseText || '' }))
          setRequests((prev) => ({ ...prev, [item.id]: result.requestText || item.videoPrompt }))
          setTaskLinks((prev) => ({ ...prev, [item.id]: result.taskUrl || '' }))
          setAccounts(readAccounts())
          if (result.status !== 'completed') {
            setRetryableIds(prev => new Set(prev).add(item.id))
            setUncertainIds(prev => new Set(prev).add(item.id))
            setTaskStatuses((prev) => ({ ...prev, [item.id]: result.status === 'needs_attention' ? '等待你在豆包窗口确认，本次跟踪已结束'
              : result.status === 'generating' ? '豆包已开始生成，本次跟踪已超时，请查看原窗口结果'
              : '尚未确认生成完成，请查看豆包窗口' }))
            return result.status
          }
          await saveTaskVideo(item, result.downloadUrl || result.url, source)
          return 'completed'
        } catch (err) {
          setRetryableIds(prev => new Set(prev).add(item.id))
          // 接口明确拒绝时可直接重试；其他异常可能发生在受理之后。
          if (!(err instanceof Error && 'code' in err && err.code === 'DOUBAO_SUBMIT_FAILED')) {
            setUncertainIds(prev => new Set(prev).add(item.id))
          }
          setTaskStatuses((prev) => ({ ...prev, [item.id]: err instanceof Error ? err.message : '任务失败，请查看豆包窗口' }))
          if (err instanceof Error && 'code' in err && err.code === 'DOUBAO_BATCH_PAUSED') return 'paused'
          return 'failed'
        } finally {
          inFlightTasks.current.delete(item.id)
          setRunningIds(prev => { const next = new Set(prev); next.delete(item.id); return next })
          setAccounts(readAccounts())
        }
      }, remaining => {
        setTaskStatuses(prev => ({ ...prev, ...Object.fromEntries(remaining.map(item => [item.id, '批次已暂停，前序镜头未完成；本镜头尚未发送'])) }))
      })
      showToast(`完成 ${done}，待查看 ${pending}，失败 ${failed}，暂停未发送 ${paused}`, pending || failed || paused ? 'error' : 'success')
    } finally {
      activeRuns.current--
      if (!activeRuns.current) {
        generationLock.current = false
        setRunningId(null)
      }
    }
  }

  function retryShot(task: (typeof groups)[number]['tasks'][number]) {
    if (inFlightTasks.current.has(task.id)) return
    if (uncertainIds.has(task.id) && !window.confirm('此镜头可能已被豆包受理，请先检查原对话。确认重新提交？重新提交可能产生重复视频并消耗额度。')) return
    void handleGenerate([task], true)
  }

  return (
    <main className="min-h-[calc(100vh-3.5rem)] bg-[#f7f8fa] pb-16 dark:bg-gray-950">
      <div className="mx-auto grid max-w-[1600px] grid-cols-1 gap-5 px-4 pb-6 pt-10 sm:py-6 lg:grid-cols-[minmax(300px,350px)_minmax(0,1fr)] lg:gap-8 lg:px-8">
        <aside className="h-fit w-full rounded-2xl border border-gray-200/80 bg-white/95 p-5 shadow-[0_12px_40px_rgba(15,23,42,0.05)] dark:border-white/[0.08] dark:bg-gray-900/90 dark:shadow-none lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.14em] text-blue-600 dark:text-blue-400">VIDEO STUDIO</p>
              <h2 className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">生成设置</h2>
            </div>
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">{accounts.length} 个账户</span>
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
                disabled={Boolean(runningId)}
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
              <p className="mt-1.5 max-w-xl text-sm leading-6 text-gray-500 dark:text-gray-400">每个镜头沿用已生成的画面，再叠加模板动作和音频，按项目批量生成。</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
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
                disabled={!groups.length || importProgress !== null || Boolean(runningId)}
                aria-expanded={templateOpen}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200"
              >
                <ImportIcon className="h-4 w-4 shrink-0" />
                导入动作与音频
              </button>
              <button
                type="button"
                onClick={() => void pickImportFolder()}
                disabled={importProgress !== null || Boolean(runningId)}
                title="导入镜头文件夹"
                className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200"
              >
                <ImportIcon className="h-4 w-4 shrink-0" />
                <span aria-live="polite">{importProgress || '导入文件夹'}</span>
              </button>
              <span className="rounded-full border border-gray-200 bg-white px-3 py-1.5 dark:border-white/[0.08] dark:bg-white/[0.04]">{groups.length} 个项目</span>
              <span className="rounded-full border border-gray-200 bg-white px-3 py-1.5 dark:border-white/[0.08] dark:bg-white/[0.04]">{frameCount} 个镜头</span>
            </div>
          </header>

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
                  <button type="button" onClick={() => void applyTemplate()} disabled={!templateMatches.length || Boolean(runningId)} className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-40 dark:bg-white dark:text-gray-900">应用到项目镜头</button>
                </div>
              </div>
            </section>
          )}

          {groups.length ? groups.map((group) => {
            const selectedCount = group.tasks.filter((task) => !excludedTaskIds.has(task.id)).length
            const selectionDisabled = Boolean(runningId) || importProgress !== null
            return (
            <section key={group.name || group.tasks[0].id} className="mb-5 overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_8px_28px_rgba(15,23,42,0.04)] dark:border-white/[0.08] dark:bg-gray-900 dark:shadow-none">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-white/[0.07]">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{group.name || '未命名项目'}</h3>
                  <p className="mt-0.5 text-xs text-gray-400" aria-live="polite">已选 {selectedCount} / {group.tasks.length} 个镜头</p>
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
                  {runningId ? '生成中…' : `生成所选视频 (${selectedCount})`}
                </button>
                </div>
              </div>
              <div className={`grid gap-px bg-gray-100 dark:bg-white/[0.07] ${group.tasks.length > 1 ? 'xl:grid-cols-2' : 'grid-cols-1'}`}>
                {group.tasks.map((task) => {
                  const single = group.tasks.length === 1
                  const video = videos[task.id]
                  if (single) {
                    return (
                      <article key={task.id} className={`grid gap-5 bg-white p-5 dark:bg-gray-900 ${video ? 'lg:grid-cols-[180px_minmax(0,1fr)_minmax(240px,420px)]' : 'sm:grid-cols-[180px_minmax(0,1fr)]'}`}>
                        <ShotFrames task={task} disabled={Boolean(runningId)} onSelect={selectFrame} />
                        <div className="min-w-0">
                          <ShotDetails task={task} running={runningIds.has(task.id)} selected={!excludedTaskIds.has(task.id)} disabled={selectionDisabled} onSelect={(selected) => setShotsSelected([task.id], selected)} onEdit={(patch) => saveShotDetails(task.id, patch)} />
                      {responses[task.id] && <details className="mt-2 rounded-xl bg-gray-50 p-2 dark:bg-white/[0.04]"><summary className="cursor-pointer text-xs font-medium">豆包回复</summary><p className="mt-1 whitespace-pre-wrap text-xs text-gray-500">{responses[task.id]}</p></details>}
                      {requests[task.id] && <details className="mt-2 rounded-xl bg-blue-50 p-2 dark:bg-blue-950/20"><summary className="cursor-pointer text-xs font-medium">发送给豆包的消息</summary><p className="mt-1 whitespace-pre-wrap text-xs text-gray-500">{requests[task.id]}</p></details>}
                      <p className="mt-2 break-words text-xs text-amber-600">{taskStatuses[task.id]}</p>
                      <div className="mt-2 text-xs">
                        {video && unsavedIds.has(task.id) && <button type="button" disabled={savingIds.has(task.id)} onClick={() => void saveTaskVideo(task, videoDownloads[task.id] || video)} className="mr-3 font-medium text-blue-600 disabled:opacity-40">{savingIds.has(task.id) ? '保存中…' : '保存视频'}</button>}
                        {retryableIds.has(task.id) && <button type="button" disabled={runningIds.has(task.id)} onClick={() => retryShot(task)} title="重新提交此镜头" className="mr-3 inline-flex items-center gap-1 font-medium text-blue-600 hover:underline disabled:opacity-40"><RefreshIcon className="h-3.5 w-3.5" />重试</button>}
                        {taskWindows[task.id] && <button type="button" onClick={() => void openTaskWindow(taskWindows[task.id])} className="mr-3 font-medium text-blue-600 hover:underline">查看本次豆包窗口 ↗</button>}
                        {taskLinks[task.id]
                          ? <a href={taskLinks[task.id]} target="_blank" rel="noreferrer" className="font-medium text-blue-600 hover:underline">打开豆包对话 ↗</a>
                          : !taskWindows[task.id] && <span className="text-gray-500">{runningIds.has(task.id) ? '正在获取豆包对话链接…' : videos[task.id] ? '未获取到本次对话链接' : '生成后可查看豆包对话链接'}</span>}
                      </div>
                        </div>
                        {video && <video src={video} controls className="w-full self-start rounded-xl bg-black" />}
                      </article>
                    )
                  }
                  return (
                    <article key={task.id} className="flex flex-col gap-4 bg-white p-4 dark:bg-gray-900 sm:flex-row">
                      <div className="w-full shrink-0 sm:w-44">
                        <ShotFrames task={task} disabled={Boolean(runningId)} onSelect={selectFrame} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <ShotDetails task={task} running={runningIds.has(task.id)} selected={!excludedTaskIds.has(task.id)} disabled={selectionDisabled} onSelect={(selected) => setShotsSelected([task.id], selected)} onEdit={(patch) => saveShotDetails(task.id, patch)} />
                        {videos[task.id] && <video src={videos[task.id]} controls className="mt-3 w-full rounded-xl bg-black" />}
                        {responses[task.id] && <details className="mt-2 rounded-xl bg-gray-50 p-2 dark:bg-white/[0.04]"><summary className="cursor-pointer text-xs font-medium">豆包回复</summary><p className="mt-1 whitespace-pre-wrap text-xs text-gray-500">{responses[task.id]}</p></details>}
                        {requests[task.id] && <details className="mt-2 rounded-xl bg-blue-50 p-2 dark:bg-blue-950/20"><summary className="cursor-pointer text-xs font-medium">发送给豆包的消息</summary><p className="mt-1 whitespace-pre-wrap text-xs text-gray-500">{requests[task.id]}</p></details>}
                        {taskStatuses[task.id] && <p className="mt-2 break-words text-xs text-amber-600">{taskStatuses[task.id]}</p>}
                        <div className="mt-2 flex flex-wrap gap-3 text-xs">
                          {video && unsavedIds.has(task.id) && <button type="button" disabled={savingIds.has(task.id)} onClick={() => void saveTaskVideo(task, videoDownloads[task.id] || video)} className="font-medium text-blue-600 disabled:opacity-40">{savingIds.has(task.id) ? '保存中…' : '保存视频'}</button>}
                          {retryableIds.has(task.id) && <button type="button" disabled={runningIds.has(task.id)} onClick={() => retryShot(task)} title="重新提交此镜头" className="inline-flex items-center gap-1 font-medium text-blue-600 hover:underline disabled:opacity-40"><RefreshIcon className="h-3.5 w-3.5" />重试</button>}
                          {taskWindows[task.id] && <button type="button" onClick={() => void openTaskWindow(taskWindows[task.id])} className="font-medium text-blue-600 hover:underline">查看本次豆包窗口 ↗</button>}
                          {taskLinks[task.id] && <a href={taskLinks[task.id]} target="_blank" rel="noreferrer" className="font-medium text-blue-600 hover:underline">打开豆包对话 ↗</a>}
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
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

function ShotFrames({ task, disabled, onSelect }: {
  task: VideoTask
  disabled: boolean
  onSelect: (taskId: string, imageId: string) => void
}) {
  return (
    <div className="min-w-0">
      <div className="aspect-video w-full overflow-hidden rounded-xl bg-gray-100 dark:bg-white/[0.05]">
        <FrameThumb imageId={task.imageId} />
      </div>
      {task.outputImages.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={`镜头${task.shotIndex || ''}首帧`}>
          {task.outputImages.map((imageId, index) => (
            <button
              key={imageId}
              type="button"
              disabled={disabled}
              aria-label={`选择第${index + 1}张图片作为首帧`}
              aria-pressed={task.imageId === imageId}
              title={`首帧 ${index + 1}`}
              onClick={() => onSelect(task.id, imageId)}
              className={`h-10 w-14 overflow-hidden rounded-md border-2 disabled:cursor-not-allowed ${task.imageId === imageId ? 'border-blue-500' : 'border-transparent hover:border-gray-300'}`}
            >
              <FrameThumb imageId={imageId} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ShotDetails({ task, running, selected, disabled, onSelect, onEdit }: {
  task: VideoTask
  running: boolean
  selected: boolean
  disabled: boolean
  onSelect: (selected: boolean) => void
  onEdit: (patch: Pick<TaskRecord, 'shotAction' | 'shotAudio' | 'shotDuration'>) => void
}) {
  const [durationDraft, setDurationDraft] = useState(String(task.shotDuration ?? 10))
  useEffect(() => setDurationDraft(String(task.shotDuration ?? 10)), [task.shotDuration])
  const inputClass = 'mt-1 w-full resize-y rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs leading-5 text-gray-700 outline-none focus:border-blue-400 disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200'
  return (
    <div className="min-w-0 text-xs leading-5 text-gray-600 dark:text-gray-300">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          aria-label={`选择镜头 ${task.shotIndex || '—'}生成视频`}
          checked={selected}
          disabled={disabled}
          onChange={(event) => onSelect(event.target.checked)}
          className="h-4 w-4 shrink-0 accent-blue-600 disabled:cursor-not-allowed"
        />
        <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700 dark:bg-white/[0.08] dark:text-gray-200">镜头 {task.shotIndex || '—'}</span>
        </label>
        {running && <span className="text-blue-500">生成中</span>}
      </div>
      <label className="block">动作<textarea aria-label={`镜头 ${task.shotIndex || '—'}动作`} rows={3} value={task.action || ''} disabled={disabled} onChange={(event) => onEdit({ shotAction: event.target.value })} className={inputClass} /></label>
      <label className="mt-2 block">音频<textarea aria-label={`镜头 ${task.shotIndex || '—'}音频`} rows={3} value={task.audio || ''} disabled={disabled} onChange={(event) => onEdit({ shotAudio: event.target.value })} className={inputClass} /></label>
      <label className="mt-2 flex flex-wrap items-center gap-2">时长
        <input aria-label={`镜头 ${task.shotIndex || '—'}时长（秒）`} type="number" min={0.1} step={0.1} value={durationDraft} disabled={disabled} onChange={(event) => {
          setDurationDraft(event.target.value)
        }} onBlur={() => {
          const value = Number(durationDraft)
          if (Number.isFinite(value) && value > 0) onEdit({ shotDuration: value })
          else setDurationDraft(String(task.shotDuration ?? 10))
        }} className="w-20 rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 outline-none focus:border-blue-400 disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.04]" />秒
      </label>
    </div>
  )
}
