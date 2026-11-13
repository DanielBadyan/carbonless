import type { Person } from "../shared/home.js";
import { GhError, loggedOutCount, slugify } from "./gh.js";
import { fetchViewer } from "./home/prFacts.js";

/**
 * How long the gh login is kept: a `gh auth switch` to another account
 * shows within this long, with no restart.
 */
export const VIEWER_TTL_MS = 10 * 60_000;

/**
 * The gh login, kept per server (`crb serve`: every review's open and
 * Home share one), read again once VIEWER_TTL_MS old, once any gh call has
 * found gh logged out since it was read, and after forget() (the test
 * hook's reset). Calls at once share one read; a failed read isn't kept.
 */
export class ViewerCache {
	readonly #read: () => Promise<Person>;
	readonly #now: () => number;
	readonly #ttlMs: number;
	#entry: { at: number; seen: number; viewer: Promise<Person> } | null = null;

	constructor(
		options: {
			read?: () => Promise<Person>;
			now?: () => number;
			ttlMs?: number;
		} = {},
	) {
		this.#read = options.read ?? (() => fetchViewer());
		this.#now = options.now ?? Date.now;
		this.#ttlMs = options.ttlMs ?? VIEWER_TTL_MS;
	}

	/** The gh login and avatar, kept or read now. */
	get(): Promise<Person> {
		const now = this.#now();
		const seen = loggedOutCount();
		const kept = this.#entry;
		if (kept && kept.seen === seen && now - kept.at <= this.#ttlMs) {
			return kept.viewer;
		}
		const entry = { at: now, seen, viewer: this.#read() };
		this.#entry = entry;
		entry.viewer.catch(() => {
			if (this.#entry === entry) this.#entry = null;
		});
		return entry.viewer;
	}

	/** The login's slug (the review's `viewer`), failing on one that has none. */
	async slug(): Promise<string> {
		const slug = slugify((await this.get()).login);
		if (!slug.replace(/-/g, "")) {
			throw new GhError("Could not determine your GitHub login");
		}
		return slug;
	}

	/** Reads the login again on the next get(). */
	forget(): void {
		this.#entry = null;
	}
}
