import { listBuiltWorkspaceIds } from './project-builder.mjs'
import { readWorkspaceData } from './records.mjs'
import { executeManagedAutomation, readAutomationWorkspace, writeAutomationWorkspace } from './automations.mjs'
import { workflowGraphFor } from './workflowGraph.mjs'

const weekdays = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }

function localParts(now, timezone) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour), minute: Number(values.minute), weekday: weekdays[values.weekday],
  }
}

function weekKey(date) {
  const value = new Date(`${date}T00:00:00Z`)
  const day = value.getUTCDay() || 7
  value.setUTCDate(value.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((value - yearStart) / 86_400_000) + 1) / 7)
  return `${value.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export function scheduledSlotFor(trigger, now = new Date()) {
  if (trigger?.event !== 'scheduled' || !trigger.schedule) return null
  const schedule = trigger.schedule
  const local = localParts(now, schedule.timezone || 'UTC')
  const [targetHour, targetMinute] = schedule.time.split(':').map(Number)
  const currentMinutes = local.hour * 60 + local.minute
  const targetMinutes = targetHour * 60 + targetMinute

  if (schedule.cadence === 'hourly') {
    if (local.minute < targetMinute) return null
    return { key: `${local.date}T${String(local.hour).padStart(2, '0')}`, scheduledFor: `${local.date} ${String(local.hour).padStart(2, '0')}:${String(targetMinute).padStart(2, '0')} ${schedule.timezone}` }
  }
  if (currentMinutes < targetMinutes) return null
  if (schedule.cadence === 'daily') return { key: local.date, scheduledFor: `${local.date} ${schedule.time} ${schedule.timezone}` }
  if (schedule.cadence === 'weekly' && local.weekday === Number(schedule.weekday ?? 1)) return { key: weekKey(local.date), scheduledFor: `${local.date} ${schedule.time} ${schedule.timezone}` }
  return null
}

export async function runDueScheduledWorkspace(workspaceId, now = new Date()) {
  const initial = await readAutomationWorkspace(workspaceId)
  const completedSlots = new Set(initial.schedules.map(item => item.key))
  const results = []

  for (const automation of initial.automations.filter(item => item.enabled)) {
    const graph = workflowGraphFor(automation)
    for (const trigger of graph.nodes.filter(node => node.type === 'trigger' && node.config.event === 'scheduled')) {
      const slot = scheduledSlotFor(trigger.config, now)
      if (!slot) continue
      const key = `${automation.id}:${trigger.id}:${slot.key}`
      if (completedSlots.has(key)) { results.push({ key, automationId: automation.id, status: 'already-run', records: 0 }); continue }

      const startedAt = new Date().toISOString()
      const data = await readWorkspaceData(workspaceId)
      const records = data[trigger.config.entityId] ?? []
      let failed = 0
      for (const record of records) {
        const run = await executeManagedAutomation(workspaceId, automation, 'scheduled', trigger.config.entityId, {
          ...record, eventId: `schedule:${key}:${record.id}`,
        }, false, { graph, triggerNodeId: trigger.id })
        if (run.status === 'failed') failed += 1
      }

      const scheduleRun = {
        key, automationId: automation.id, automationName: automation.name, triggerNodeId: trigger.id,
        entityId: trigger.config.entityId, slot: slot.key, scheduledFor: slot.scheduledFor,
        records: records.length, failed, status: failed ? (failed === records.length ? 'failed' : 'partial') : 'success',
        startedAt, finishedAt: new Date().toISOString(),
      }
      const latest = await readAutomationWorkspace(workspaceId)
      await writeAutomationWorkspace(workspaceId, { ...latest, schedules: [...latest.schedules.slice(-499), scheduleRun] })
      completedSlots.add(key)
      results.push(scheduleRun)
    }
  }
  return results
}

let scanning = false
export async function runDueScheduledAutomations(now = new Date()) {
  if (scanning) return []
  scanning = true
  try {
    const workspaceIds = await listBuiltWorkspaceIds()
    const results = []
    for (const workspaceId of workspaceIds) {
      try { results.push(...await runDueScheduledWorkspace(workspaceId, now)) }
      catch (error) { console.warn(`Scheduled automations failed for ${workspaceId}: ${error?.message ?? error}`) }
    }
    return results
  } finally { scanning = false }
}

export function startAutomationScheduler() {
  const scan = () => void runDueScheduledAutomations().catch(error => console.warn(`Automation scheduler failed: ${error?.message ?? error}`))
  const first = setTimeout(scan, 5_000)
  const interval = setInterval(scan, 60_000)
  first.unref?.(); interval.unref?.()
  return () => { clearTimeout(first); clearInterval(interval) }
}
