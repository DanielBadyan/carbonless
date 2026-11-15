import type { AgentThread } from "../../shared/agent";
import type { ReviewThread } from "../../shared/types";
import type { AgentPlaceable } from "../agent/placeable";
import type { FilesSearch } from "./landing";

/** Who spoke last in a conversation: a person on GitHub, or the reviewer or the agent. */
export type LastSpeaker =
	| { kind: "person"; login: string; avatarUrl: string; bot: boolean }
	| { kind: "agent"; by: "human" | "ai" };

/** One conversation's row in the Threads panel. */
export interface PanelRow {
	/** "gh:<id>" or "ai:<id>": unique across both regions. */
	key: string;
	id: string;
	/** Where it shows in the viewed snapshot (where it was made when it shows nowhere). */
	path: string;
	/** Its line there; null on a file, or where no line is known. */
	line: number | null;
	/** Its last activity (ISO). */
	at: string;
	resolved: boolean;
	last: LastSpeaker;
	/** A GitHub thread that waits on the viewer. */
	yourTurn: boolean;
	/** GitHub says its line is outdated. */
	outdated: boolean;
	/** An agent message the reviewer hasn't seen. */
	unread: boolean;
	/** A reviewer's message no answer has seen yet. */
	waiting: boolean;
	/** Where the row goes in Files changed (a thread link's landing). */
	target: FilesSearch;
}

/** Where a shown thread is, as a landing: its last line, or its file's top. */
function placedTarget(
	path: string,
	subject: "line" | "file",
	anchor: { line: number; side: "LEFT" | "RIGHT" } | null,
): { line: number | null; target: FilesSearch } {
	if (subject === "file" || !anchor) return { line: null, target: { path } };
	return {
		line: anchor.line,
		target: { path, line: anchor.line, side: anchor.side },
	};
}

/**
 * Where a GitHub thread is: where it shows in the viewed snapshot
 * (`shown`, by id: shownThreads), else where it was made, opening its
 * file at the top (the file lists it there, or the page says it's not in
 * this diff).
 */
function githubPlace(
	t: ReviewThread,
	shown: ReadonlyMap<string, ReviewThread>,
): { path: string; line: number | null; target: FilesSearch } {
	const s = shown.get(t.id);
	if (s) {
		const placed = placedTarget(s.path, s.subject, s.anchor);
		// On a line: its bubble opens there too.
		const target =
			placed.line === null ? placed.target : { ...placed.target, thread: t.id };
		return { path: s.path, line: placed.line, target };
	}
	return { path: t.path, line: t.line, target: { path: t.path } };
}

/** The PR's review threads as rows, every one (resolved too), unsorted. */
export function githubRows(
	threads: readonly ReviewThread[],
	shown: ReadonlyMap<string, ReviewThread>,
): PanelRow[] {
	return threads.map((t) => ({
		key: `gh:${t.id}`,
		id: t.id,
		...githubPlace(t, shown),
		at: t.lastActivityAt,
		resolved: t.resolved,
		last: {
			kind: "person",
			login: t.lastAuthor.login,
			avatarUrl: t.lastAuthor.avatarUrl,
			bot: t.lastAuthor.bot,
		},
		yourTurn: t.yourTurn && !t.resolved,
		outdated: t.outdated,
		unread: false,
		waiting: false,
	}));
}

/** Where an agent thread was asked (a file's top without lines). */
function askedPlace(t: AgentThread): {
	path: string;
	line: number | null;
	target: FilesSearch;
} {
	const a = t.anchor;
	if (a.subject === "file" || a.line === undefined || a.side === undefined) {
		return { path: a.path, line: null, target: { path: a.path } };
	}
	return {
		path: a.path,
		line: a.line,
		target: { path: a.path, line: a.line, side: a.side },
	};
}

/**
 * The reviewer's agent conversations as rows, every one (resolved too),
 * unsorted. One on a GitHub thread goes where that thread shows; a span
 * question where Files changed shows it (`shown`, by id:
 * shownAgentPlaceables); else where it was asked.
 */
export function agentRows(
	threads: readonly AgentThread[],
	shown: ReadonlyMap<string, AgentPlaceable>,
	githubShown: ReadonlyMap<string, ReviewThread>,
): PanelRow[] {
	return threads.map((t) => {
		const lastMessage = t.messages.at(-1);
		const a = t.anchor;
		const onGithub =
			a.subject === "thread" ? githubShown.get(a.thread) : undefined;
		const p = shown.get(t.id);
		const place = onGithub
			? githubPlace(onGithub, new Map([[onGithub.id, onGithub]]))
			: p
				? { path: p.path, ...placedTarget(p.path, p.subject, p.anchor) }
				: askedPlace(t);
		return {
			key: `ai:${t.id}`,
			id: t.id,
			...place,
			at: lastMessage?.at ?? t.at,
			resolved: t.resolved,
			last: { kind: "agent", by: lastMessage?.by ?? t.openedBy },
			yourTurn: false,
			outdated: false,
			unread: t.unread,
			waiting: t.waiting,
		};
	});
}

const timeOf = (iso: string) => {
	const ms = Date.parse(iso);
	return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
};

/**
 * The rows a region lists: newest activity first (an undated one last),
 * resolved ones only when `showResolved`. Nothing else is left out.
 */
export function listedRows(
	rows: readonly PanelRow[],
	showResolved: boolean,
): PanelRow[] {
	return rows
		.filter((r) => showResolved || !r.resolved)
		.map((r, i) => ({ r, i, ms: timeOf(r.at) }))
		.sort((x, y) => y.ms - x.ms || x.i - y.i)
		.map(({ r }) => r);
}
