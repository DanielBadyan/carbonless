/**
 * The Overview's search params: `thread`, a card to bring into view (the
 * Final Verdict tab's thread rows, an agent conversation link), and
 * `conversation` (with `message`), that thread's agent conversation to
 * open, and a message in it to outline.
 */
export interface OverviewSearch {
	thread?: string;
	conversation?: string;
	message?: string;
}

const ULID = /^[0-9a-hjkmnp-tv-z]{26}$/;

/** Untrusted URL params to OverviewSearch; anything odd is dropped. */
export function parseOverviewSearch(
	raw: Record<string, unknown>,
): OverviewSearch {
	if (typeof raw.thread !== "string" || !raw.thread) return {};
	const out: OverviewSearch = { thread: raw.thread };
	if (typeof raw.conversation === "string" && ULID.test(raw.conversation)) {
		out.conversation = raw.conversation;
		if (typeof raw.message === "string" && ULID.test(raw.message)) {
			out.message = raw.message;
		}
	}
	return out;
}
