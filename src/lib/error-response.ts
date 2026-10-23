import { isCustomError, isErrorWithCode } from 'custom-error-creator'
import { json } from 'itty-router'

export function getErrorCode(err: unknown): string | undefined {
	return isErrorWithCode(err) ? err.code : undefined
}

export function getErrorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err)
}

/**
 * A `{ status, code, message }` JSON response for anything thrown by a route.
 * Errors with an HTTP `status` and a `code`, ours or the host's, are passed
 * through; anything else is unexpected and its message may expose internals.
 */
export function errorResponse(err: unknown): Response {
	const { status, code, message } =
		isCustomError(err) && err.status >= 400 && err.status <= 599
			? err
			: {
					status: 500,
					code: 'INTERNAL_SERVER_ERROR',
					message: 'Internal error',
				}
	return json({ status, code, message }, { status })
}
