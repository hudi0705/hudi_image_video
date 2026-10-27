import { useEffect, useRef } from 'react'

export default function VideoProjectTitle({ name, disabled, onDelete }: {
  name: string | null
  disabled: boolean
  onDelete: () => void
}) {
  const timer = useRef<number | null>(null)
  const press = useRef<{ id: number; x: number; y: number } | null>(null)

  function clearPress() {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    press.current = null
  }

  useEffect(() => {
    if (disabled) clearPress()
    return clearPress
  }, [disabled])

  return (
    <h3 className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
      <button
        type="button"
        disabled={disabled}
        aria-label={`长按删除项目「${name || '未命名项目'}」`}
        title="长按删除项目"
        className="block w-full cursor-pointer select-none truncate text-left touch-pan-y [-webkit-touch-callout:none] disabled:cursor-not-allowed"
        onPointerDown={(event) => {
          clearPress()
          if (disabled || event.button !== 0 || !event.isPrimary) return
          press.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
          timer.current = window.setTimeout(() => {
            clearPress()
            onDelete()
          }, 500)
        }}
        onPointerMove={(event) => {
          const start = press.current
          if (!start || start.id !== event.pointerId) return
          if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) clearPress()
        }}
        onPointerUp={clearPress}
        onPointerCancel={clearPress}
        onPointerLeave={clearPress}
        onContextMenu={(event) => event.preventDefault()}
        onClick={(event) => {
          // 键盘和辅助技术可直接打开确认框，普通点击仍不触发删除。
          if (event.detail === 0) onDelete()
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Delete') return
          event.preventDefault()
          onDelete()
        }}
      >
        {name || '未命名项目'}
      </button>
    </h3>
  )
}
