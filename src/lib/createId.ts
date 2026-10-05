/** Opaque IDs work on HTTPS and local/insecure previews without randomUUID. */
export const createId = () => crypto.getRandomValues(new Uint8Array(16)).toHex()
