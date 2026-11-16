import { type RefObject, useEffect, useSyncExternalStore } from "react";
import { usePageActive } from "../pageActive";
import { stickyBottom } from "./scrollAnchor";

/**
 * A request to show one conversation's card in Files changed (the Threads
 * tab's rows): whatever holds it opens (a line's or a hidden run's bubble,
 * the file bubble, a collapsed card, the thread's agent conversation), and
 * the card scrolls in just below the sticky stack. A request lasts until a
 * card shown on screen scrolls to it, or until the reviewer goes anywhere
 * else (`cancel`: another pick, a find step, a link, a file opened or
 * closed, another comparison, another page). A new click is a new request,
 * so the same row again still scrolls.
 */
export interface ThreadFocus {
	seq: number;
	/** The card's id: a review thread's (GitHub's), or an agent thread's. */
	id: string;
	/** On a review thread: its agent conversation (an agent thread's id) opens too. */
	conversation?: string;
}

let current: ThreadFocus | null = null;
let lastSeq = 0;
const listeners = new Set<() => void>();
const notify = () => {
	for (const l of listeners) l();
};

export const threadFocus = {
	request(target: { id: string; conversation?: string }): ThreadFocus {
		lastSeq += 1;
		current = {
			seq: lastSeq,
			id: target.id,
			...(target.conversation ? { conversation: target.conversation } : {}),
		};
		notify();
		return current;
	},
	/** The pending request, if any. */
	get: () => current,
	/** Ends request `seq`: its card is in view. */
	scrolled(seq: number) {
		if (current?.seq !== seq) return;
		current = null;
		notify();
	},
	/** Ends any pending request: the reviewer went elsewhere. */
	cancel() {
		if (current === null) return;
		current = null;
		notify();
	},
	subscribe(listener: () => void) {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	},
};

/**
 * Whether `el` is drawn where the reviewer can see it: in the document,
 * laid out, and not inside a hidden or inert part (a kept page that isn't
 * showing, a closed sheet).
 */
export function onScreen(el: Element | null): el is Element {
	return (
		el?.isConnected === true &&
		el.getClientRects().length > 0 &&
		el.closest("[inert],[hidden]") === null
	);
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
 * The pending request for one of a container's threads (`has`), once per
 * request, on the page showing: what to open for it.
 */
export function useFocusAmong(
	has: (id: string) => boolean,
	open: (focus: ThreadFocus) => void,
) {
	const active = usePageActive();
	// Only a request for one of its threads re-renders it.
	const hit = useSyncExternalStore(threadFocus.subscribe, () => {
		const focus = threadFocus.get();
		return active && focus && has(focus.id) ? focus : null;
	});
	const seq = hit?.seq ?? 0;
	// biome-ignore lint/correctness/useExhaustiveDependencies: once per request that names one of its threads.
	useEffect(() => {
		if (hit) open(hit);
	}, [seq]);
}

/**
 * A card that can be asked for: when a request names `id` and the card is
 * on screen (on the page showing, not a hidden copy elsewhere), it opens
 * (`open`: expands, opens its conversation) and, once drawn, scrolls in
 * below the sticky stack; only then is the request done. A copy that
 * isn't on screen neither opens nor takes the request.
 */
export function useFocusCard(
	id: string | undefined,
	ref: RefObject<Element | null>,
	open?: (focus: ThreadFocus) => void,
) {
	const active = usePageActive();
	// Only a request for this card re-renders it.
	const hit = useSyncExternalStore(threadFocus.subscribe, () => {
		const focus = threadFocus.get();
		return active && focus && id && focus.id === id ? focus : null;
	});
	const seq = hit?.seq ?? 0;
	// biome-ignore lint/correctness/useExhaustiveDependencies: once per request that names this card.
	useEffect(() => {
		if (!hit || !onScreen(ref.current)) return;
		open?.(hit);
		// After what opening it draws.
		let inner = 0;
		const outer = requestAnimationFrame(() => {
			inner = requestAnimationFrame(() => {
				const el = ref.current;
				// Still asked for (no other copy took it, nothing cancelled it).
				if (threadFocus.get()?.seq !== hit.seq || !onScreen(el)) return;
				scrollUnder(el);
				threadFocus.scrolled(hit.seq);
			});
		});
		return () => {
			cancelAnimationFrame(outer);
			cancelAnimationFrame(inner);
		};
	}, [seq]);
}
