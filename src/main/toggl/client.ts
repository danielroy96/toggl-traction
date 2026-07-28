import type {
  TimeEntry,
  TogglProject,
  TogglTask,
  TogglUser,
  StartTimerInput
} from '../../shared/types.js'

const API_BASE = 'https://api.track.toggl.com/api/v9'

export class TogglError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'TogglError'
  }
}

/**
 * Thin wrapper over the Toggl Track v9 REST API.
 *
 * Auth uses HTTP Basic with `{apiToken}:api_token` (Toggl's documented scheme
 * for personal API tokens). An OAuth flow can be layered on later by swapping
 * the Authorization header; nothing else in the app assumes token auth.
 */
export class TogglClient {
  private authHeader: string

  constructor(private apiToken: string) {
    this.authHeader = 'Basic ' + Buffer.from(`${apiToken}:api_token`).toString('base64')
  }

  private async request<T>(
    path: string,
    init: RequestInit & { timeoutMs?: number } = {}
  ): Promise<T> {
    const { timeoutMs = 15000, ...rest } = init
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        ...rest,
        signal: controller.signal,
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/json',
          ...(rest.headers ?? {})
        }
      })

      if (res.status === 401 || res.status === 403) {
        throw new TogglError('Your API token was rejected. Please sign in again.', res.status)
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new TogglError(
          `Toggl request failed (${res.status})${body ? `: ${body.slice(0, 200)}` : ''}`,
          res.status
        )
      }
      if (res.status === 204) return undefined as T
      const text = await res.text()
      return (text ? JSON.parse(text) : undefined) as T
    } catch (err) {
      if (err instanceof TogglError) throw err
      if (err instanceof Error && err.name === 'AbortError') {
        throw new TogglError('The request to Toggl timed out. Check your connection.')
      }
      throw new TogglError(
        err instanceof Error ? err.message : 'Unexpected error talking to Toggl.'
      )
    } finally {
      clearTimeout(timer)
    }
  }

  /** Fetch the authenticated user (also validates the token). */
  getMe(): Promise<TogglUser & { workspaces?: { id: number; name: string }[] }> {
    return this.request('/me?with_related_data=true')
  }

  getCurrentEntry(): Promise<TimeEntry | null> {
    return this.request<TimeEntry | null>('/me/time_entries/current')
  }

  getProjects(workspaceId: number): Promise<TogglProject[]> {
    return this.request(`/workspaces/${workspaceId}/projects?active=true`)
  }

  /**
   * Fetch all active tasks in the workspace, grouped later by project_id.
   *
   * The v9 workspace tasks endpoint returns a *paginated envelope*
   * (`{ total_count, page, per_page, data: [...] }`), unlike the projects
   * endpoint which returns a bare array — so we unwrap `data` and page through
   * until every task is collected. (We also tolerate a bare-array response for
   * forward-compatibility.)
   *
   * Tasks are a paid Toggl feature; on plans without it the endpoint returns
   * 402/403/404, which we treat as "no tasks" so the app degrades to
   * projects-only rather than erroring.
   */
  async getTasks(workspaceId: number): Promise<TogglTask[]> {
    interface TasksPage {
      total_count?: number
      data?: TogglTask[] | null
    }
    try {
      const all: TogglTask[] = []
      let page = 1
      for (;;) {
        const res = await this.request<TasksPage | TogglTask[] | null>(
          `/workspaces/${workspaceId}/tasks?active=true&page=${page}&per_page=200`
        )
        if (!res) break
        if (Array.isArray(res)) {
          all.push(...res)
          break
        }
        const pageTasks = res.data ?? []
        all.push(...pageTasks)
        const total = res.total_count ?? all.length
        if (pageTasks.length === 0 || all.length >= total) break
        page++
      }
      return all
    } catch (err) {
      if (
        err instanceof TogglError &&
        (err.status === 402 || err.status === 403 || err.status === 404)
      ) {
        return []
      }
      throw err
    }
  }

  getRecentEntries(): Promise<TimeEntry[]> {
    return this.request('/me/time_entries')
  }

  async startTimer(input: StartTimerInput & { workspaceId: number }): Promise<TimeEntry> {
    const nowIso = new Date().toISOString()
    return this.request(`/workspaces/${input.workspaceId}/time_entries`, {
      method: 'POST',
      body: JSON.stringify({
        created_with: 'Toggl Traction',
        description: input.description,
        project_id: input.projectId ?? null,
        task_id: input.taskId ?? null,
        tags: input.tags ?? [],
        billable: input.billable ?? false,
        workspace_id: input.workspaceId,
        start: nowIso,
        // Negative duration marks the entry as currently running per the v9 API.
        duration: -1
      })
    })
  }

  async stopTimer(workspaceId: number, entryId: number): Promise<TimeEntry> {
    return this.request(`/workspaces/${workspaceId}/time_entries/${entryId}/stop`, {
      method: 'PATCH'
    })
  }

  async updateEntry(
    workspaceId: number,
    entryId: number,
    patch: Partial<
      Pick<
        TimeEntry,
        | 'description'
        | 'project_id'
        | 'task_id'
        | 'start'
        | 'stop'
        | 'duration'
        | 'tags'
        | 'billable'
      >
    >
  ): Promise<TimeEntry> {
    return this.request(`/workspaces/${workspaceId}/time_entries/${entryId}`, {
      method: 'PUT',
      body: JSON.stringify(patch)
    })
  }

  async deleteEntry(workspaceId: number, entryId: number): Promise<void> {
    await this.request(`/workspaces/${workspaceId}/time_entries/${entryId}`, {
      method: 'DELETE'
    })
  }
}
