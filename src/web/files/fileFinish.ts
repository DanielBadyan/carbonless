import type { LineRanges } from "../../shared/lineRanges";
import { sinceMarkKey, sinceOnlyState } from "../../shared/pieces";
import type { ClusterState, SinceMark, StateChange } from "../../shared/types";

type Cluster = { key: string; state: ClusterState };

/**
 * The since view's pieces of one file that no cluster owns (gone,
 * reverted, removed: sinceOnlyPieces), with the patch set's marks they're
 * read by. They're the file's too: it isn't finished while one is left,
 * as the counts have it (sinceUnits).
 */
export interface SinceOnly {
	marks: readonly SinceMark[] | undefined;
	since: number;
	path: string;
	pieces: readonly { old: LineRanges; new: LineRanges }[];
}

const piecesLeft = (only: SinceOnly, marks: readonly SinceMark[] | undefined) =>
	only.pieces.some(
		(p) => sinceOnlyState(marks, only.since, only.path, p) === "unreviewed",
	);

/** Whether anything in the file is left: an unreviewed cluster or since-only piece. */
export function fileLeft(
	clusters: readonly Cluster[],
	only?: SinceOnly,
): boolean {
	return (
		clusters.some((c) => c.state === "unreviewed") ||
		(only !== undefined && piecesLeft(only, only.marks))
	);
}

/**
 * Whether `changes` finish the file: something is left in it now (an
 * unreviewed cluster or, in the since view, a since-only piece: `only`)
 * and nothing once they apply. Unmarking never finishes a file, and a
 * file with nothing left already can't finish again.
 */
export function finishes(
	clusters: readonly Cluster[],
	changes: readonly StateChange[],
	only?: SinceOnly,
): boolean {
	if (!fileLeft(clusters, only)) return false;
	const next = new Map(changes.map((c) => [c.key, c.state]));
	if (clusters.some((c) => (next.get(c.key) ?? c.state) === "unreviewed")) {
		return false;
	}
	if (only === undefined) return true;
	// The file's since mark as the changes leave it (the last one wins).
	const key = sinceMarkKey(only.since, only.path);
	const mark = changes.findLast((c) => c.key === key)?.sinceMark;
	const marks = mark
		? [
				...(only.marks ?? []).filter(
					(m) => !(m.since === only.since && m.path === only.path),
				),
				mark,
			]
		: only.marks;
	return !piecesLeft(only, marks);
}

/**
 * A finished file's reset: every cluster marked `kind` back to unreviewed,
 * the other kind left as it is. Empty while anything is unreviewed (the
 * button marks the rest instead) or nothing is marked `kind`.
 */
export function resetChanges(
	clusters: readonly Cluster[],
	kind: "reviewed" | "crossed-off",
): StateChange[] {
	if (clusters.some((c) => c.state === "unreviewed")) return [];
	return clusters
		.filter((c) => c.state === kind)
		.map((c) => ({ key: c.key, state: "unreviewed" }));
}

/**
 * The file to open after `index` finishes: the next one in the page's order
 * (`treeOrder`) that still has something unreviewed (`left`: by default an
 * unreviewed cluster), wrapping past the end to the files before it. None
 * when no other file has anything left (or `index` isn't one of `files`).
 */
export function nextFile<
	T extends { index: number; clusters: readonly Cluster[] },
>(
	files: readonly T[],
	index: number,
	left: (file: T) => boolean = (f) => fileLeft(f.clusters),
): T | undefined {
	const at = files.findIndex((f) => f.index === index);
	if (at === -1) return undefined;
	for (let step = 1; step < files.length; step++) {
		const file = files[(at + step) % files.length];
		if (file && left(file)) return file;
	}
	return undefined;
}
