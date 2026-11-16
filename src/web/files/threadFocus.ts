import {
	type RefObject,
	useEffect,
	useState,
	useSyncExternalStore,
} from "react";
import { usePageActive } from "../pageActive";
import { stickyBottom } from "./scrollAnchor";

/**
 * The one way a conversation's card is asked to show: a Threads tab row,
 * and a link to an agent conversation (a citation, Go to your request, a
 * Started row; conversationLinks.ts) alike. Whatever holds the card opens
 * (a line's or a hidden run's bubble, the file bubble, a collapsed card,
 * a review thread's agent panel), and the card scrolls in just below the
 * sticky stack; a message named is outlined for a moment.
 *
 * A request lasts until a card on screen takes it, however long the page
 * takes to place it (no timer), and no longer than the reviewer stays: it
 * is dropped on a move to another page (and coming back doesn't bring it
 * back), and the page cancels it on any other navigation there (another
 * pick, a find step, a link, a file opened or closed; a row's also on
 * another comparison or read: its `scope`). A new request replaces the
 * last, so the same row again still scrolls.
 */
export interface ThreadFocus {
	seq: number;
	/** The card's id: a review thread's (GitHub's), or an agent thread's. */
	id: string;
	/** An agent conversation that opens too: in its review thread's panel, or its own card. */
	conversation?: string;
	/** A message of that conversation to outline. */
	message?: string;
	/** What the request was made in (a row's comparison); none for a link. */
	scope?: string;
}

/** The message a request landed on, outlined once its card took it. */
export interface Outline {
	message: string;
	seq: number;
}

let current: ThreadFocus | null = null;
/** The page path the request was made on: dropped once the reviewer leaves it. */
let requestPath: string | null = null;
let outline: Outline | null = null;
let lastSeq = 0;
const listeners = new Set<() => void>();
const notify = () => {
	for (const l of listeners) l();
};
const currentPath = () =>
	typeof window === "undefined" ? "" : window.location.pathname;

/** The request still pending here, or null (dropped once the path changed). */
function pending(): ThreadFocus | null {
	const snapshot = current;
	if (!snapshot) return null;
	if (requestPath !== currentPath()) {
		// Read during render: dropped just after it, so coming back to that
		// page never brings it back.
		queueMicrotask(() => {
			if (current !== snapshot || requestPath === currentPath()) return;
			current = null;
			notify();
		});
		return null;
	}
	return snapshot;
}

export const threadFocus = {
	request(target: {
		id: string;
		conversation?: string;
		message?: string;
		scope?: string;
	}): ThreadFocus {
		lastSeq += 1;
		current = {
			seq: lastSeq,
			id: target.id,
			...(target.conversation ? { conversation: target.conversation } : {}),
			...(target.message ? { message: target.message } : {}),
			...(target.scope !== undefined ? { scope: target.scope } : {}),
		};
		requestPath = currentPath();
		notify();
		return current;
	},
	/** The pending request, if any, on the path it was made on. */
	get: pending,
	/** Ends request `seq`: its card took it; its message, if any, is outlined. */
	taken(seq: number) {
		if (current?.seq !== seq) return;
		if (current.message) outline = { message: current.message, seq };
		current = null;
		notify();
	},
	/** Ends any pending request: the reviewer went elsewhere. */
	cancel() {
		if (current === null) return;
		current = null;
		notify();
	},
	/** Ends a pending request made in another scope than `scope` (a row's, in another comparison). */
	cancelOutside(scope: string) {
		if (current?.scope === undefined || current.scope === scope) return;
		current = null;
		notify();
	},
	/** The last message outlined. */
	outline: () => outline,
	/** Its outline shown: it doesn't light again on a later mount. */
	outlined(seq: number) {
		if (outline?.seq !== seq) return;
		outline = null;
		notify();
	},
	/** The newest request's number, pending or taken. */
	latest: () => lastSeq,
	/** Forgets everything (tests). */
	reset() {
		current = null;
		requestPath = null;
		outline = null;
		notify();
	},
	subscribe(listener: () => void) {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	},
};

/** The pending request on the page showing, whatever it names. */
export function usePendingFocus(): ThreadFocus | null {
	const active = usePageActive();
	const focus = useSyncExternalStore(threadFocus.subscribe, threadFocus.get);
	return active ? focus : null;
}

/**
 * Whether `el` is drawn where the reviewer can see it: in the document and
 * not inside a hidden or inert part (a kept page that isn't showing, a
 * closed sheet), nor itself unrendered where the browser can tell.
 */
