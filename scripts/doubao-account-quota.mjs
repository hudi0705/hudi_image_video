export function quotaDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function refreshAccountQuota(item, today = quotaDate()) {
  if (item.quotaDate !== today) item.usedToday = 0
  item.quotaDate = today
  item.dailyQuota = Math.max(1, Math.floor(Number(item.dailyQuota) || 5))
  item.usedToday = Math.max(0, Math.floor(Number(item.usedToday) || 0))
  return item
}
