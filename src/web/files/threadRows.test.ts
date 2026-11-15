import { describe, expect, it } from "vitest";
import type { AgentThread } from "../../shared/agent";
import type { ReviewThread } from "../../shared/types";
import { agentPlaceable } from "../agent/placeable";
import { conversation, reviewThread } from "../agent/threadAgentFixtures";
import { openCount } from "./ThreadsPanel";
import { agentRows, githubRows, listedRows } from "./threadRows";

const span = (more: Partial<AgentThread> = {}): AgentThread =>
	conversation({
		id: "S1",
		anchor: {
			subject: "line",
			path: "src/a.ts",
			commit: "c0",
			side: "RIGHT",
			line: 9,
			startSide: "RIGHT",
			startLine: 9,
		},
		...more,
	});

describe("githubRows", () => {
	it("names who spoke last, with their avatar, and dates the row by the last activity", () => {
		const [row] = githubRows(
			[
				reviewThread({
					lastAuthor: { login: "ci", avatarUrl: "https://x/a.png", bot: true },
					lastActivityAt: "2026-01-05T00:00:00Z",
				}),
			],
			new Map(),
		);
		expect(row?.last).toEqual({
			kind: "person",
			login: "ci",
			avatarUrl: "https://x/a.png",
			bot: true,
		});
		expect(row?.at).toBe("2026-01-05T00:00:00Z");
		expect(row?.key).toBe("gh:RT1");
	});

	it("goes where the thread shows in the viewed snapshot, else opens its file", () => {
		const t = reviewThread({ path: "old.ts", line: 4 });
		const shown: ReviewThread = {
			...t,
			path: "new.ts",
			anchor: {
				path: "new.ts",
				commit: "h",
				side: "LEFT",
				line: 12,
				startSide: "LEFT",
				startLine: 12,
				at: t.createdAt,
			},
		};
		const [placed] = githubRows([t], new Map([[t.id, shown]]));
		expect(placed).toMatchObject({
			path: "new.ts",
			line: 12,
			target: { path: "new.ts", line: 12, side: "LEFT", thread: "RT1" },
		});
		const [unshown] = githubRows([t], new Map());
		expect(unshown).toMatchObject({
			path: "old.ts",
			line: 4,
			target: { path: "old.ts" },
		});
		// A file comment shows its path with no line.
		const file = { ...shown, subject: "file" as const, anchor: null };
		const [onFile] = githubRows([t], new Map([[t.id, file]]));
		expect(onFile).toMatchObject({
			path: "new.ts",
			line: null,
			target: { path: "new.ts" },
		});
	});

	it("keeps the thread's cues: your turn (never once resolved), outdated, resolved", () => {
		const rows = githubRows(
			[
				reviewThread({ id: "a", yourTurn: true }),
				reviewThread({ id: "b", yourTurn: true, resolved: true }),
				reviewThread({ id: "c", outdated: true }),
			],
			new Map(),
		);
		expect(rows.map((r) => [r.yourTurn, r.resolved, r.outdated])).toEqual([
			[true, false, false],
			[false, true, false],
			[false, false, true],
		]);
	});
});

