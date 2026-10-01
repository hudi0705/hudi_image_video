export interface ShotFolder {
  index: number
  files: File[]
}

const IMAGE_MIMES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif',
}

export function getShotImageMime(file: File) {
  return IMAGE_MIMES[file.name.split('.').pop()?.toLowerCase() || ''] || ''
}

export function parseShotProjectFolder(files: File[]) {
  const shots = new Map<number, ShotFolder>()
  let projectName = ''
  let ignoredImages = 0
  for (const file of files) {
    const parts = file.webkitRelativePath.split('/')
    if (parts.length < 2) continue
    projectName ||= parts[0]
    if (parts.some((part) => part.startsWith('.') || part === '__MACOSX')) continue
    if (!getShotImageMime(file)) continue
    const match = parts.length >= 3 ? /^镜头\s*[-_]?\s*(\d+)$/u.exec(parts[1]) : null
    const index = Number(match?.[1])
    if (!Number.isSafeInteger(index) || index < 1) {
      ignoredImages += 1
      continue
    }
    const shot = shots.get(index) || { index, files: [] }
    shot.files.push(file)
    shots.set(index, shot)
  }
  const sortedShots = [...shots.values()].sort((a, b) => a.index - b.index)
  for (const shot of sortedShots) {
    shot.files.sort((a, b) => a.webkitRelativePath.localeCompare(b.webkitRelativePath, 'zh-CN', { numeric: true }))
  }
  return { projectName, shots: sortedShots, ignoredImages }
}
