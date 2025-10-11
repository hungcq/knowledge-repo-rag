// Generate a short random ID (6-8 chars alphanumeric)
export const genShortId = () => Math.random().toString(36).slice(2, 8)

// Get userId from query string or create one, then normalize URL
export function getOrCreateUserIdInQuery() {
  const url = new URL(window.location.href)
  let id = url.searchParams.get('userId')
  if (!id) {
    id = genShortId()
    url.searchParams.set('userId', id)
    // Keep the same path but add ?userId=...
    window.history.replaceState(null, '', url.toString())
  }
  return id
}

// Get sessionId from path or return null
export function getSessionIdFromPath() {
  const path = window.location.pathname
  const match = path.match(/^\/chat\/([^\/]+)$/)
  return match ? match[1] : null
}

// Update URL path with sessionId
export function updateSessionPath(sessionId) {
  const url = new URL(window.location.href)
  if (sessionId) {
    url.pathname = `/chat/${sessionId}`
  } else {
    url.pathname = '/'
  }
  window.history.replaceState(null, '', url.toString())
}