describe("agentRows", () => {
	it("dates by the last message, else the thread's own time; says who spoke last", () => {
		const [answered, asked] = agentRows(
			[
				conversation({ id: "A1" }),
				span({ id: "S1", at: "2026-11-12T00:00:00Z", messages: [] }),
			],
			new Map(),
			new Map(),
		);
		expect(answered?.at).toBe("2026-11-11T10:01:00Z");
		expect(answered?.last).toEqual({ kind: "agent", by: "ai" });
		expect(asked?.at).toBe("2026-11-12T00:00:00Z");
		// No message: whoever opened it.
		expect(asked?.last).toEqual({ kind: "agent", by: "human" });
	});

	it("a conversation on a GitHub thread goes where that thread shows", () => {
		const gh = reviewThread({
			path: "moved.ts",
			anchor: {
				path: "moved.ts",
				commit: "h",
				side: "RIGHT",
				line: 30,
				startSide: "RIGHT",
				startLine: 30,
				at: "",
			},
		});
		const [row] = agentRows(
			[conversation()],
			new Map(),
			new Map([["RT1", gh]]),
		);
		expect(row).toMatchObject({
			key: "ai:A1",
			path: "moved.ts",
			line: 30,
			// Its GitHub thread's bubble opens: the conversation is in its card.
			target: { path: "moved.ts", line: 30, side: "RIGHT", thread: "RT1" },
		});
		// Its GitHub thread shows nowhere: where it was asked.
		const [asked] = agentRows([conversation()], new Map(), new Map());
		expect(asked?.target).toEqual({
			path: "src/cache.ts",
			line: 4,
			side: "RIGHT",
		});
	});

	it("a span question goes where Files changed shows it, else where it was asked", () => {
		const t = span();
		const placed = {
			...agentPlaceable(t),
			path: "src/b.ts",
			anchor: {
				side: "RIGHT" as const,
				line: 20,
				startSide: "RIGHT" as const,
				startLine: 20,
				startCol: null,
				endCol: null,
			},
		};
		expect(
			agentRows([t], new Map([[t.id, placed]]), new Map())[0],
		).toMatchObject({ path: "src/b.ts", line: 20 });
		expect(agentRows([t], new Map(), new Map())[0]).toMatchObject({
			path: "src/a.ts",
			line: 9,
			target: { path: "src/a.ts", line: 9, side: "RIGHT" },
		});
	});

	it("carries unread and waiting", () => {
		const [row] = agentRows(
			[span({ unread: true, waiting: true })],
			new Map(),
			new Map(),
		);
		expect(row?.unread).toBe(true);
		expect(row?.waiting).toBe(true);
	});
});

describe("listedRows", () => {
	const rows = githubRows(
		[
			reviewThread({ id: "old", lastActivityAt: "2026-01-01T00:00:00Z" }),
			reviewThread({ id: "new", lastActivityAt: "2026-01-09T00:00:00Z" }),
			reviewThread({
				id: "done",
				resolved: true,
				lastActivityAt: "2026-01-10T00:00:00Z",
			}),
			reviewThread({ id: "undated", lastActivityAt: "" }),
			reviewThread({ id: "mid", lastActivityAt: "2026-01-05T00:00:00Z" }),
		],
		new Map(),
	);

	it("lists newest activity first, an undated one last, resolved ones left out", () => {
		expect(listedRows(rows, false).map((r) => r.id)).toEqual([
			"new",
			"mid",
			"old",
			"undated",
		]);
	});

	it("lists resolved ones too when asked, in their place by activity", () => {
		expect(listedRows(rows, true).map((r) => r.id)).toEqual([
			"done",
			"new",
			"mid",
			"old",
			"undated",
		]);
	});

	it("never drops an unresolved row, whatever its data", () => {
		const odd = githubRows(
			[
				reviewThread({ id: "x", lastActivityAt: "not a date", path: "" }),
				reviewThread({
					id: "y",
					lastAuthor: { login: "", avatarUrl: "", bot: false },
				}),
			],
			new Map(),
		);
		expect(listedRows(odd, false)).toHaveLength(2);
	});
});

describe("openCount", () => {
	const people = githubRows(
		[reviewThread({ id: "a" }), reviewThread({ id: "b", resolved: true })],
		new Map(),
	);
	const ai = agentRows(
		[span(), span({ id: "S2", resolved: true })],
		new Map(),
		new Map(),
	);

	it("counts the unresolved conversations of both regions", () => {
		expect(openCount(people, ai, { people: false, ai: false })).toBe(2);
	});

	it("is unknown while either region loads, never a partial count", () => {
		expect(openCount(null, ai, { people: false, ai: false })).toBeNull();
		expect(openCount(people, null, { people: false, ai: false })).toBeNull();
	});

	it("counts what came when a region failed", () => {
		expect(openCount(people, null, { people: false, ai: true })).toBe(1);
	});
});
