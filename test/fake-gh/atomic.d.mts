/** Waits before each retry of a busy rename (EPERM/EACCES/EBUSY), in ms. */
export const RENAME_BACKOFF: readonly number[];

/** For tests: the rename, the wait between tries, and whether to retry (Windows). */
export interface RenameOptions {
	rename?: (from: string, to: string) => void;
	sleep?: (ms: number) => void;
	windows?: boolean;
}

/**
 * Renames `from` over `to`; on Windows, retries while the file is busy
 * (another process has it open), a bounded number of times.
 */
export function renameRetrying(
	from: string,
	to: string,
	options?: RenameOptions,
): void;

/**
 * Writes `data` to `path` so that no reader ever sees it half-written: the
 * whole file goes to a temp name in the same directory, then is renamed
 * over `path` (on Windows, retrying while it's busy). A reader gets the
 * old file or the new one, never a truncated one. `options` are for tests.
 */
export function writeFileAtomic(
	path: string,
	data: string,
	options?: RenameOptions,
): void;
