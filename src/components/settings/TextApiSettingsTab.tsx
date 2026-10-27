import { useState } from 'react'
import type { AppSettings } from '../../types'
import { getActiveApiProfile } from '../../lib/apiProfiles'
import { fetchProviderModelIds } from '../../lib/modelList'
import Select from '../Select'

interface TextApiSettingsTabProps {
  draft: AppSettings
  commitSettings: (nextDraft: AppSettings) => void
}

const INPUT_CLASS = 'w-full rounded-xl border border-transparent bg-black/[0.04] px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:bg-white/[0.06] dark:text-gray-200 dark:focus:border-blue-500/50'

export default function TextApiSettingsTab({ draft, commitSettings }: TextApiSettingsTabProps) {
  const [baseUrl, setBaseUrl] = useState(draft.textApiBaseUrl)
  const [apiKey, setApiKey] = useState(draft.textApiKey)
  const [model, setModel] = useState(draft.textApiModel)
  const [timeoutText, setTimeoutText] = useState(draft.textApiTimeout > 0 ? String(draft.textApiTimeout) : '')
  const [showKey, setShowKey] = useState(false)
  const [fetchedModels, setFetchedModels] = useState<string[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)
  const [fetchModelsError, setFetchModelsError] = useState('')

  const active = getActiveApiProfile(draft)
  const effectiveBaseUrl = baseUrl.trim() || active.baseUrl
  const effectiveApiKey = apiKey.trim() || active.apiKey
  const effectiveModel = model.trim() || active.model
  const effectiveTimeout = Number(timeoutText) > 0 ? Math.trunc(Number(timeoutText)) : active.timeout

  const commit = (patch: Partial<AppSettings>) => commitSettings({ ...draft, ...patch })
  const commitTimeout = () => {
    const value = Math.trunc(Number(timeoutText))
    commit({ textApiTimeout: Number.isFinite(value) && value > 0 ? value : 0 })
  }

  const fetchModels = async () => {
    setFetchingModels(true)
    setFetchModelsError('')
    try {
      const ids = await fetchProviderModelIds({ baseUrl: effectiveBaseUrl, apiKey: effectiveApiKey, apiProxy: active.apiProxy })
      setFetchedModels(ids)
      if (!ids.length) setFetchModelsError('接口没有返回任何模型，请确认该服务商支持 /v1/models')
    } catch (err) {
      setFetchedModels([])
      setFetchModelsError(err instanceof Error ? err.message : String(err))
    } finally {
      setFetchingModels(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="block">
        <div className="mb-1 flex items-center justify-between gap-3">
          <span className="block text-sm text-gray-600 dark:text-gray-300">使用独立的生文配置</span>
          <button
            type="button"
            onClick={() => commit({ textApiEnabled: !draft.textApiEnabled })}
            className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${draft.textApiEnabled ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
            role="switch"
            aria-checked={draft.textApiEnabled}
            aria-label="使用独立的生文配置"
          >
            <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${draft.textApiEnabled ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
          </button>
        </div>
        <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
          生文配置负责所有文本能力：提示词 AI 检查、选题生成、Agent 的文本模型；生图配置负责图片生成。两者可以指向不同的服务商。
        </div>
      </div>

      {draft.textApiEnabled ? (
        <>
          <label className="block">
            <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">API URL</span>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              onBlur={() => commit({ textApiBaseUrl: baseUrl })}
              type="text"
              placeholder={active.baseUrl}
              className={INPUT_CLASS}
            />
            <div data-selectable-text className="mt-1.5 text-xs text-gray-500 dark:text-gray-500">
              留空沿用生图配置的地址；生文接口需兼容 <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">/v1/responses</code>。
            </div>
          </label>

          <label className="block">
            <span className="mb-1.5 flex items-center justify-between text-sm text-gray-600 dark:text-gray-300">
              API Key
              <button
                type="button"
                onClick={() => setShowKey((prev) => !prev)}
                className="text-xs text-gray-400 transition hover:text-gray-600 dark:hover:text-gray-200"
              >
                {showKey ? '隐藏' : '显示'}
              </button>
            </span>
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onBlur={() => commit({ textApiKey: apiKey })}
              type={showKey ? 'text' : 'password'}
              autoComplete="off"
              placeholder={active.apiKey ? '留空沿用生图配置的 Key' : '填写生文接口的 API Key'}
              className={INPUT_CLASS}
            />
            <div data-selectable-text className="mt-1.5 text-xs text-gray-500 dark:text-gray-500">
              留空沿用生图配置的 API Key。
            </div>
          </label>

          <div className="block">
            <label className="block">
              <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">文本模型</span>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                onBlur={() => commit({ textApiModel: model })}
                type="text"
                placeholder={active.model}
                className={INPUT_CLASS}
              />
            </label>
            <div className="mt-1.5 flex items-start justify-between gap-3">
              <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
                填写该服务商的文本模型 ID，例如 <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">gpt-5</code>。留空沿用生图配置的模型。
              </div>
              <button
                type="button"
                onClick={fetchModels}
                disabled={fetchingModels}
                className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-blue-600 transition hover:bg-blue-500/10 disabled:cursor-not-allowed disabled:opacity-50 dark:text-blue-400 dark:hover:bg-blue-500/15"
              >
                {fetchingModels && <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />}
                {fetchingModels ? '拉取中' : '拉取模型'}
              </button>
            </div>
            {fetchModelsError && (
              <div data-selectable-text className="mt-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-500 dark:bg-red-500/10 dark:text-red-300">
                {fetchModelsError}
              </div>
            )}
            {fetchedModels.length > 0 && (
              <div className="mt-2 space-y-1">
                <div className="text-xs text-gray-400 dark:text-gray-500">接口返回 {fetchedModels.length} 个模型，点开选择即可填入</div>
                <Select
                  value={model.trim()}
                  onChange={(value) => {
                    const next = String(value)
                    setModel(next)
                    commit({ textApiModel: next })
                  }}
                  options={[
                    { label: '留空沿用生图配置的模型', value: '' },
                    ...fetchedModels.map((id) => ({ label: id, value: id })),
                  ]}
                  className="rounded-xl border border-transparent bg-black/[0.04] px-3 py-2.5 text-sm text-gray-700 transition hover:bg-black/[0.06] dark:bg-white/[0.06] dark:text-gray-200 dark:hover:bg-white/[0.09]"
                />
              </div>
            )}
          </div>

          <label className="block">
            <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">请求超时（秒）</span>
            <input
              value={timeoutText}
              onChange={(e) => setTimeoutText(e.target.value.replace(/[^0-9]/g, ''))}
              onBlur={commitTimeout}
              type="text"
              inputMode="numeric"
              placeholder={String(active.timeout)}
              className={INPUT_CLASS}
            />
            <div data-selectable-text className="mt-1.5 text-xs text-gray-500 dark:text-gray-500">
              留空沿用生图配置的超时时间。
            </div>
          </label>
        </>
      ) : (
        <div data-selectable-text className="rounded-xl bg-black/[0.03] px-3 py-2.5 text-xs leading-5 text-gray-500 dark:bg-white/[0.04] dark:text-gray-400">
          当前文本能力直接使用生图配置，未单独启用生文接口。开启后可以给文本模型单独填一套地址、Key 和模型。
        </div>
      )}

      <div className="rounded-xl border border-gray-200/80 px-3 py-2.5 dark:border-white/[0.08]">
        <div className="text-xs font-medium text-gray-600 dark:text-gray-300">当前生效</div>
        <div data-selectable-text className="mt-1 space-y-0.5 text-xs text-gray-500 dark:text-gray-400">
          <div>接口地址：<span className="break-all">{effectiveBaseUrl}</span></div>
          <div>文本模型：<span className="break-all">{effectiveModel}</span></div>
          <div>超时：{effectiveTimeout} 秒</div>
        </div>
      </div>
    </div>
  )
}
