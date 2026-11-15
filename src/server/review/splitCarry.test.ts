import { describe, expect, it } from "vitest";
import type { Cluster, Snapshot } from "../../shared/types.js";
import { buildReviewView } from "./coverage.js";
import { type CrbEvent, newEvent } from "./events.js";
import { foldProgress } from "./fold.js";
import { splitCarries, withSplitCarries } from "./splitCarry.js";

const REV = "a".repeat(64);
const REV2 = "b".repeat(64);
/** The whole hunk's key before it split. */
const H = "1".repeat(64);
const P1 = "2".repeat(64);
const P2 = "3".repeat(64);
const P3 = "4".repeat(64);
const OTHER = "9".repeat(64);

/**
 * One hunk of 6 removed and 6 added lines, cut into change / whitespace
 * only / change: the hunk's lines 0-5 removed, 6-11 added; P1 owns 0-1 and
 * 6-7, P2 2-3 and 8-9, P3 4-5 and 10-11.
 */
const piece = (key: string, at: number, ws = false): Cluster => ({
	key,
	kind: "lines",
	oldStart: 1 + at,
	oldCount: 2,
	newStart: 1 + at,
	newCount: 2,
	removed: [`r${at}`, `r${at + 1}`],
	added: [`a${at}`, `a${at + 1}`],
	lines: 4,
	...(ws ? { whitespaceOnly: true as const } : {}),
	split: { key: H, removedAt: at, addedAt: at, removed: 6 },
});

const snapshot = (revision = REV): Snapshot => ({
	base: "1".repeat(40),
	head: "2".repeat(40),
	revision,
	files: [
		{
			index: 0,
			path: "src/a.ts",
			status: "modified",
			binary: false,
			submodule: false,
			additions: 6,
			deletions: 6,
			clusters: [piece(P1, 0), piece(P2, 2, true), piece(P3, 4)],
		},
	],
});

let clock = 1_000;
const at = <E extends CrbEvent>(e: E): E => {
	clock += 10;
	return { ...e, ts: clock };
};
const started = (revision = REV, patchset = 1) =>
	at(
		newEvent("patchset-started", "dan", {
			patchset,
			revision,
			mergeBase: "1".repeat(40),
			head: "2".repeat(40),
			...(patchset > 1 ? { since: patchset - 1, shape: "S1" as const } : {}),
		}),
	);
const mark = (
	cluster: string,
	state: "unreviewed" | "reviewed" | "crossed-off",
	reason?: string,
	revision = REV,
) =>
	at(
		newEvent("cluster-state", "dan", {
			patchset: revision,
			cluster,
			path: "src/a.ts",
			state,
			...(reason ? { reason } : {}),
		}),
	);
const lines = (
	cluster: string,
	state: "reviewed" | "crossed-off",
	ranges: [number, number][],
) =>
	at(
		newEvent("lines-state", "dan", {
			patchset: REV,
			cluster,
			path: "src/a.ts",
			state,
			lines: ranges,
		}),
	);

/** The split carries for `events`, folded in as the store would write them. */
function carry(events: CrbEvent[], snap = snapshot()) {
	const before = foldProgress(events).statesByRevision.get(snap.revision);
	const entries = splitCarries(snap, before ?? new Map());
	const after = [
		...events,
		at(
			newEvent(
				"split-carried",
				"dan",
				{ patchset: snap.revision, states: entries },
				"auto",
			),
		),
	];
	const progress = foldProgress(after);
	return {
		entries,
		view: buildReviewView(snap, progress),
		// What a second read would write.
		again: splitCarries(
			snap,
			progress.statesByRevision.get(snap.revision) ?? new Map(),
		),
	};
}

const states = (view: ReturnType<typeof carry>["view"]) =>
	view.files[0]?.clusters.map((c) => ({
		state: c.state,
		...(c.reason ? { reason: c.reason } : {}),
		...(c.reviewedLines ? { reviewedLines: c.reviewedLines } : {}),
		...(c.crossedLines ? { crossedLines: c.crossedLines } : {}),
		...(c.carried ? { carried: c.carried } : {}),
	}));

