/** selectable feather algorithms, the first one is the default */
export const featherMethodIds = ['smooth', 'distance'] as const

export type FeatherMethodId = typeof featherMethodIds[number]

export const defaultFeatherMethodId: FeatherMethodId = featherMethodIds[0]

export const isFeatherMethodId = (value: unknown): value is FeatherMethodId => featherMethodIds.includes(value as FeatherMethodId)

/** Reads a feather method ID case-insensitively; unknown values fall back to the default. */
export const parseFeatherMethodId = (value: unknown): FeatherMethodId => {
  const id = String(value ?? '').trim().toLowerCase()
  return isFeatherMethodId(id) ? id : defaultFeatherMethodId
}
