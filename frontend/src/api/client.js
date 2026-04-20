/**
 * HiveRunr API client
 *
 * Single source of truth for all fetch calls.  Reads the active workspace
 * from the hr_workspace cookie (set by POST /api/workspaces/:id/switch) and
 * injects it as the X-Workspace-Id header on every request.
 *
 * Usage:
 *   import { api } from '../api/client'
 *
 *   const flows = await api('GET', '/api/graphs')
 *   const run   = await api('POST', '/api/graphs/5/run', { key: 'val' })
 *
 * Throws an Error with message = the API's detail string on non-2xx responses.
 * Redirects to /login on 401.
 * Returns null on 204 No Content.
 */

function _getWorkspaceId() {
  const m = document.cookie.match(/(?:^|;\s*)hr_workspace=([^;]+)/)
  return m ? m[1] : null
}

export async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' }
  const wid = _getWorkspaceId()
  if (wid) headers['X-Workspace-Id'] = wid

  const r = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (r.status === 401) {
    window.location.href = '/login'
    return
  }
  if (!r.ok) {
    const e = await r.json().catch(() => ({ detail: r.statusText }))
    throw new Error(e.detail || r.statusText)
  }
  if (r.status === 204) return null
  return r.json()
}
