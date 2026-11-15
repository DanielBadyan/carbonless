import type { Locator } from "@playwright/test";
import { reviewThread, threadComment } from "../test/fake-gh/scenario";
import {
	expectNoPageOverflow,
	fileSection,
	openFiles,
	sideBySide,
	tapHeight,
	tapWidth,
	underStack,
} from "./files-ui";
import { expect, type Pr, type PrOptions, test } from "./fixtures";

/**
 * A long line makes the diff scroll sideways. The whole row scrolls (rail,
 * controls, numbers and code: the code gets the full width), and only a
 * cluster's checkbox and cross-off float at the visible left edge of the
 * code while their slot is scrolled past it (stickyControls.ts), at its
 * top-left corner while they float under the file header too. The leading
 * columns tighten when the diff is narrow, and on a phone.
 */

/** DESIGN_SHOTS=<dir>: also save gutter-{chromium,phone}-*.png there. */
const shots = process.env.DESIGN_SHOTS;

const text = (lines: string[]) => `${lines.join("\n")}\n`;
const WIDE = "src/wide.ts";
// Renamed in the PR: a file cluster's label row above its hunk.
const WIDE_WAS = "src/old-wide.ts";
const lines = Array.from({ length: 14 }, (_, i) =>
	i === 4 ? `const wide5 = "${"wide ".repeat(80)}";` : `wide ${i + 1}`,
);
const SHORT = "src/short.ts";
const short = Array.from({ length: 8 }, (_, i) => `short ${i + 1}`);
const fixture: PrOptions = {
	base: { [WIDE_WAS]: text(lines), [SHORT]: text(short) },
	files: [
		{
			message: "PR change",
			rename: { [WIDE_WAS]: WIDE },
			files: {
				[WIDE]: text(lines.map((l, i) => (i === 2 ? "wide 3 changed" : l))),
				[SHORT]: text(short.map((l, i) => (i === 3 ? "short 4 changed" : l))),
			},
		},
	],
};

/** The fixture's PR with one thread on new line 4 of the wide file, on the head. */
async function setup(pr: (opts?: PrOptions) => Promise<Pr>) {
	const p = await pr(fixture);
	const head = p.repo.shas.at(-1) ?? "";
	p.editScenario((s) => {
		const graph = s.prs[p.number]?.graphql;
		if (!graph) throw new Error("no PR in the scenario");
		graph.reviewThreads = [
			reviewThread({ path: WIDE, line: 4, subjectType: "LINE" }, [
				threadComment({
					login: "ann",
					text: "Why four?",
					commit: head,
					diffHunk: "",
				}),
			]),
		];
	});
	return p;
}

/** The open file's diff scroller (not its path scroller). */
const diffScroller = (section: Locator) =>
	section.locator("div.overflow-x-auto:has(table)");

const x = async (l: Locator) => {
	const b = await l.boundingBox();
	if (!b) throw new Error("not rendered");
	return b.x;
};

/** Every cell's x, in table order, by the names given. */
async function xs(cells: Record<string, Locator>) {
	const out: Record<string, number> = {};
	for (const [name, cell] of Object.entries(cells)) out[name] = await x(cell);
	return out;
}

/** The row's cells start where the one before ends: no gap, no overlap. */
async function expectAdjacent(row: Locator) {
	const gaps = await row.evaluate((tr) => {
		const rects = [...tr.children].map((td) => td.getBoundingClientRect());
		return rects.slice(1).map((r, i) => r.left - (rects[i]?.right ?? 0));
	});
	for (const gap of gaps) expect(Math.abs(gap)).toBeLessThan(0.5);
}

/**
 * One tall cluster of added lines in a file with a long line: tall enough
 * for its controls to float under the file header too.
 */
const TALL = "src/tall.ts";
const tallBase = Array.from({ length: 12 }, (_, i) =>
	i === 2 ? `const tall3 = "${"tall ".repeat(80)}";` : `tall ${i + 1}`,
);
const tallFixture: PrOptions = {
	base: { [TALL]: text(tallBase) },
	files: [
		{
			message: "Tall",
			files: {
				[TALL]: text([
					...tallBase.slice(0, 2),
					...Array.from({ length: 40 }, (_, i) => `added ${i + 1}`),
					...tallBase.slice(2, -1),
					// A second cluster: marking the first doesn't finish the file.
					"tall 12 changed",
				]),
			},
		},
	],
};

