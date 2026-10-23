import { createErrorClassesByName } from 'custom-error-creator'

export const {
	NotFound,
	ProjectNotFound,
	BlobNotFound,
	IconNotFound,
	InvalidIconSize,
	InvalidRequest,
	RenderFailed,
} = createErrorClassesByName([
	{ code: 'NOT_FOUND', message: 'Not found', status: 404 },
	{ code: 'PROJECT_NOT_FOUND', message: 'Project not found', status: 404 },
	{ code: 'BLOB_NOT_FOUND', message: 'Blob not found', status: 404 },
	{ code: 'ICON_NOT_FOUND', message: 'Icon not found', status: 404 },
	{ code: 'INVALID_ICON_SIZE', message: 'Invalid icon size', status: 400 },
	{ code: 'INVALID_REQUEST', message: 'Invalid request', status: 400 },
	{ code: 'RENDER_FAILED', message: 'Failed to render icon', status: 500 },
])
