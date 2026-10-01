export async function runVideoBatch<T>(
  items: T[],
  run: (item: T) => Promise<string>,
  onPaused: (remaining: T[]) => void,
) {
  const counts = { done: 0, pending: 0, failed: 0, paused: 0 }
  const paused: T[] = []
  await Promise.all(items.map(async item => {
    let status: string
    try { status = await run(item) } catch { status = 'failed' }
    if (status === 'completed') counts.done++
    else if (status === 'paused') { counts.paused++; paused.push(item) }
    else if (status === 'failed') counts.failed++
    else counts.pending++
  }))
  if (paused.length) onPaused(paused)
  return counts
}
