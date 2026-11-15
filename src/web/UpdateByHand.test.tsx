// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BY_HAND_FAQ, ByHandWhy, byHandWhy, githubSlug } from "./UpdateByHand";

afterEach(cleanup);

const FAQ = "https://github.com/Gilthans/carbonless/blob/master/docs/faq.md";

describe("byHandWhy", () => {
	it("each reason: its few words and its FAQ section", () => {
		expect(byHandWhy({ byHandReason: null, byHandManager: null })).toBeNull();
		expect(
			byHandWhy({ byHandReason: "no-install", byHandManager: null }),
		).toEqual({
			text: "not an npm/pnpm global install",
			href: `${FAQ}#not-an-npm-or-pnpm-global-install`,
		});
		expect(
			byHandWhy({ byHandReason: "not-writable", byHandManager: null }),
		).toEqual({
			text: "installed in a folder crb can't write",
			href: `${FAQ}#installed-in-a-folder-crb-cant-write`,
		});
		expect(
			byHandWhy({
				byHandReason: "service",
				byHandManager: "systemd (crb.service)",
			}),
		).toEqual({
			text: "systemd (crb.service) won't restart crb",
			href: `${FAQ}#systemd-wont-restart-crb`,
		});
		expect(
			byHandWhy({ byHandReason: "service", byHandManager: "PID 1" }),
		).toEqual({
			text: "crb is PID 1, nothing restarts it",
			href: `${FAQ}#crb-is-a-containers-pid-1`,
		});
		// A manager this page doesn't know: the section's top.
		expect(byHandWhy({ byHandReason: "service", byHandManager: null })).toEqual(
			{
				text: "its service won't restart crb",
				href: `${FAQ}#why-does-crb-show-an-update-command-instead-of-an-update-button`,
			},
		);
	});

	it("every anchor is a heading of docs/faq.md, as GitHub spells it", () => {
		const faq = readFileSync(
			join(import.meta.dirname, "../../docs/faq.md"),
			"utf8",
		);
		const slugs = new Set(
			faq
				.split("\n")
				.filter((l) => /^#{1,6} /.test(l))
				.map((l) => githubSlug(l.replace(/^#+ /, ""))),
		);
		for (const anchor of Object.values(BY_HAND_FAQ)) {
			expect(slugs, anchor).toContain(anchor);
		}
		expect(githubSlug("Why can't `crb` write: a/b?")).toBe(
			"why-cant-crb-write-ab",
		);
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
		expect(
			screen.getByTestId("update-by-hand").querySelector("img"),
		).toBeNull();
		expect(screen.getByTestId("update-by-hand")).toHaveTextContent(
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
