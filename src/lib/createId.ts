/** Opaque IDs work on HTTPS and local/insecure previews without randomUUID. */
export const createId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
