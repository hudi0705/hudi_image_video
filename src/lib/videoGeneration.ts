import { ensureImageCached } from './imageCache'
import { DEFAULT_LOCAL_DOUBAO_URL, DEFAULT_VIDEO_MODEL, generateWithAccountRotation, getSeedanceVideoTask, readLocalVideoProgress, type LocalVideoProgress } from './doubaoVideo'
import { consumeQuota, readAccounts, writeAccounts, type VideoRatio } from './doubaoAccounts'
import { prepareVideoSave, saveVideoBesideImage, type VideoSource } from './videoFileSave'
import { updateVideoTask, useVideoTaskStore } from './videoTaskStore'

const inFlight = new Set<string>()
const saving = new Set<string>()
const polling = new Set<string>()

function progressText(progress: LocalVideoProgress) {
  if (progress.status === 'queued') return '尚未发送，等待该账号前序镜头开始生成'
  if (progress.status === 'confirming') return '已识别参数确认，正在自动回复并等待豆包受理…'
  if (progress.status === 'failed') return progress.failureReason ? `豆包未生成：${progress.failureReason}` : progress.responseText || '任务失败，请查看豆包窗口'
  if (progress.status === 'needs_attention') return '等待你在豆包窗口确认，请查看原窗口'
  if (progress.status === 'waiting') return '消息已保存，等待豆包明确开始生成…'
  if (progress.status === 'generating') return progress.tracking === false ? '豆包已开始生成，自动跟踪已结束，请查看原窗口结果' : '豆包已受理，正在生成视频…'
  if (progress.status === 'interrupted') return '本地服务已重启，任务跟踪中断，请查看原对话；未重新提交'
  if (progress.status === 'paused') return '批次已暂停，本镜头尚未发送，可重试'
  if (progress.status === 'unconfirmed') return '尚未确认生成完成，请查看豆包窗口'
  if (progress.status === 'completed') return '视频已生成，等待保存到原图片文件夹'
  return '正在上传图片并发送消息…'
}

function applyProgress(id: string, progress: LocalVideoProgress, tracking: boolean) {
  const record = useVideoTaskStore.getState().records[id]
  if (!record) return
  updateVideoTask(id, {
    status: progress.status || record.status,
    statusText: progressText(progress),
    responseText: progress.responseText || record.responseText,
    failureReason: progress.failureReason,
    requestText: progress.requestText || record.requestText,
    taskUrl: progress.taskUrl || record.taskUrl,
    url: progress.url || record.url,
    downloadUrl: progress.downloadUrl || (progress.url && record.windowId ? `${DEFAULT_LOCAL_DOUBAO_URL}/task-window/video?windowId=${encodeURIComponent(record.windowId)}` : record.downloadUrl),
    tracking,
    retryable: !tracking && progress.status !== 'completed',
    uncertain: !tracking && !progress.failureReason && !['completed', 'paused'].includes(progress.status || ''),
  })
}

export async function saveVideoTask(id: string, source?: VideoSource) {
  const record = useVideoTaskStore.getState().records[id]
  if (!record?.url || saving.has(id)) return
  saving.add(id)
  try {
    updateVideoTask(id, { saveState: 'saving', statusText: '视频已生成，正在保存到原图片文件夹…' })
    source ||= await prepareVideoSave(id, record.imageId)
    if (!source) throw new Error('请先关联原图片文件夹，再点击保存视频')
    const savedPath = await saveVideoBesideImage(source, record.downloadUrl || record.url, record.shotIndex)
    if (useVideoTaskStore.getState().records[id] !== undefined) {
      updateVideoTask(id, { saveState: 'saved', savedPath, statusText: `已保存：${savedPath}` })
    }
  } catch (err) {
    console.warn('视频保存失败', err)
    if (useVideoTaskStore.getState().records[id] !== undefined) {
      updateVideoTask(id, { saveState: 'failed', statusText: `视频已生成，未保存：${err instanceof Error ? err.message : '保存失败'}` })
    }
  } finally {
    saving.delete(id)
  }
}

