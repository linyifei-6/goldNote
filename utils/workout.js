function safeNumber(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function summarizeSessions(sessions) {
  const list = Array.isArray(sessions) ? sessions : []
  let totalMinutes = 0
  let totalCalories = 0
  const typeCounter = {}

  list.forEach((item) => {
    const duration = Math.max(0, safeNumber(item.durationMin))
    const calories = Math.max(0, safeNumber(item.calories))
    const type = String(item.type || '未分类').trim() || '未分类'

    totalMinutes += duration
    totalCalories += calories
    typeCounter[type] = (typeCounter[type] || 0) + 1
  })

  const topTypes = Object.keys(typeCounter)
    .map((key) => ({ type: key, count: typeCounter[key] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)

  return {
    count: list.length,
    totalMinutes,
    totalCalories,
    topTypes
  }
}

function summarizeWeights(records) {
  const list = (Array.isArray(records) ? records : [])
    .filter((item) => Number(item.weight) > 0)
    .sort((a, b) => String(a.recordDate || '').localeCompare(String(b.recordDate || '')))

  if (!list.length) {
    return {
      count: 0,
      latestWeight: 0,
      delta: 0
    }
  }

  const first = Number(list[0].weight) || 0
  const last = Number(list[list.length - 1].weight) || 0

  return {
    count: list.length,
    latestWeight: last,
    delta: Number((last - first).toFixed(2))
  }
}

function calculateWeeklyCompletion(sessions, plan) {
  const targetDays = Math.max(0, parseInt((plan && plan.weeklyTargetDays) || 0, 10) || 0)
  const weekStartDate = String((plan && plan.weekStartDate) || '').trim()
  if (!targetDays) {
    return {
      targetDays: 0,
      actualDays: 0,
      completionRate: 0
    }
  }

  function addDays(dateText, days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
      return ''
    }
    const date = new Date(`${dateText}T00:00:00Z`)
    if (Number.isNaN(date.getTime())) {
      return ''
    }
    date.setUTCDate(date.getUTCDate() + days)
    const year = date.getUTCFullYear()
    const month = String(date.getUTCMonth() + 1).padStart(2, '0')
    const day = String(date.getUTCDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  const weekEndDate = weekStartDate ? addDays(weekStartDate, 6) : ''

  const daySet = new Set()
  ;(Array.isArray(sessions) ? sessions : []).forEach((item) => {
    const day = String(item.workoutDate || '').trim()
    if (!day) {
      return
    }
    if (weekStartDate && weekEndDate && (day < weekStartDate || day > weekEndDate)) {
      return
    }
    if (day) {
      daySet.add(day)
    }
  })

  const actualDays = daySet.size
  const completionRate = Math.min(100, Number(((actualDays / targetDays) * 100).toFixed(1)))

  return {
    targetDays,
    actualDays,
    completionRate
  }
}

module.exports = {
  summarizeSessions,
  summarizeWeights,
  calculateWeeklyCompletion
}