describe("splitCarries", () => {
	it("puts a whole hunk's mark on every piece, once", () => {
		const { entries, view, again } = carry([started(), mark(H, "reviewed")]);
		expect(entries).toEqual([
			{ key: P1, fromKey: H, state: "reviewed" },
			{ key: P2, fromKey: H, state: "reviewed" },
			{ key: P3, fromKey: H, state: "reviewed" },
		]);
		expect(states(view)).toEqual([
			{ state: "reviewed" },
			{ state: "reviewed" },
			{ state: "reviewed" },
		]);
		expect(view.progress.clusters).toEqual({
			total: 3,
			reviewed: 3,
			crossedOff: 0,
		});
		expect(again).toEqual([]);
	});

	it("keeps a crossed-off hunk's reason on each piece", () => {
		const { view, again } = carry([
			started(),
			mark(H, "crossed-off", "generated"),
		]);
		expect(states(view)).toEqual(
			Array(3).fill({ state: "crossed-off", reason: "generated" }),
		);
		expect(again).toEqual([]);
	});

	it("maps a hunk's line marks onto its pieces: whole where they cover one, by lines where they cover part", () => {
		const { entries, view, again } = carry([
			started(),
			mark(H, "unreviewed"),
			// P1 whole, P2's first removed and first added line.
			lines(H, "reviewed", [
				[0, 3],
				[6, 9],
			]),
			// P3's added lines.
			lines(H, "crossed-off", [[10, 12]]),
		]);
		expect(entries).toEqual([
			{
				key: P1,
				fromKey: H,
				state: "reviewed",
				from: [
					[0, 2],
					[6, 8],
				],
			},
			{
				key: P2,
				fromKey: H,
				state: "reviewed",
				from: [
					[2, 3],
					[8, 9],
				],
				lines: [
					[0, 1],
					[2, 3],
				],
			},
			{
				key: P3,
				fromKey: H,
				state: "crossed-off",
				from: [[10, 12]],
				lines: [[2, 4]],
			},
		]);
		expect(states(view)).toEqual([
			{ state: "reviewed" },
			{
				state: "unreviewed",
				reviewedLines: [
					[0, 1],
					[2, 3],
				],
			},
			{ state: "unreviewed", crossedLines: [[2, 4]] },
		]);
		expect(again).toEqual([]);
	});

	it("marks a piece its hunk's lines cover in two states by lines, reviewed with its crossed lines", () => {
		const { entries, view } = carry([
			started(),
			lines(H, "reviewed", [
				[0, 2],
				[6, 7],
			]),
			lines(H, "crossed-off", [[7, 8]]),
		]);
		expect(entries.filter((e) => e.key === P1)).toHaveLength(2);
		expect(states(view)?.[0]).toEqual({
			state: "reviewed",
			crossedLines: [[3, 4]],
		});
	});

	it("carries nothing a hunk didn't have: unmarked, unreviewed, or a stored key matching nothing old or new", () => {
		expect(carry([started()]).entries).toEqual([]);
		expect(carry([started(), mark(H, "unreviewed")]).entries).toEqual([]);
		const stray = carry([started(), mark(OTHER, "reviewed")]);
		expect(stray.entries).toEqual([]);
		expect(states(stray.view)).toEqual(Array(3).fill({ state: "unreviewed" }));
		expect(stray.view.progress.clusters.reviewed).toBe(0);
	});

	it("leaves a piece that holds its own mark alone, unticked too", () => {
		const { entries, view } = carry([
			started(),
			mark(H, "reviewed"),
			mark(P2, "unreviewed"),
			mark(P3, "crossed-off"),
		]);
		expect(entries.map((e) => e.key)).toEqual([P1]);
		expect(states(view)).toEqual([
			{ state: "reviewed" },
			{ state: "unreviewed" },
			{ state: "crossed-off" },
		]);
	});

	it("does nothing while the hunk's key is still a cluster of the snapshot", () => {
		const snap = snapshot();
		const file = snap.files[0] as Snapshot["files"][number];
		file.clusters = [...file.clusters, { ...piece(H, 6), split: undefined }];
		expect(carry([started(), mark(H, "reviewed")], snap).entries).toEqual([]);
	});

	it("carries a carried hunk's mark as carried, in a later patch set", () => {
		const events = [
			started(),
			mark(H, "reviewed"),
			started(REV2, 2),
			at(
				newEvent(
					"carried",
					"dan",
					{
						from: 1,
						to: 2,
						rule: "exact",
						states: [{ key: H, state: "reviewed" }],
					},
					"auto",
				),
			),
		];
		const { view } = carry(events, snapshot(REV2));
		expect(states(view)).toEqual(
			Array(3).fill({
				state: "reviewed",
				carried: { from: 1, rule: "exact" },
			}),
		);
	});
});

describe("withSplitCarries", () => {
	it("folds the carries in without writing, as carrySplits would", () => {
		const events = [started(), mark(H, "reviewed"), mark(OTHER, "reviewed")];
		const view = buildReviewView(
			snapshot(),
			withSplitCarries(events, snapshot(), "dan"),
		);
		expect(states(view)).toEqual(Array(3).fill({ state: "reviewed" }));
		// Nothing to carry: the fold as it is.
		const plain = [started(), mark(OTHER, "reviewed")];
		expect(withSplitCarries(plain, snapshot(), "dan")).toEqual(
			foldProgress(plain),
		);
	});
});
