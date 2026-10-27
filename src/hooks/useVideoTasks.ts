import { useEffect } from 'react'
import { loadVideoTasks, useVideoTaskStore } from '../lib/videoTaskStore'
import { recoverVideoTasks } from '../lib/videoGeneration'

export function useVideoTasks() {
  useEffect(() => {
    loadVideoTasks()
    const recover = () => { void recoverVideoTasks().catch((err) => console.error('视频任务恢复失败', err)) }
    recover()
    const timer = window.setInterval(recover, 5000)
    window.addEventListener('focus', recover)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', recover)
    }
  }, [])
  return useVideoTaskStore()
}
