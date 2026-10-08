import type {FeatherMethodId} from './featherMethodIds.ts'
import type {FeatherMethod} from './base/FeatherMethod.ts'

import queryParameters from '#src/queryParameters.ts'

import {DistanceFeather} from './DistanceFeather.ts'
import {SmoothFeather} from './SmoothFeather.ts'

export const featherMethods: Record<FeatherMethodId, FeatherMethod> = {
  smooth: new SmoothFeather,
  distance: new DistanceFeather,
}

/** the feather method selected with ?feather_method, or the default */
export const getFeatherMethod = (id: FeatherMethodId = queryParameters.feather_method) => featherMethods[id]

export type {FeatherCore, FeatherShape} from './base/FeatherMethod.ts'
export {FeatherMethod} from './base/FeatherMethod.ts'
export {defaultFeatherMethodId, type FeatherMethodId, featherMethodIds, isFeatherMethodId, parseFeatherMethodId} from './featherMethodIds.ts'
