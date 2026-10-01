export class AccountQueue {
  states = new Map()

  run(accountId, operation) {
    let state = this.states.get(accountId)
    if (!state) {
      state = { active: 0, sending: false, jobs: [] }
      this.states.set(accountId, state)
    }
    return new Promise((resolve, reject) => {
      state.jobs.push({ operation, resolve, reject })
      this.pump(accountId, state)
    })
  }

  pump(accountId, state) {
    if (state.sending || !state.jobs.length) return
    const job = state.jobs.shift()
    state.active++
    state.sending = true
    let released = false
    const generationStarted = () => {
      if (released) return
      released = true
      state.sending = false
      this.pump(accountId, state)
    }
    void Promise.resolve().then(() => job.operation(generationStarted)).then(job.resolve, job.reject).finally(() => {
      state.active--
      generationStarted()
      if (!state.active && !state.jobs.length) this.states.delete(accountId)
      else this.pump(accountId, state)
    })
  }
}
