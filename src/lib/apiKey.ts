import {Store} from './store/index.ts'

/** Browser-entered keys remain in memory only. The server key is never returned by /api/status. */
export const apiKeyStore = new Store({
  key: '',
  requested: false,
  serverConfigured: false,
  csrfToken: '',
  checked: false,
})
export const getApiKey = () => apiKeyStore.state.key.trim()
export const hasApiKey = () => Boolean(getApiKey() || apiKeyStore.state.serverConfigured)
export const setApiKey = (key: string) => apiKeyStore.set({key: key.trim()})
export const requestApiKey = () => apiKeyStore.set({requested: true})
export async function refreshApiStatus() {
  try {
    const response = await fetch('/api/status', {signal: AbortSignal.timeout(5000)})
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
      throw new Error('Static deployment')
    }
    const value: unknown = await response.json()
    if (!value || typeof value !== 'object' || !('configured' in value) || typeof value.configured !== 'boolean' || !('csrfToken' in value) || typeof value.csrfToken !== 'string') {
      throw new Error('Invalid status response')
    }
    apiKeyStore.set({
      serverConfigured: value.configured,
      csrfToken: value.csrfToken,
      checked: true,
    })
  } catch {
    apiKeyStore.set({
      serverConfigured: false,
      csrfToken: '',
      checked: true,
    })
  }
}
