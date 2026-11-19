export function createNodeError(message: string, code: string, errno?: number) {
	return Object.assign(new Error(message), {
		code,
		errno,
	})
}
