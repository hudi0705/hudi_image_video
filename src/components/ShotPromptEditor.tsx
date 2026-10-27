import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TaskRecord } from '../types'
import { updateShotImagePrompt, useStore } from '../store'
import { getShotImagePromptParts, parseShotTemplate } from '../lib/shotTemplate'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { CloseIcon } from './icons'

export default function ShotPromptEditor() {
  const task = useStore((s) => s.tasks.find((item) => item.id === s.shotEditTaskId))
  if (!task) return null
  return <ShotPromptEditorForm key={task.id} task={task} />
}

function ShotPromptEditorForm({ task }: { task: TaskRecord }) {
  const onClose = useStore((s) => s.setShotEditTaskId)
  const showToast = useStore((s) => s.showToast)
  const modalRef = useRef<HTMLDivElement>(null)
  const [initial] = useState(() => {
    const shots = parseShotTemplate(localStorage.getItem('gpt-image-shot-template') || '')
    const shot = shots.find((item) => item.index === task.shotIndex)
    return getShotImagePromptParts(task, localStorage.getItem('gpt-image-shot-shared-prompt') || '', shot?.shot)
  })
  const [sharedPrompt, setSharedPrompt] = useState(initial.sharedPrompt)
  const [shotPrompt, setShotPrompt] = useState(initial.shotPrompt)
  const [saving, setSaving] = useState(false)
  const busy = task.status === 'running' || task.falRecoverable || task.customRecoverable

  useCloseOnEscape(!saving, () => onClose(null))
  usePreventBackgroundScroll(true, modalRef)

  async function handleSave() {
    if (saving || busy || !shotPrompt.trim()) return
    setSaving(true)
    try {
      await updateShotImagePrompt(task.id, sharedPrompt, shotPrompt)
      showToast('当前镜头提示词已保存，重试时将使用新内容', 'success')
      onClose(null)
    } catch (err) {
      console.error('保存镜头提示词失败', err)
      showToast(err instanceof Error ? err.message : '保存镜头提示词失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  const inputClass = 'mt-2 w-full resize-y rounded-2xl border border-gray-200 bg-white px-3 py-2 text-sm leading-6 text-gray-800 outline-none transition focus:border-blue-400 disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100'

  return createPortal(
    <div data-no-drag-select className="fixed inset-0 z-[65] flex items-center justify-center p-4" onClick={() => { if (!saving) onClose(null) }}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in" />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shot-prompt-editor-title"
        className="relative z-10 flex max-h-[88vh] w-full max-w-2xl flex-col rounded-3xl border border-white/50 bg-white/95 p-5 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 id="shot-prompt-editor-title" className="text-base font-semibold text-gray-800 dark:text-gray-100">编辑镜头{task.shotIndex}</h3>
            <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">仅修改当前镜头，保存后重试将使用新的通用提示词和镜头语言。</p>
          </div>
          <button type="button" aria-label="关闭镜头编辑" disabled={saving} onClick={() => onClose(null)} className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 dark:hover:bg-white/[0.06] disabled:opacity-40">
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain pr-1 custom-scrollbar">
          {initial.legacy && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">旧记录未单独保存两段提示词，已将原文完整保留在镜头语言中，可自行拆分调整。</p>
          )}
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
            通用提示词
            <textarea value={sharedPrompt} onChange={(event) => setSharedPrompt(event.target.value)} disabled={saving} rows={4} placeholder="填写当前镜头使用的风格、构图和画面要求" className={inputClass} />
          </label>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
            镜头语言
            <textarea value={shotPrompt} onChange={(event) => setShotPrompt(event.target.value)} disabled={saving} rows={7} placeholder="填写当前镜头的主体、场景、景别和构图" className={inputClass} />
          </label>
        </div>
        {busy && <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">当前镜头正在生成或恢复连接，结束后即可保存。</p>}
        <div className="mt-4 flex justify-end gap-2 border-t border-gray-100 pt-4 dark:border-white/[0.06]">
          <button type="button" disabled={saving} onClick={() => onClose(null)} className="rounded-xl px-4 py-2 text-sm text-gray-500 transition hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.06] disabled:opacity-40">取消</button>
          <button type="button" disabled={saving || busy || !shotPrompt.trim()} onClick={() => void handleSave()} className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200">{saving ? '保存中…' : '保存修改'}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
