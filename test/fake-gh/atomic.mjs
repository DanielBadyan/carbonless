// Plain ESM so test/fake-gh/gh (a Node script) and the TypeScript test
// helpers share one implementation; atomic.d.mts types it.
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { threadId } from "node:worker_threads";

let count = 0;

/**
 * Codes a rename over a file fails with on Windows while another process
 * has it (or the temp file) open for a moment: a reader such as the fake
 * agent polling its scenario, or a virus scanner. Windows can't replace a
 * file that has open handles, even ones that allow sharing.
 */
const BUSY = new Set(["EPERM", "EACCES", "EBUSY"]);
/** Waits before each retry of a busy rename, in ms: about 3 s in all. */
export const RENAME_BACKOFF = [5, 10, 20, 40, 80, 160, 320, 640, 1000, 1000];

const pause = new Int32Array(new SharedArrayBuffer(4));
const sleepSync = (ms) => Atomics.wait(pause, 0, 0, ms);

/**
 * Renames `from` over `to`, retrying while the file system says it's busy
 * (BUSY), up to RENAME_BACKOFF's length; then throws the last error. A file
 * system workaround, not a test retry: readers open, read and close.
 */
export function renameRetrying(from, to, rename = renameSync) {
	for (let attempt = 0; ; attempt++) {
		try {
			rename(from, to);
			return;
		} catch (error) {
			if (!BUSY.has(error?.code) || attempt >= RENAME_BACKOFF.length)
				throw error;
			sleepSync(RENAME_BACKOFF[attempt]);
		}
	}
}

/**
 * Writes `data` to `path` so that no reader ever sees it half-written: the
 * whole file goes to a temp name in the same directory (unique per process,
 * thread and write, so two gh processes, or the test and the fake gh server's
 * thread, saving at once don't clash), then is
 * renamed over `path`. A reader gets the old file or the new one, never a
 * truncated one; a failed write leaves the old file and no temp file.
 * `rename` is for tests.
 */
export function writeFileAtomic(path, data, rename = renameSync) {
	const tmp = `${path}.${process.pid}.${threadId}.${count++}.tmp`;
	try {
		writeFileSync(tmp, data);
		renameRetrying(tmp, path, rename);
	} catch (error) {
		rmSync(tmp, { force: true });
		throw error;
	}
}
