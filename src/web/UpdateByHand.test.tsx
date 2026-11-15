// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
	BY_HAND_FAQ,
	ByHandWhy,
	byHandWhy,
	faqSlugs,
	githubSlug,
} from "./UpdateByHand";

afterEach(cleanup);

const FAQ = "https://github.com/Gilthans/carbonless/blob/master/docs/faq.md";

describe("byHandWhy", () => {
	it("each reason: its few words (no unit name: they fit a phone), the detail, and its FAQ section", () => {
		expect(byHandWhy({ byHandReason: null, byHandManager: null })).toBeNull();
		expect(
			byHandWhy({ byHandReason: "no-install", byHandManager: null }),
		).toEqual({
			text: "not an npm/pnpm global install",
			detail: "not an npm/pnpm global install",
			href: `${FAQ}#not-an-npm-or-pnpm-global-install`,
		});
		expect(
			byHandWhy({ byHandReason: "not-writable", byHandManager: null }),
		).toEqual({
			text: "installed in a folder crb can't write",
			detail: "installed in a folder crb can't write",
			href: `${FAQ}#installed-in-a-folder-crb-cant-write`,
		});
		expect(
			byHandWhy({
				byHandReason: "service",
				byHandManager: "systemd (crb.service)",
			}),
		).toEqual({
			text: "systemd won't restart crb",
			detail: "systemd (crb.service) won't restart crb",
			href: `${FAQ}#systemd-wont-restart-crb`,
		});
		expect(
			byHandWhy({ byHandReason: "service", byHandManager: "PID 1" }),
		).toEqual({
			text: "crb is PID 1, nothing restarts it",
			detail: "crb is PID 1, nothing restarts it",
			href: `${FAQ}#crb-is-a-containers-pid-1`,
		});
		// A manager this page doesn't know: the section's top.
		expect(
			byHandWhy({ byHandReason: "service", byHandManager: "runit" }),
		).toEqual({
			text: "its service won't restart crb",
			detail: "runit won't restart crb",
			href: `${FAQ}#why-does-crb-show-an-update-command-instead-of-an-update-button`,
		});
		expect(
			byHandWhy({ byHandReason: "service", byHandManager: null })?.detail,
		).toBe("its service won't restart crb");
	});

	it("every anchor is a heading of docs/faq.md, as GitHub spells it", () => {
		const faq = readFileSync(
			join(import.meta.dirname, "../../docs/faq.md"),
			"utf8",
		);
		const slugs = faqSlugs(faq);
		for (const anchor of Object.values(BY_HAND_FAQ)) {
			expect(slugs, anchor).toContain(anchor);
		}
		expect(githubSlug("Why can't `crb` write: a/b?")).toBe(
			"why-cant-crb-write-ab",
		);
	});

	it("headings as GitHub anchors them: none inside fenced code, a repeat gets -1", () => {
		expect(
			faqSlugs(
				[
					"# Top",
					"```sh",
					"# Not a heading",
					"```",
					"~~~",
					"## Nor this",
					"~~~",
					"## Top",
					"### Top",
				].join("\n"),
			),
		).toEqual(["top", "top-1", "top-2"]);
	});
});

describe("ByHandWhy", () => {
	it("the reason after its prefix, and a help link to the FAQ section", () => {
		render(
			<ByHandWhy
				prefix="No auto-update"
				info={{ byHandReason: "not-writable", byHandManager: null }}
			/>,
		);
		expect(screen.getByTestId("update-by-hand")).toHaveTextContent(
			"No auto-update: installed in a folder crb can't write",
		);
		const link = screen.getByRole("link", { name: "How to set up updates" });
		expect(link).toHaveAttribute(
			"href",
			`${FAQ}#installed-in-a-folder-crb-cant-write`,
		);
		expect(link).toHaveAttribute("target", "_blank");
		expect(link).toHaveAttribute("rel", "noreferrer");
		// Nothing more to tell: no focus stop for a tip.
		expect(
			screen.getByTestId("update-by-hand-text").getAttribute("tabindex"),
		).toBeNull();
	});

	it("a service's unit name: in the tip (a tap or a key opens it) and the description, not the line", () => {
		render(
			<ByHandWhy
				prefix="No auto-update"
				info={{
					byHandReason: "service",
					byHandManager: "systemd (crb.service)",
				}}
			/>,
		);
		const text = screen.getByTestId("update-by-hand-text");
		expect(text).toHaveTextContent(
			/^No auto-update: systemd won't restart crb$/,
		);
		expect(text).toHaveAttribute("tabindex", "0");
		act(() => text.focus());
		expect(screen.getByRole("tooltip")).toHaveTextContent(
			"No auto-update: systemd (crb.service) won't restart crb",
		);
		expect(text).toHaveAccessibleDescription(
			"No auto-update: systemd (crb.service) won't restart crb",
		);
	});

	it("a manager's name is text, never markup", () => {
		render(
			<ByHandWhy
				prefix="No auto-update"
				info={{
					byHandReason: "service",
					byHandManager: 'systemd (<img src=x onerror="alert(1)">.service)',
				}}
			/>,
		);
		act(() => screen.getByTestId("update-by-hand-text").focus());
		expect(document.querySelector("img")).toBeNull();
		expect(screen.getByRole("tooltip")).toHaveTextContent(
			'systemd (<img src=x onerror="alert(1)">.service) won\'t restart crb',
		);
	});

	it("nothing when crb updates itself", () => {
		const { container } = render(
			<ByHandWhy
				prefix="No auto-update"
				info={{ byHandReason: null, byHandManager: null }}
			/>,
		);
		expect(container).toBeEmptyDOMElement();
	});
});
