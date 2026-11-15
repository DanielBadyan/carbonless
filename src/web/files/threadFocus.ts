import { type RefObject, useEffect, useSyncExternalStore } from "react";

/**
 * A request to show one conversation's card in Files changed (the Threads
 * tab's rows): whatever holds it opens (a line's or a hidden run's bubble,
 * the file bubble, a collapsed card, the thread's agent conversation), and
 * the card scrolls into view under the sticky stack. Each request (`seq`)
 * scrolls once, by the first card to show it; a new click is a new request,
 * so the same row again still scrolls.
 */
export interface ThreadFocus {
	seq: number;
	/** The card's id: a review thread's (GitHub's), or an agent thread's. */
	id: string;
	/** On a review thread: its agent conversation (an agent thread's id) opens too. */
	conversation?: string;
	/** A card took it into view. */
	scrolled: boolean;
}

let current: ThreadFocus | null = null;
const listeners = new Set<() => void>();
const notify = () => {
	for (const l of listeners) l();
};

export const threadFocus = {
	request(target: { id: string; conversation?: string }): ThreadFocus {
		current = {
			seq: (current?.seq ?? 0) + 1,
			id: target.id,
			...(target.conversation ? { conversation: target.conversation } : {}),
			scrolled: false,
		};
		notify();
		return current;
	},
	get: () => current,
	/** The card of request `seq` is in view. */
	scrolled(seq: number) {
		if (current?.seq !== seq || current.scrolled) return;
		current = { ...current, scrolled: true };
		notify();
	},
	/** Forgets any request (tests). */
	reset() {
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

/** The pending request, if any (one not yet scrolled to). */
export function useThreadFocus(): ThreadFocus | null {
	const focus = useSyncExternalStore(threadFocus.subscribe, threadFocus.get);
	return focus && !focus.scrolled ? focus : null;
}

/**
 * The pending request for any of `ids` (a container's threads), once per
 * request: what to open for it.
 */
export function useFocusAmong(
	has: (id: string) => boolean,
	open: (focus: ThreadFocus) => void,
) {
	// Only a request for one of its threads re-renders it.
	const hit = useSyncExternalStore(threadFocus.subscribe, () => {
		const focus = threadFocus.get();
		return focus && !focus.scrolled && has(focus.id) ? focus : null;
	});
	const seq = hit?.seq ?? 0;
	// biome-ignore lint/correctness/useExhaustiveDependencies: once per request that names one of its threads.
	useEffect(() => {
		if (hit) open(hit);
	}, [seq]);
}

/**
 * A card that can be asked for: when a request names `id`, it opens
 * (`open`: expands, opens its conversation) and, once drawn, scrolls into
 * view below the sticky stack (the page's scroll-padding).
 */
export function useFocusCard(
	id: string | undefined,
	ref: RefObject<Element | null>,
	open?: (focus: ThreadFocus) => void,
) {
	// Only a request for this card re-renders it.
	const hit = useSyncExternalStore(threadFocus.subscribe, () => {
		const focus = threadFocus.get();
		return focus && !focus.scrolled && id && focus.id === id ? focus : null;
	});
	const seq = hit?.seq ?? 0;
	// biome-ignore lint/correctness/useExhaustiveDependencies: once per request that names this card.
	useEffect(() => {
		if (!hit) return;
		open?.(hit);
		// After what opening it draws (and any landing's own scroll).
		let frame = requestAnimationFrame(() => {
			frame = requestAnimationFrame(() => {
				const el = ref.current;
				if (!el) return;
				el.scrollIntoView?.({ block: "start" });
				threadFocus.scrolled(hit.seq);
			});
		});
		return () => cancelAnimationFrame(frame);
	}, [seq]);
}
