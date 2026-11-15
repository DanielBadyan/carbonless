import { describe, expect, it } from "vitest";
import { placeControls, runEnd } from "./stickyControls";

// Stack bottom at 180; controls 20px tall whose 40px targets reach 10px out;
// the diff's visible left edge at 100, the slot 8px right of it (unscrolled).
const base = {
	top: 180,
	above: 10,
	below: 10,
	height: 20,
	edge: 100,
	slotLeft: 108,
};

describe("placeControls", () => {
	it("leaves controls in place while their targets are below the stack", () => {
		expect(
			placeControls({ ...base, slotTop: 190, clusterBottom: 900 }),
		).toEqual({ mode: "static" });
		expect(
			placeControls({ ...base, slotTop: 400, clusterBottom: 900 }),
		).toEqual({ mode: "static" });
	});

	it("floats them right below the stack once their row slips under it", () => {
		expect(
			placeControls({ ...base, slotTop: 189, clusterBottom: 900 }),
		).toEqual({ mode: "fixed", top: 190, left: 108 });
		// Deep inside a long cluster.
		expect(
			placeControls({ ...base, slotTop: -3000, clusterBottom: 900 }),
		).toEqual({ mode: "fixed", top: 190, left: 108 });
	});

	it("rides up with the cluster's end, never past it", () => {
		// Fixed would end at 190 + 20 + 10 + 2 = 222: just fits.
		expect(
			placeControls({ ...base, slotTop: -500, clusterBottom: 222 }),
		).toEqual({ mode: "fixed", top: 190, left: 108 });
		// The end is near: translated so the targets end above it.
		expect(
			placeControls({ ...base, slotTop: -500, clusterBottom: 200 }),
		).toEqual({ mode: "end", offset: 200 - 2 - 10 - 20 + 500, x: 0 });
	});

	it("stays put in a cluster too short to float in", () => {
		expect(
			placeControls({ ...base, slotTop: 170, clusterBottom: 195 }),
		).toEqual({ mode: "static" });
	});
});

describe("placeControls, sideways", () => {
	// Rows on screen, below the stack: only the horizontal axis applies.
	const row = { ...base, slotTop: 400, clusterBottom: 900 };

	it("leaves them in their slot while the slot is in view", () => {
		expect(placeControls(row)).toEqual({ mode: "static" });
		// Scrolled a little: the slot still starts right of the edge.
		expect(placeControls({ ...row, slotLeft: 103 })).toEqual({
			mode: "static",
		});
		expect(placeControls({ ...row, slotLeft: 102 })).toEqual({
			mode: "static",
		});
		// Right at the edge: nothing is hidden yet, so nothing floats.
		expect(placeControls({ ...row, slotLeft: 101 })).toEqual({
			mode: "static",
		});
		expect(placeControls({ ...row, slotLeft: 100 })).toEqual({
			mode: "static",
		});
	});

	it("floats them at the diff's visible left edge once the slot passes it", () => {
		// Scrolled 120 sideways: the slot is 12px left of the edge.
		expect(placeControls({ ...row, slotLeft: -12 })).toEqual({
			mode: "shift",
			x: 114,
		});
		// Partly hidden (10px behind the edge): moved just clear of it.
		expect(placeControls({ ...row, slotLeft: 90 })).toEqual({
			mode: "shift",
			x: 12,
		});
	});

	it("takes the top-left corner of the visible code while both axes apply", () => {
		expect(
			placeControls({
				...base,
				slotTop: -500,
				clusterBottom: 900,
				slotLeft: -12,
			}),
		).toEqual({ mode: "fixed", top: 190, left: 102 });
		// Riding up with the cluster's end, still at the edge.
		expect(
			placeControls({
				...base,
				slotTop: -500,
				clusterBottom: 200,
				slotLeft: -12,
			}),
		).toEqual({ mode: "end", offset: 200 - 2 - 10 - 20 + 500, x: 114 });
		// Too short a cluster to float down in: only sideways.
		expect(
			placeControls({
				...base,
				slotTop: 170,
				clusterBottom: 195,
				slotLeft: -12,
			}),
		).toEqual({ mode: "shift", x: 114 });
	});
});

describe("runEnd", () => {
	const row = (top: number, bottom = top + 200) => ({ top, bottom });
	it("stops at the first opened thread below the slot, else the cluster's end", () => {
		expect(runEnd(0, 100, 900, [])).toBe(900);
		expect(runEnd(0, 100, 900, [row(400), row(600)])).toBe(400);
		// A thread above the slot doesn't end the run below it.
		expect(runEnd(0, 100, 900, [row(50), row(700)])).toBe(700);
		expect(runEnd(0, 100, 300, [row(700)])).toBe(300);
	});

	it("ignores a thread the stack has passed: below it the controls float again", () => {
		// The stack's bottom at 180; the thread's row ended at 150, off above.
		expect(runEnd(180, -600, 900, [row(-50, 150)])).toBe(900);
		// Still passing under the stack: the run ends at it (they stay put).
		expect(runEnd(180, -600, 900, [row(-50, 400)])).toBe(-50);
	});
});
