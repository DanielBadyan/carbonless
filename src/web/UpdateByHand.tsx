import { QuestionIcon } from "@primer/octicons-react";
import type { UpdateInfo } from "../shared/update";
import { Tooltip } from "./Tooltip";

/** The FAQ on GitHub: crb has no docs site, and the repo is public. */
export const FAQ_URL =
	"https://github.com/Gilthans/carbonless/blob/master/docs/faq.md";

/**
 * docs/faq.md's sections on updating by hand, as GitHub anchors its
 * headings (githubSlug; UpdateByHand.test.ts checks each is there).
 */
export const BY_HAND_FAQ = {
	top: "why-does-crb-show-an-update-command-instead-of-an-update-button",
	"no-install": "not-an-npm-or-pnpm-global-install",
	"not-writable": "installed-in-a-folder-crb-cant-write",
	systemd: "systemd-wont-restart-crb",
	pid1: "crb-is-a-containers-pid-1",
} as const;

/** A heading's anchor as GitHub makes it. */
export function githubSlug(heading: string): string {
	return heading
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N} _-]/gu, "")
		.replace(/ /g, "-");
}

type Why = Pick<UpdateInfo, "byHandReason" | "byHandManager">;

/**
 * Why crb can't update itself, in a few words, and the FAQ section on
 * setting it up so it can: the toast and the Global settings page both
 * read it here, so they never disagree. null: crb updates itself.
 */
export function byHandWhy(info: Why): { text: string; href: string } | null {
	const at = (anchor: string) => `${FAQ_URL}#${anchor}`;
	switch (info.byHandReason) {
		case null:
			return null;
		case "no-install":
			return {
				text: "not an npm/pnpm global install",
				href: at(BY_HAND_FAQ["no-install"]),
			};
		case "not-writable":
			return {
				text: "installed in a folder crb can't write",
				href: at(BY_HAND_FAQ["not-writable"]),
			};
		case "service": {
			const manager = info.byHandManager;
			if (manager === "PID 1") {
				return {
					text: "crb is PID 1, nothing restarts it",
					href: at(BY_HAND_FAQ.pid1),
				};
			}
			if (manager?.startsWith("systemd")) {
				return {
					text: `${manager} won't restart crb`,
					href: at(BY_HAND_FAQ.systemd),
				};
			}
			return {
				text: `${manager ?? "its service"} won't restart crb`,
				href: at(BY_HAND_FAQ.top),
			};
		}
	}
}

/**
 * "<prefix>: <why>" on one line (truncated where it doesn't fit, the whole
 * of it in a tooltip, a tap's too) and a help icon linking to the FAQ.
 */
export function ByHandWhy(props: {
	info: Why;
	prefix: string;
	className?: string;
}) {
	const why = byHandWhy(props.info);
	if (!why) return null;
	const line = `${props.prefix}: ${why.text}`;
	return (
		<span
			data-testid="update-by-hand"
			className={`flex min-w-0 items-center gap-1 ${props.className ?? ""}`}
		>
			<Tooltip content={line} describe={false}>
				{(trigger) => (
					<span
						{...trigger}
						// Focusable so a tap or a key opens the whole line when it's cut.
						// biome-ignore lint/a11y/noNoninteractiveTabindex: the tooltip opens on focus.
						tabIndex={0}
						className="min-w-0 truncate rounded-sm focus-visible:outline-2 focus-visible:outline-accent"
					>
						{line}
					</span>
				)}
			</Tooltip>
			<Tooltip content="How to set up updates" describe={false}>
				{(trigger) => (
					<a
						{...trigger}
						href={why.href}
						target="_blank"
						rel="noreferrer"
						aria-label="How to set up updates"
						className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-link hover:bg-pressed focus-visible:outline-2 focus-visible:outline-accent"
					>
						<QuestionIcon size={16} aria-hidden />
					</a>
				)}
			</Tooltip>
		</span>
	);
}
