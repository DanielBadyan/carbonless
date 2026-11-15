/**
 * Whitespace-only change, as git's `-w` sees it: two lines are equal once
 * every ASCII whitespace character is removed. Shared by the server, which
 * cuts a hunk's whitespace-only runs into clusters of their own
 * (`splitHunk`, CAR-156), and the view, which draws whitespace-equal lines
 * as quiet `~` rows with "Ignore whitespace" on (src/web/files/whitespace.ts).
 */

/** ASCII whitespace, as git's `-w` ignores it. Unicode blanks are content. */
const WHITESPACE = /[ \t\r\v\f]/g;

export const stripWhitespace = (text: string): string =>
	text.replace(WHITESPACE, "");

/** Byte-identical after removing every ASCII whitespace character. */
export const whitespaceEqual = (a: string, b: string): boolean =>
	stripWhitespace(a) === stripWhitespace(b);

/**
 * A line's matching key: its text without whitespace, and whether git's
 * "No newline at end of file" follows it (`-w` doesn't ignore that: a
 * final newline lost or gained is a real change).
 */
export const whitespaceKey = (text: string, noNewline = false): string =>
	`${stripWhitespace(text)}${noNewline ? "\0" : ""}`;

/**
 * A matching with more old-side or more new-side lines than this isn't
 * done (the matching is O(n·m)), unless both sides are the same keys line
 * for line (`matchSides`' fast path).
 */
export const PAIR_CAP = 2000;

/** One side of a line as the matching sees it. */
export interface Side {
	key: string;
	context: boolean;
}

/**
 * The heaviest common subsequence of `a` and `b` under key equality, as
 * index pairs in order. A context side weighs P = n + m + 1 (more than
 * every change-to-change match together could), a change side nothing but
 * a floor of 1: context↔context = 2P, context side↔change = P,
 * change↔change = 1. Matching every context line to itself is always
 * possible, so any optimum matches every context side, to itself or to
 * changes: no unmatched line is ever a context side, which is what makes
 * the rows a sound `-w` edit script (a block moved across an unchanged
 * line is never "whitespace only"). With no context side at all, it is
 * the longest common subsequence.
 *
 * Fast path (`fast`, on but in its test): when both sides are the same
 * keys line for line, with context sides at the same places (a wholesale
 * re-indent), the identity is the optimum (each context side matched to
 * itself, the most changes matched) and the DP's traceback takes exactly
 * that diagonal: O(n), not O(n·m). The tests check it gives what the DP
 * gives.
 */
export function matchSides(
	a: Side[],
	b: Side[],
	fast = true,
): [number, number][] {
	const n = a.length;
	const m = b.length;
	if (
		fast &&
		n === m &&
		a.every(
			(s, i) =>
				s.key === (b[i] as Side).key && s.context === (b[i] as Side).context,
		)
	)
		return a.map((_, i) => [i, i]);
	const w = m + 1;
	const P = n + m + 1;
	const weight = (i: number, j: number) =>
		((a[i] as Side).context ? P : 0) + ((b[j] as Side).context ? P : 0) || 1;
	// best[i * w + j]: the best weight over a[i..] and b[j..]; up to
	// 2P × PAIR_CAP ≈ 1.6e7, so 32 bits (16 MB at the cap, once per hunk).
	const best = new Uint32Array((n + 1) * w);
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			const skip = Math.max(
				best[(i + 1) * w + j] as number,
				best[i * w + j + 1] as number,
			);
			const take =
				(a[i] as Side).key === (b[j] as Side).key
					? weight(i, j) + (best[(i + 1) * w + j + 1] as number)
					: 0;
			best[i * w + j] = Math.max(skip, take);
		}
	}
	const out: [number, number][] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (
			(a[i] as Side).key === (b[j] as Side).key &&
			best[i * w + j] === weight(i, j) + (best[(i + 1) * w + j + 1] as number)
		) {
			out.push([i, j]);
			i++;
			j++;
		} else if (
			(best[(i + 1) * w + j] as number) >= (best[i * w + j + 1] as number)
		) {
			i++;
		} else {
			j++;
		}
	}
	return out;
}

/**
 * A piece of a `-U0` hunk: its removed lines `[removedFrom, removedTo)`
 * and added lines `[addedFrom, addedTo)`. A whitespace-only piece pairs
 * them side for side, every pair `-w`-equal.
 */
export interface HunkPiece {
	removedFrom: number;
	removedTo: number;
	addedFrom: number;
	addedTo: number;
	whitespaceOnly: boolean;
}

/**
 * A `-U0` hunk cut at its whitespace-only runs (CAR-156): the longest
 * order-preserving matching of its removed lines to its added ones under
 * `-w` equality (`matchSides`, every side a change), each maximal run of
 * pairs that follow each other on both sides a whitespace-only piece, and
 * the lines between runs a change piece. So a line moved across others is
 * a change, a pure addition or deletion (an added blank line too) is a
 * change, and a blank line paired with a whitespace-only one is
 * whitespace-only, as `git diff -w` shows them. `noNewlineOld`/`New`: the
 * last removed / added line has no newline at end of file.
 *
 * The pieces cover every line exactly once, in order (whitespace.test.ts
 * checks it for any input). A hunk with nothing to pair, or over
 * PAIR_CAP on a side and not the same keys line for line, is one change
 * piece; an all-whitespace hunk is one whitespace-only piece.
 */
export function splitHunk(
	removed: readonly string[],
	added: readonly string[],
	noNewlineOld = false,
	noNewlineNew = false,
): HunkPiece[] {
	const n = removed.length;
	const m = added.length;
	const whole: HunkPiece = {
		removedFrom: 0,
		removedTo: n,
		addedFrom: 0,
		addedTo: m,
		whitespaceOnly: false,
	};
	if (n === 0 || m === 0) return [whole];
	const side = (lines: readonly string[], noNewline: boolean) =>
		lines.map(
			(text, i): Side => ({
				key: whitespaceKey(text, noNewline && i === lines.length - 1),
				context: false,
			}),
		);
	const a = side(removed, noNewlineOld);
	const b = side(added, noNewlineNew);
	const same = n === m && a.every((s, i) => s.key === (b[i] as Side).key);
	if (!same) {
		if (n > PAIR_CAP || m > PAIR_CAP) return [whole];
		const keys = new Set(a.map((s) => s.key));
		if (!b.some((s) => keys.has(s.key))) return [whole];
	}
	const pieces: HunkPiece[] = [];
	let i = 0;
	let j = 0;
	const change = (toI: number, toJ: number) => {
		if (toI > i || toJ > j) {
			pieces.push({
				removedFrom: i,
				removedTo: toI,
				addedFrom: j,
				addedTo: toJ,
				whitespaceOnly: false,
			});
		}
		i = toI;
		j = toJ;
	};
	for (const [mi, mj] of matchSides(a, b)) {
		const prev = pieces.at(-1);
		if (
			prev?.whitespaceOnly &&
			prev.removedTo === mi &&
			prev.addedTo === mj &&
			i === mi &&
			j === mj
		) {
			prev.removedTo++;
			prev.addedTo++;
		} else {
			change(mi, mj);
			pieces.push({
				removedFrom: mi,
				removedTo: mi + 1,
				addedFrom: mj,
				addedTo: mj + 1,
				whitespaceOnly: true,
			});
		}
		i = mi + 1;
		j = mj + 1;
	}
	change(n, m);
	return pieces;
}