export async function generateVideoTask(options: {
  id: string
  imageId: string
  shotIndex?: number
  shotDuration?: number
  prompt: string
  accountId: string
  baseUrl: string
  ratio: VideoRatio
}) {
  if (inFlight.has(options.id) || useVideoTaskStore.getState().records[options.id]?.tracking) return 'pending'
  inFlight.add(options.id)
  try {
    updateVideoTask(options.id, {
      imageId: options.imageId, shotIndex: options.shotIndex, accountId: options.accountId,
      windowId: undefined, apiTaskId: undefined, baseUrl: options.baseUrl, status: 'sending', statusText: '正在上传图片并发送消息…',
      requestText: options.prompt, responseText: '', failureReason: undefined, taskUrl: '', url: '', downloadUrl: '',
      tracking: true, retryable: false, uncertain: false, saveState: 'pending', savedPath: undefined,
    })
    const dataUrl = await ensureImageCached(options.imageId)
    if (!dataUrl) throw new Error('找不到生成好的图片')
    const source = await prepareVideoSave(options.id, options.imageId).catch(() => undefined)
    const result = await generateWithAccountRotation({
      accountId: options.accountId, baseUrl: options.baseUrl, prompt: options.prompt, imageDataUrl: dataUrl,
      duration: options.shotDuration, ratio: options.ratio, model: DEFAULT_VIDEO_MODEL,
      onAccountSelected: (accountId) => updateVideoTask(options.id, { accountId }),
      onTaskWindow: (windowId) => updateVideoTask(options.id, { windowId, taskUrl: '' }),
      onApiTaskCreated: (apiTaskId) => updateVideoTask(options.id, { apiTaskId, windowId: undefined }),
      onProgress: (progress) => {
        // 长请求仍在运行时，以最终响应为完成依据。
        if (progress.status !== 'completed') applyProgress(options.id, progress, true)
      },
    })
    applyProgress(options.id, { ...result, tracking: false }, false)
    if (result.status !== 'completed') return result.status
    await saveVideoTask(options.id, source)
    return 'completed'
  } catch (err) {
    console.warn('视频生成失败', err)
    const code = err instanceof Error && 'code' in err ? String(err.code) : ''
    const status = code === 'DOUBAO_BATCH_PAUSED' ? 'paused' : 'failed'
    updateVideoTask(options.id, {
      status, statusText: err instanceof Error ? err.message : '任务失败，请查看豆包窗口',
      tracking: false, retryable: true,
      uncertain: !['DOUBAO_SUBMIT_FAILED', 'DOUBAO_NO_ACCOUNTS', 'DOUBAO_BATCH_PAUSED'].includes(code),
    })
    return status
  } finally {
    inFlight.delete(options.id)
  }
}

export async function recoverVideoTasks() {
  const records = Object.values(useVideoTaskStore.getState().records)
  await Promise.all(records.map(async (record) => {
    if ((!record.windowId && !record.apiTaskId) || record.status === 'completed' || (record.status === 'failed' && record.failureReason) || inFlight.has(record.id) || polling.has(record.id)) return
    polling.add(record.id)
    try {
      let progress: LocalVideoProgress
      if (record.apiTaskId) {
        const account = readAccounts().find((item) => item.id === record.accountId)
        if (!account || !record.baseUrl) throw new Error('请恢复原视频接口和账号配置后继续查询')
        progress = await getSeedanceVideoTask(record.baseUrl, account, record.apiTaskId)
      } else {
        const response = await fetch(`${DEFAULT_LOCAL_DOUBAO_URL}/task-window/status?windowId=${encodeURIComponent(record.windowId!)}`, { signal: AbortSignal.timeout(20000) })
        if (!response.ok) throw new Error(response.status === 404 ? '本地服务未找到原任务，请先检查豆包历史记录' : `任务查询失败：HTTP ${response.status}`)
        progress = readLocalVideoProgress(await response.json())
      }
      // 查询期间用户可能已经重试或删除任务，旧响应不能覆盖新任务。
      const latest = useVideoTaskStore.getState().records[record.id]
      if (!latest || latest.windowId !== record.windowId || latest.apiTaskId !== record.apiTaskId || inFlight.has(record.id)) return
      const tracking = progress.tracking ?? !['completed', 'failed', 'paused', 'interrupted', 'unconfirmed'].includes(progress.status || '')
      applyProgress(record.id, progress, tracking)
      if (progress.status === 'completed' && progress.url) {
        if (record.accountId) writeAccounts(consumeQuota(readAccounts(), record.accountId))
        await saveVideoTask(record.id)
      }
    } catch (err) {
      console.warn('视频任务恢复查询失败', err)
      const latest = useVideoTaskStore.getState().records[record.id]
      if (!latest || latest.windowId !== record.windowId || latest.apiTaskId !== record.apiTaskId || inFlight.has(record.id)) return
      updateVideoTask(record.id, {
        tracking: false, retryable: true, uncertain: true,
        statusText: `${err instanceof Error ? err.message : '无法连接豆包本地服务'}；保留原任务，将继续查询`,
      })
    } finally {
      polling.delete(record.id)
    }
  }))
}