/** What a click or tap at the element's centre hits is the element (or in it). */
const onTop = (l: Locator) =>
	l.evaluate((el) => {
		const b = el.getBoundingClientRect();
		const hit = document.elementFromPoint(
			b.left + b.width / 2,
			b.top + b.height / 2,
		);
		return hit !== null && el.contains(hit);
	});

test("scrolled sideways, the row scrolls whole and only the cluster's controls float at the code's left edge", async ({
	page,
	pr,
	startCrb,
	isMobile,
}, testInfo) => {
	await pr(tallFixture);
	const s = await startCrb();
	await openFiles(page, s.url);
	const section = fileSection(page, TALL);
	await section.getByRole("button", { name: "Expand file" }).click();
	const line = (n: number) =>
		section.locator(`tr[data-testid="diff-line"][data-new-no="${n}"]`);
	// The cluster's first row holds its controls.
	const first = line(3);
	await expect(first).toHaveAttribute("data-kind", "add");
	const slot = first.locator("[data-sticky-slot]");
	const controls = first.locator("[data-sticky-controls]");
	const box = first.getByTestId("cluster-box-target");
	// Named for what it does next: no name, so it's found checked too.
	const checkbox = first.getByRole("checkbox");
	const cross = first.getByRole("button", { name: "Cross off cluster" });
	const tap = async (l: Locator) => {
		if (isMobile) await l.tap();
		else await l.click();
	};
	const shot = async (name: string) => {
		if (shots) {
			await page.screenshot({
				path: `${shots}/gutter-${testInfo.project.name}-${name}.png`,
			});
		}
	};
	// Clear of the sticky header and of what floats at the viewport's bottom.
	await first.evaluate((el) => el.scrollIntoView({ block: "center" }));
	const scroller = diffScroller(section);
	const edge = await x(scroller);
	const cells = {
		rail: first.locator("td").first(),
		controls: first.locator("td").nth(1),
		old: first.getByTestId("old"),
		new: first.getByTestId("new"),
		code: first.getByTestId("code"),
	};
	const before = await xs(cells);
	const slotX = await x(slot);
	expect(await x(controls)).toBeCloseTo(slotX, 0);
	await expect(controls).not.toHaveAttribute("data-stuck");

	await scroller.evaluate((el) => {
		el.scrollLeft = 120;
	});
	await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBe(120);
	// Nothing is pinned: every cell moved with the code.
	const after = await xs(cells);
	for (const [name, at] of Object.entries(before)) {
		expect(after[name], name).toBeCloseTo(at - 120, 0);
	}
	// The controls float at the code's visible left edge, in their row.
	await expect(controls).toHaveAttribute("data-stuck", "shift");
	await expect(box).toBeVisible();
	await expect
		.poll(async () => Math.abs((await x(controls)) - edge))
		.toBeLessThan(4);
	const row = await first.boundingBox();
	const c = await controls.boundingBox();
	if (!row || !c) throw new Error("not rendered");
	// In their row (on touch the cross-off is stacked under it, as unscrolled).
	expect(c.y).toBeGreaterThanOrEqual(row.y - 1);
	expect(c.y).toBeLessThan(row.y + row.height);
	// What a tap there hits is the control, not the code under it.
	expect(await onTop(box)).toBe(true);
	expect(await onTop(cross)).toBe(true);
	const crossX = await x(cross);
	expect(crossX).toBeGreaterThanOrEqual(edge);
	expect(crossX).toBeLessThan(edge + 60);
	if (isMobile) {
		for (const target of [box, cross]) {
			expect(await tapWidth(target)).toBeGreaterThanOrEqual(40);
			expect(await tapHeight(target)).toBeGreaterThanOrEqual(40);
		}
	}
	await shot("sideways");
	// They work where they float.
	await tap(box);
	await expect(checkbox).toBeChecked();
	await expect(first).toHaveAttribute("data-reviewed", "true");
	await tap(box);
	await expect(checkbox).not.toBeChecked();
	await tap(cross);
	await expect(cross).toHaveAttribute("aria-pressed", "true");
	await tap(cross);
	await expect(cross).toHaveAttribute("aria-pressed", "false");
	// And from the keyboard: Space on the focused box.
	if (!isMobile) {
		await checkbox.focus();
		await page.keyboard.press("Space");
		await expect(checkbox).toBeChecked();
		await page.keyboard.press("Space");
		await expect(checkbox).not.toBeChecked();
	}
	expect(await scroller.evaluate((el) => el.scrollLeft)).toBe(120);
	await expectNoPageOverflow(page);

	// Down the cluster, under the file header: the top-left corner of the code.
	await underStack(line(20));
	await expect(controls).toHaveAttribute("data-stuck", "fixed");
	const header = await section.locator(":scope > header").boundingBox();
	const corner = await controls.boundingBox();
	if (!header || !corner) throw new Error("not rendered");
	expect(Math.abs(corner.x - edge)).toBeLessThan(4);
	expect(corner.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
	expect(corner.y).toBeLessThan(header.y + header.height + 16);
	expect(await onTop(box)).toBe(true);
	await shot("sideways-down");
	await tap(box);
	await expect(checkbox).toBeChecked();
	await tap(box);
	await expect(checkbox).not.toBeChecked();
	await expectNoPageOverflow(page);
	// Unscrolled sideways, they float at the slot's x again, as before.
	await scroller.evaluate((el) => {
		el.scrollLeft = 0;
	});
	await expect
		.poll(async () => Math.abs((await x(controls)) - slotX))
		.toBeLessThan(1);

	// Back in view and unscrolled: in their slot, exactly as they were.
	await first.evaluate((el) => el.scrollIntoView({ block: "center" }));
	await expect(controls).not.toHaveAttribute("data-stuck");
	expect(await x(controls)).toBe(await x(slot));
	expect(await xs(cells)).toEqual(before);
});

test("on the narrowest phone, the floating controls never make the page scroll sideways", async ({
	page,
	pr,
	startCrb,
	isMobile,
}, testInfo) => {
	test.skip(!isMobile, "a phone's width");
	await page.setViewportSize({ width: 360, height: 780 });
	await pr(tallFixture);
	const s = await startCrb();
	await openFiles(page, s.url);
	const section = fileSection(page, TALL);
	await section.getByRole("button", { name: "Expand file" }).click();
	const line = (n: number) =>
		section.locator(`tr[data-testid="diff-line"][data-new-no="${n}"]`);
	const first = line(3);
	const controls = first.locator("[data-sticky-controls]");
	const box = first.getByTestId("cluster-box-target");
	const shot = async (name: string) => {
		if (shots) {
			await page.screenshot({
				path: `${shots}/gutter-${testInfo.project.name}-${name}.png`,
			});
		}
	};
	await first.evaluate((el) => el.scrollIntoView({ block: "center" }));
	const scroller = diffScroller(section);
	await scroller.evaluate((el) => {
		el.scrollLeft = 120;
	});
	await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBe(120);
	await expect(controls).toHaveAttribute("data-stuck", "shift");
	const edge = await x(scroller);
	await expect
		.poll(async () => Math.abs((await x(controls)) - edge))
		.toBeLessThan(4);
	expect(await tapWidth(box)).toBeGreaterThanOrEqual(40);
	expect(await tapHeight(box)).toBeGreaterThanOrEqual(40);
	await expectNoPageOverflow(page);
	await shot("360-sideways");
	await underStack(line(20));
	await expect(controls).toHaveAttribute("data-stuck", "fixed");
	await expectNoPageOverflow(page);
	await shot("360-sideways-down");
});

test("a file that doesn't scroll sideways lays its cells out edge to edge", async ({
	page,
	pr,
	startCrb,
}) => {
	await setup(pr);
	const s = await startCrb();
	await openFiles(page, s.url);
	const other = fileSection(page, SHORT);
	await other.getByRole("button", { name: "Expand file" }).click();
	const otherRow = other.locator(
		'tr[data-testid="diff-line"][data-kind="add"]',
	);
	await expect(otherRow).toHaveCount(1);
	expect(
		await diffScroller(other).evaluate(
			(el) => el.scrollWidth <= el.clientWidth,
		),
	).toBe(true);
	await expectAdjacent(otherRow);
	await expectAdjacent(other.locator("tbody.group > tr").first());
	await expect(other.locator("[data-stuck]")).toHaveCount(0);
});

/** A cell's width and left padding, in px. */
const metrics = (cell: Locator) =>
	cell.evaluate((el) => {
		const css = getComputedStyle(el);
		return {
			width: el.getBoundingClientRect().width,
			pad: Number.parseFloat(css.paddingLeft),
		};
	});

test("a narrow diff (the tree dragged wide) tightens the leading columns; with room they stay roomy", async ({
	page,
	pr,
	startCrb,
	isMobile,
}) => {
	test.skip(isMobile, "a phone is cramped by itself (the next test)");
	await setup(pr);
	const s = await startCrb();
	const cells = async () => {
		const section = fileSection(page, WIDE);
		await section.getByRole("button", { name: "Expand file" }).click();
		const row = section.locator('tr[data-testid="diff-line"][data-new-no="4"]');
		await expect(row).toBeVisible();
		return {
			section,
			row,
			controls: row.locator("td").nth(1),
			old: row.getByTestId("old"),
			new: row.getByTestId("new"),
			sign: row.getByTestId("code").locator("> span[aria-hidden]").first(),
		};
	};
	// With room (the default tree width): the roomy layout.
	await openFiles(page, s.url);
	const roomy = await cells();
	expect(await metrics(roomy.controls)).toEqual({ width: 44, pad: 4 });
	const roomyNumber = await metrics(roomy.old);
	expect(roomyNumber.pad).toBe(8);
	expect(await metrics(roomy.new)).toEqual(roomyNumber);
	expect(
		await roomy.sign.evaluate((el) => getComputedStyle(el).marginRight),
	).toBe("8px");
	expect(
		await roomy.section.locator("table").getAttribute("data-tight"),
	).toBeNull();

	// The tree dragged wide: the diff's box is narrow, so the columns tighten.
	await page.evaluate(() => localStorage.setItem("crb.files.treeWidth", "700"));
	await page.reload();
	await expect(fileSection(page, WIDE)).toBeVisible();
	const tight = await cells();
	const scroller = diffScroller(tight.section);
	expect(await scroller.evaluate((el) => el.clientWidth)).toBeLessThan(640);
	await expect(tight.section.locator("table")).toHaveAttribute(
		"data-tight",
		"true",
	);
	expect(await metrics(tight.controls)).toEqual({ width: 38, pad: 2 });
	const tightNumber = await metrics(tight.old);
	expect(tightNumber.pad).toBe(4);
	expect(tightNumber.width).toBeCloseTo(roomyNumber.width - 8, 0);
	expect(await metrics(tight.new)).toEqual(tightNumber);
	expect(
		await tight.sign.evaluate((el) => getComputedStyle(el).marginRight),
	).toBe("4px");
});

test("a phone is cramped: a narrow leading block whose controls and numbers still take a tap", async ({
	page,
	pr,
	startCrb,
	isMobile,
}) => {
	test.skip(!isMobile, "touch targets");
	await setup(pr);
	const s = await startCrb();
	await openFiles(page, s.url);
	const section = fileSection(page, WIDE);
	await section.getByRole("button", { name: "Expand file" }).click();
	const row = section.locator('tr[data-testid="diff-line"][data-new-no="4"]');
	await expect(row).toBeVisible();
	await expect(section.locator("table")).toHaveAttribute("data-tight", "true");
	// Rail, controls and both numbers of a 3-digit file: well under 120px.
	const rail = await row.locator("td").first().boundingBox();
	const last = await row.getByTestId("new").boundingBox();
	if (!rail || !last) throw new Error("not rendered");
	expect(last.x + last.width - rail.x).toBeLessThan(120);
	// The numbers together are the pick's target, 40px wide at least.
	const old = await row.getByTestId("old").boundingBox();
	if (!old) throw new Error("not rendered");
	expect(last.x + last.width - old.x).toBeGreaterThanOrEqual(40);

	// The two controls' 40px targets, by what a tap would hit.
	// On the cluster's first row, the deleted line (the file cluster above
	// has its own).
	const lines = section.locator('tr[data-testid="diff-line"]');
	const boxTarget = lines.getByTestId("cluster-box-target");
	const cross = lines.getByRole("button", { name: "Cross off cluster" });
	for (const target of [boxTarget, cross]) {
		expect(await tapWidth(target)).toBeGreaterThanOrEqual(40);
		expect(await tapHeight(target)).toBeGreaterThanOrEqual(40);
	}
	const b = await boxTarget.boundingBox();
	if (!b) throw new Error("not rendered");
	await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
	await expect(
		lines.getByRole("checkbox", { name: "Mark cluster reviewed" }),
	).toBeChecked();
	// A tap on either number picks the line.
	await row.getByTestId("old").tap();
	await expect(row).toHaveAttribute("data-picked", "true");
	await page.keyboard.press("Escape");
	await expect(section.locator("tr[data-picked]")).toHaveCount(0);
	await row.getByTestId("new").tap();
	await expect(row).toHaveAttribute("data-picked", "true");
	await expectNoPageOverflow(page);
});

/** A file whose gaps get two and three stacked arrows. */
const GAPS = "src/gaps.ts";
const gapsBase = Array.from({ length: 60 }, (_, i) =>
	i === 4 ? `const w5 = "${"gap ".repeat(80)}";` : `gap ${i + 1}`,
);
const gapsFixture: PrOptions = {
	base: { [GAPS]: text(gapsBase) },
	files: [
		{
			message: "Gaps",
			files: {
				[GAPS]: text(
					gapsBase.map((l, i) => (i === 4 || i === 44 ? `${l} changed` : l)),
				),
			},
		},
	],
};

test("a gap's arrows fit the rail and controls columns", async ({
	page,
	pr,
	startCrb,
}) => {
	await pr(gapsFixture);
	const s = await startCrb();
	await openFiles(page, s.url);
	const section = fileSection(page, GAPS);
	await section.getByRole("button", { name: "Expand file" }).click();
	const row = section.locator(
		'tr[data-testid="diff-line"][data-kind="add"][data-new-no="5"]',
	);
	await expect(row).toBeVisible();
	// The gaps' arrows (stacked where there are two or three) sit in the
	// rail and controls: the columns after them start where every line's do.
	const lineNumberX = await x(row.getByTestId("old"));
	const gaps = await section.getByTestId("gap-row").evaluateAll((rows) =>
		rows.map((tr) => ({
			arrows: tr.querySelectorAll("button[data-glyph]").length,
			end: tr.children[0]?.getBoundingClientRect().right ?? Number.NaN,
		})),
	);
	expect(Math.max(...gaps.map((g) => g.arrows))).toBeGreaterThan(1);
	for (const g of gaps) expect(g.end).toBeCloseTo(lineNumberX, 0);
});

/**
 * On touch a cluster's cross-off is stacked under its box, reaching into
 * the rows below its line: never over an opened thread's card there.
 */
test("a touch cluster's cross-off never covers the thread card under its line", async ({
	page,
	pr,
	startCrb,
	isMobile,
}) => {
	test.skip(!isMobile, "the stacked controls are touch only");
	const p = await pr(fixture);
	const head = p.repo.shas.at(-1) ?? "";
	p.editScenario((sc) => {
		const graph = sc.prs[p.number]?.graphql;
		if (!graph) throw new Error("no PR in the scenario");
		graph.reviewThreads = [
			// On the deleted line: the cluster's first row, where its controls are.
			reviewThread(
				{ path: WIDE, line: 3, diffSide: "LEFT", subjectType: "LINE" },
				[
					threadComment({
						login: "ann",
						text: "Why three?",
						commit: head,
						diffHunk: "",
					}),
				],
			),
		];
	});
	const s = await startCrb();
	await openFiles(page, s.url);
	const section = fileSection(page, WIDE);
	await section.getByRole("button", { name: "Expand file" }).click();
	const first = section.locator(
		'tr[data-testid="diff-line"][data-kind="del"][data-old-no="3"]',
	);
	await expect(first.getByTestId("cluster-box-target")).toBeVisible();
	await first.getByRole("button", { name: /1 comment on/ }).tap();
	const card = section.getByTestId("thread-row");
	await expect(card).toBeVisible();
	// The cross-off reaches into the card's rows...
	const cross = await first
		.getByRole("button", { name: "Cross off cluster" })
		.boundingBox();
	const box = await card.boundingBox();
	if (!cross || !box) throw new Error("not rendered");
	expect(cross.y + cross.height).toBeGreaterThan(box.y);
	// ...but where they meet, the card is on top.
	const under = await card.evaluate(
		(el, c) => {
			const out: string[] = [];
			const top = el.getBoundingClientRect().top;
			for (let y = top + 1; y < c.y + c.height; y += 4) {
				for (let x = c.x + 2; x < c.x + c.width; x += 6) {
					const hit = document.elementFromPoint(x, y);
					if (!hit || !el.contains(hit)) {
						out.push(`${x},${y}: ${hit?.tagName ?? "nothing"}`);
					}
				}
			}
			return out;
		},
		{ x: cross.x, y: cross.y, width: cross.width, height: cross.height },
	);
	expect(under).toEqual([]);
});

/**
 * Side by side on a phone, the bubbles get rows of their own: while a
 * cluster's controls float over its lines, those rows pass under them.
 */
const MANY = "src/many.ts";
const manyFixture: PrOptions = {
	base: { [MANY]: text(["many 0"]) },
	files: [
		{
			message: "Many",
			files: {
				[MANY]: text([
					"many 0",
					...Array.from({ length: 40 }, (_, i) => `many ${i + 1}`),
				]),
			},
		},
	],
};

test("side by side on a phone, the floating cluster controls stay above the bubble rows", async ({
	page,
	pr,
	startCrb,
	isMobile,
}) => {
	test.skip(!isMobile, "bubble rows are a phone's");
	const p = await pr(manyFixture);
	const head = p.repo.shas.at(-1) ?? "";
	p.editScenario((sc) => {
		const graph = sc.prs[p.number]?.graphql;
		if (!graph) throw new Error("no PR in the scenario");
		// A thread on every added line: a bubble row under each.
		graph.reviewThreads = Array.from({ length: 40 }, (_, i) =>
			reviewThread({ path: MANY, line: i + 2, subjectType: "LINE" }, [
				threadComment({
					login: "ann",
					text: `Line ${i + 2}?`,
					commit: head,
					diffHunk: "",
				}),
			]),
		);
	});
	const s = await startCrb();
	await openFiles(page, s.url);
	await sideBySide(page, true);
	await page.keyboard.press("Escape");
	const section = fileSection(page, MANY);
	await section.getByRole("button", { name: "Expand file" }).click();
	await expect(section.getByTestId("bubble-row")).toHaveCount(40);
	// The cluster's first line scrolled under the header: its controls float.
	await section
		.locator('tr[data-testid="diff-line"][data-new-no="20"]')
		.evaluate((el) => el.scrollIntoView({ block: "start" }));
	const controls = section.locator("[data-sticky-controls][data-stuck]");
	await expect(controls).toHaveAttribute("data-stuck", "fixed");
	const c = await controls.boundingBox();
	if (!c) throw new Error("not rendered");
	// A bubble row passes under them...
	const rows = await section.getByTestId("bubble-row").evaluateAll((trs) =>
		trs.map((tr) => {
			const r = tr.getBoundingClientRect();
			return { top: r.top, bottom: r.bottom };
		}),
	);
	expect(rows.some((r) => r.top < c.y + c.height && r.bottom > c.y)).toBe(true);
	// ...and all over the floating box, the controls are on top.
	const off = await controls.evaluate((el) => {
		const r = el.getBoundingClientRect();
		const out: string[] = [];
		for (let y = r.top + 2; y < r.bottom - 1; y += 4) {
			for (let x = r.left + 2; x < r.right - 1; x += 6) {
				const hit = document.elementFromPoint(x, y);
				if (!hit || !el.contains(hit)) {
					out.push(`${x},${y}: ${hit?.tagName ?? "nothing"}`);
				}
			}
		}
		return out;
	});
	expect(off).toEqual([]);
});
