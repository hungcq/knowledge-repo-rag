// API configuration
// Vite exposes env variables that start with VITE_ as import.meta.env.VITE_*
// Default to production API if not set
const API_HOST = import.meta.env.VITE_API_HOST || 'api.knowledge-repo-rag.hungcq.com'
const API_PROTOCOL = import.meta.env.VITE_ENV === 'test' ? 'http' : 'https'
const WS_PROTOCOL = import.meta.env.VITE_ENV === 'test' ? 'ws' : 'wss'

export const getHttpUrl = () => `${API_PROTOCOL}://${API_HOST}`
export const getWsUrl = () => `${WS_PROTOCOL}://${API_HOST}`
