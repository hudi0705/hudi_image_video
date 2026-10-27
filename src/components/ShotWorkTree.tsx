import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { groupTasksByProject } from '../lib/shotProjectExport'
import { buildWorkTree } from '../lib/workTree'
import { loadVideoTasks, useVideoTaskStore } from '../lib/videoTaskStore'
import WorkTreePanel from './WorkTreePanel'

/** 生图页右栏：只统计带镜头编号的任务，普通单图生成不参与工作树 */
export default function ShotWorkTree() {
  const tasks = useStore((s) => s.tasks)
  const records = useVideoTaskStore((s) => s.records)
  const [project, setProject] = useState('')

  useEffect(() => {
    loadVideoTasks()
  }, [])

  const groups = useMemo(() => groupTasksByProject(
    tasks.filter((task) => Boolean(task.shotIndex) && task.outputImages.length > 0).sort((a, b) => b.createdAt - a.createdAt),
  ), [tasks])
  const projects = useMemo(
    () => groups.map((group) => ({ id: group.name || group.tasks[0].id, name: group.name?.trim() || '未命名项目' })),
    [groups],
  )
  const shots = useMemo(() => {
    const focused = groups.find((group) => (group.name || group.tasks[0].id) === project)
    return focused ? focused.tasks : groups.flatMap((group) => group.tasks)
  }, [groups, project])
  const lanes = useMemo(() => buildWorkTree(shots, records), [shots, records])

  return (
    <WorkTreePanel
      lanes={lanes}
      projects={projects}
      project={project}
      onProject={setProject}
      shotCount={shots.length}
      running={Object.values(records).some((record) => record.tracking)}
    />
  )
}
