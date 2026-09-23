import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { ensureImageCached, getCachedImage } from '../lib/imageCache'
import {
  readAccounts,
  readDoubaoSettings,
  remainingQuota,
  writeAccounts,
  writeDoubaoSettings,
  type DoubaoAccount,
} from '../lib/doubaoAccounts'
import { DEFAULT_VIDEO_BASE_URL, DEFAULT_VIDEO_MODEL, generateWithAccountRotation } from '../lib/doubaoVideo'
import { buildVideoPrompt, parseShotTemplate } from '../lib/shotTemplate'
import { groupTasksByProject } from '../lib/shotProjectExport'

const VIDEO_SHARED_PROMPT_KEY = 'gpt-image-video-shared-prompt'

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
  const [accounts, setAccounts] = useState<DoubaoAccount[]>(() => readAccounts())
  const [baseUrl, setBaseUrl] = useState(() => readDoubaoSettings().baseUrl || DEFAULT_VIDEO_BASE_URL)
  const [sharedPrompt, setSharedPrompt] = useState(() => localStorage.getItem(VIDEO_SHARED_PROMPT_KEY) || '')
  const [draftName, setDraftName] = useState('')
  const [draftSession, setDraftSession] = useState('')
  const [draftQuota, setDraftQuota] = useState(5)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [videos, setVideos] = useState<Record<string, string>>({})

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
        const parsed = task.shotIndex ? templateShots[task.shotIndex - 1] : undefined
        const action = task.shotAction || parsed?.action || ''
        const audio = task.shotAudio || parsed?.sound || ''
        return { ...task, imageId: task.outputImages[0], action, audio, videoPrompt: buildVideoPrompt(action, audio, sharedPrompt) }
      })
    return groupTasksByProject(frames)
  }, [tasks, sharedPrompt])

  function saveAccountList(next: DoubaoAccount[]) {
    writeAccounts(next)
    setAccounts(readAccounts())
  }

  function addAccount() {
    const sessionId = draftSession.trim()
    if (!sessionId) {
      showToast('请填写火山方舟 API Key', 'error')
      return
    }
    const account: DoubaoAccount = {
      id: newAccountId(),
      name: draftName.trim() || `账户${accounts.length + 1}`,
      sessionId,
      dailyQuota: Math.max(1, Math.floor(draftQuota) || 1),
      usedToday: 0,
      quotaDate: '',
    }
    saveAccountList([...accounts, account])
    setDraftName('')
    setDraftSession('')
    showToast('已添加豆包账户', 'success')
  }

  async function handleGenerate(items: (typeof groups)[number]['tasks']) {
    if (runningId) return
    const ready = items.filter((item) => item.videoPrompt)
    if (!ready.length) {
      showToast('请先填写公共提示词或镜头动作、音频', 'error')
      return
    }
    if (!baseUrl.trim()) {
      showToast('请先在左侧填写视频接口地址', 'error')
      return
    }
    let done = 0
    try {
      for (const item of ready) {
        setRunningId(item.imageId)
        const dataUrl = await ensureImageCached(item.imageId)
        if (!dataUrl) throw new Error('找不到生成好的图片')
        const result = await generateWithAccountRotation({
          baseUrl,
          prompt: item.videoPrompt,
          imageDataUrl: dataUrl,
          model: DEFAULT_VIDEO_MODEL,
        })
        setVideos((prev) => ({ ...prev, [item.imageId]: result.url }))
        setAccounts(readAccounts())
        done += 1
      }
      showToast(`已生成 ${done} 个视频`, 'success')
    } catch (err) {
      setAccounts(readAccounts())
      showToast(err instanceof Error ? err.message : '视频生成失败', 'error')
    } finally {
      setRunningId(null)
    }
  }

  return (
    <main className="pb-16">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 lg:flex-row lg:px-6">
        <aside className="w-full shrink-0 rounded-3xl border border-gray-200 bg-white p-4 dark:border-white/[0.08] dark:bg-gray-950 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:w-80 lg:overflow-y-auto">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">豆包账户</h2>
          <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
            每个账户单独计算今天的免费次数。用完后自动切换到下一个还有额度的账户。
          </p>
          <div className="mt-3 space-y-2">
            {accounts.length ? accounts.map((account) => (
              <div key={account.id} className="rounded-2xl bg-gray-50 px-3 py-2 dark:bg-white/[0.04]">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">{account.name}</div>
                    <div className="text-xs text-gray-500">今日剩余 {remainingQuota(account)}/{account.dailyQuota}</div>
                  </div>
                  <button
                    type="button"
                    className="text-xs text-gray-400 hover:text-red-500"
                    onClick={() => saveAccountList(accounts.filter((item) => item.id !== account.id))}
                  >
                    移除
                  </button>
                </div>
              </div>
            )) : (
              <p className="text-sm text-gray-400">还没有账户。</p>
            )}
          </div>
          <div className="mt-4 space-y-2 border-t border-gray-100 pt-4 dark:border-white/[0.06]">
            <input
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              placeholder="账户名称，例如：豆包1"
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-white/[0.08] dark:bg-white/[0.03]"
            />
            <input
              value={draftSession}
              onChange={(event) => setDraftSession(event.target.value)}
              placeholder="火山方舟 API Key"
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-white/[0.08] dark:bg-white/[0.03]"
            />
            <label className="flex items-center justify-between gap-3 text-xs text-gray-500">
              每日免费次数
              <input
                type="number"
                min={1}
                value={draftQuota}
                onChange={(event) => setDraftQuota(Number(event.target.value))}
                className="w-20 rounded-xl border border-gray-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-400 dark:border-white/[0.08] dark:bg-white/[0.03]"
              />
            </label>
            <button
              type="button"
              onClick={addAccount}
              className="w-full rounded-xl bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
            >
              添加账户
            </button>
          </div>
          <label className="mt-4 block text-xs text-gray-500">
            视频接口地址
            <input
              value={baseUrl}
              onChange={(event) => {
                const next = event.target.value
                setBaseUrl(next)
                writeDoubaoSettings({ baseUrl: next })
              }}
              placeholder={DEFAULT_VIDEO_BASE_URL}
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-white/[0.08] dark:bg-white/[0.03]"
            />
          </label>
          <p className="mt-2 text-xs leading-5 text-gray-400">
            账户里填火山方舟 API Key。生成时把成图作为首帧，提示词用公共提示词及该镜头的动作和音频，任务完成后取视频地址。浏览器若被跨域拦住，把接口地址改成你的反代。
          </p>
          <label className="mt-4 block text-xs text-gray-500">
            每个镜头的公共提示词
            <textarea
              value={sharedPrompt}
              onChange={(event) => {
                const next = event.target.value
                setSharedPrompt(next)
                localStorage.setItem(VIDEO_SHARED_PROMPT_KEY, next)
              }}
              placeholder="例如：保持画面风格一致，不添加字幕或水印……"
              rows={7}
              className="mt-1 w-full resize-y rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm leading-5 outline-none focus:border-blue-400 dark:border-white/[0.08] dark:bg-white/[0.03]"
            />
          </label>
          <p className="mt-1 text-xs leading-5 text-gray-400">生成视频时会自动加到每个镜头的动作和音频提示词前。</p>
        </aside>

        <section className="min-w-0 flex-1 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">用成图、动作和音频生成视频</h2>
              <p className="mt-1 text-xs leading-5 text-gray-500">每个镜头用已经生成的图片，加上模板里的动作和音频。</p>
            </div>
          </div>
          {groups.length ? groups.map((group) => (
            <section key={group.name || group.tasks[0].id} className="rounded-3xl border border-gray-200 bg-gray-50/80 p-4 dark:border-white/[0.08] dark:bg-white/[0.03]">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="inline-flex rounded-full bg-gray-900 px-3 py-1 text-xs font-medium text-white dark:bg-white dark:text-gray-900">{group.name || '未命名'}</h3>
                <button
                  type="button"
                  onClick={() => void handleGenerate(group.tasks)}
                  disabled={Boolean(runningId)}
                  className="rounded-xl bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-gray-900"
                >
                  {runningId ? '生成中…' : '生成视频'}
                </button>
              </div>
              <div className="space-y-3">
                {group.tasks.map((task) => (
                  <article key={task.imageId} className="flex gap-3 rounded-2xl bg-white p-3 dark:bg-gray-950">
                    <div className="h-20 w-32 shrink-0 overflow-hidden rounded-xl">
                      <FrameThumb imageId={task.imageId} />
                    </div>
                    <div className="min-w-0 flex-1 text-xs leading-5 text-gray-600 dark:text-gray-300">
                      <div className="mb-1 text-sm font-medium text-gray-800 dark:text-gray-100">镜头{task.shotIndex || ''}</div>
                      <p className="whitespace-pre-wrap">动作：{task.action || '没有'}</p>
                      <p className="whitespace-pre-wrap">音频：{task.audio || '没有'}</p>
                      {runningId === task.imageId && <p className="mt-1 text-blue-500">正在用这张图生成视频</p>}
                      {videos[task.imageId] && <video src={videos[task.imageId]} controls className="mt-2 w-full rounded-xl bg-black" />}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )) : (
            <p className="rounded-2xl bg-gray-50 px-4 py-8 text-center text-sm text-gray-400 dark:bg-white/[0.04]">还没有生成好的图片。先在「生图」里出图。</p>
          )}
        </section>
      </div>
    </main>
  )
}
