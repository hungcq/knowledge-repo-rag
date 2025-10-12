import { getHttpUrl } from '../config/api'

const httpUrl = getHttpUrl()

export const sessionService = {
  async loadSessions(userId) {
    try {
      const response = await fetch(`${httpUrl}/api/users/${userId}/sessions`)
      const data = await response.json()
      return data
    } catch (error) {
      console.error('Error loading sessions:', error)
      return []
    }
  },

  async searchSessions(userId, query) {
    if (!query || query.trim() === '') {
      return null // Indicates to use cached sessions
    }
    try {
      const response = await fetch(`${httpUrl}/api/users/${userId}/sessions/search?q=${encodeURIComponent(query)}`)
      const data = await response.json()
      return data
    } catch (error) {
      console.error('Error searching sessions:', error)
      return []
    }
  },

  async updateSessionTitle(sessionId, newTitle) {
    try {
      const response = await fetch(`${httpUrl}/api/sessions/${sessionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
      })
      if (response.ok) {
        return await response.json()
      }
      return null
    } catch (error) {
      console.error('Error updating session title:', error)
      return null
    }
  },

  async loadMessages(sessionId, userId) {
    try {
      const response = await fetch(`${httpUrl}/api/sessions/${sessionId}/messages?userId=${encodeURIComponent(userId)}`)
      const data = await response.json()
      return data
    } catch (error) {
      console.error('Error loading messages:', error)
      return []
    }
  },
}
