import { useSyncExternalStore } from 'react'

export type WorkMode = 'image' | 'video'

const KEY = 'gpt-image-work-mode'
const listeners = new Set<() => void>()
let mode: WorkMode = readStoredWorkMode()

function readStoredWorkMode(): WorkMode {
  try {
    return localStorage.getItem(KEY) === 'video' ? 'video' : 'image'
  } catch {
    return 'image'
  }
}

function emit() {
  for (const listener of listeners) listener()
}

export function getWorkMode() {
  return mode
}

export function setWorkMode(next: WorkMode) {
  mode = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // The tab still switches for this page load when storage is blocked.
  }
  emit()
}

export function useWorkMode() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getWorkMode,
  )
}
