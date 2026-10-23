import type { IRequest } from 'itty-router'

import { InvalidRequest } from '../errors.ts'

// hex encoded 32-byte string
export const HEX_32_BYTES = /^[0-9a-fA-F]{64}$/

// z-base-32 encoded 32-byte string (52 characters)
export const Z_BASE_32_32_BYTES = /^[0-9a-zA-Z]{52}$/

/**
 * itty-router middleware that decodes the route params (itty-router leaves
 * them encoded) and throws `INVALID_REQUEST` if one does not match its pattern
 */
export function withParams(patterns: { [param: string]: RegExp }) {
	return (request: IRequest) => {
		for (const [key, value] of Object.entries(request.params)) {
			let decoded: string
			try {
				decoded = decodeURIComponent(value)
			} catch {
				throw new InvalidRequest('Malformed URL encoding')
			}
			if (patterns[key] && !patterns[key].test(decoded)) {
				throw new InvalidRequest(`Invalid ${key}`)
			}
			request.params[key] = decoded
		}
	}
}