export function onScreen(el: Element | null): el is Element {
	if (!el?.isConnected || el.closest("[inert],[hidden]") !== null) return false;
	const check = (el as { checkVisibility?: () => boolean }).checkVisibility;
	return typeof check === "function" ? check.call(el) : true;
}

/**
 * Scrolls `el`'s top just below the sticky stack over it: the app header,
 * the Files bar and its file's header (as a thread link's landing does).
 */
function scrollUnder(el: Element, margin = 8) {
	window.scrollTo({
		top:
			el.getBoundingClientRect().top +
			window.scrollY -
			stickyBottom(el) -
			margin,
	});
}

/**
 * The pending request matching `matches`, once per request, on the page
 * showing: what a container (a file's bubbles, a review thread's agent
 * panel) opens for it.
 */
export function useFocusWhere(
	matches: (focus: ThreadFocus) => boolean,
	open: (focus: ThreadFocus) => void,
) {
	const active = usePageActive();
	// Only a request it matches re-renders it.
	const hit = useSyncExternalStore(threadFocus.subscribe, () => {
		const focus = threadFocus.get();
		return active && focus && matches(focus) ? focus : null;
	});
	const seq = hit?.seq ?? 0;
	// biome-ignore lint/correctness/useExhaustiveDependencies: once per request it matches.
	useEffect(() => {
		if (hit) open(hit);
	}, [seq]);
}

/** A request for one of a container's threads, by the card's id (`has`). */
export function useFocusAmong(
	has: (id: string) => boolean,
	open: (focus: ThreadFocus) => void,
) {
	useFocusWhere((f) => has(f.id), open);
}

/**
 * A card that can be asked for: when a request names `id` and the card is
 * on screen (on the page showing, not a hidden copy elsewhere), it takes
 * the request: it opens (`open`: expands, opens its conversation) and,
 * once drawn, scrolls in below the sticky stack (unless the page scrolls
 * it itself: `scroll` false). A copy that isn't on screen neither opens
 * nor takes it, and of two on screen only the first takes it.
 */
export function useFocusCard(
	id: string | undefined,
	ref: RefObject<Element | null>,
	open?: (focus: ThreadFocus) => void,
	options: { scroll?: boolean } = {},
) {
	const scroll = options.scroll !== false;
	const active = usePageActive();
	// Only a request for this card re-renders it.
	const hit = useSyncExternalStore(threadFocus.subscribe, () => {
		const focus = threadFocus.get();
		return active && focus && id && focus.id === id ? focus : null;
	});
	const seq = hit?.seq ?? 0;
	// biome-ignore lint/correctness/useExhaustiveDependencies: once per request that names this card.
	useEffect(() => {
		// Still asked for: no other copy took it, nothing cancelled it.
		if (!hit || threadFocus.get()?.seq !== hit.seq || !onScreen(ref.current))
			return;
		open?.(hit);
		threadFocus.taken(hit.seq);
		if (!scroll) return;
		// After what opening it draws; not once a newer request came.
		let inner = 0;
		const outer = requestAnimationFrame(() => {
			inner = requestAnimationFrame(() => {
				const el = ref.current;
				if (threadFocus.latest() !== hit.seq || !onScreen(el)) return;
				scrollUnder(el);
			});
		});
		return () => {
			cancelAnimationFrame(outer);
			cancelAnimationFrame(inner);
		};
	}, [seq]);
}

/** How long a message landed on keeps its outline. */
export const OUTLINE_MS = 2000;

/**
 * The message of `messages` a request landed on, while it is outlined:
 * scrolled into view (centred) as its card takes it, its outline gone
 * after OUTLINE_MS.
 */
export function useOutlinedMessage(
	messages: readonly { id: string }[] | undefined,
): string | null {
	const active = usePageActive();
	const landed = useSyncExternalStore(
		threadFocus.subscribe,
		threadFocus.outline,
	);
	const mine =
		active && landed && messages?.some((m) => m.id === landed.message)
			? landed
			: null;
	const [lit, setLit] = useState<Outline | null>(null);
	const seq = mine?.seq ?? 0;
	// biome-ignore lint/correctness/useExhaustiveDependencies: once per outline here.
	useEffect(() => {
		if (!mine) return;
		setLit(mine);
		threadFocus.outlined(mine.seq);
		document
			.querySelector(`[data-message-id="${mine.message}"]`)
			?.scrollIntoView?.({ block: "center" });
	}, [seq]);
	useEffect(() => {
		if (!lit) return;
		const timer = setTimeout(() => setLit(null), OUTLINE_MS);
		return () => clearTimeout(timer);
	}, [lit]);
	return lit?.message ?? null;
}
