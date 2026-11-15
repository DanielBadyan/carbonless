/** Waits before each retry of a busy rename (EPERM/EACCES/EBUSY), in ms. */
export const RENAME_BACKOFF: readonly number[];

/**
 * Renames `from` over `to`, retrying while Windows says the file is busy
 * (another process has it open), a bounded number of times.
 */
export function renameRetrying(
	from: string,
	to: string,
	rename?: (from: string, to: string) => void,
): void;

/**
 * Writes `data` to `path` so that no reader ever sees it half-written: the
 * whole file goes to a temp name in the same directory, then is renamed
 * over `path` (retrying while Windows says it's busy). A reader gets the
 * old file or the new one, never a truncated one. `rename` is for tests.
 */
export function writeFileAtomic(
	path: string,
	data: string,
	rename?: (from: string, to: string) => void,
): void;
