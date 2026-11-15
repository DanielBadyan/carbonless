import {
	type PersistedClient,
	type Persister,
	type PersistQueryClientOptions,
	persistQueryClient,
	persistQueryClientSave,
} from "@tanstack/query-persist-client-core";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import type { Query, QueryClient } from "@tanstack/react-query";
import { REPO_GC_MS } from "./homeApi";

/**
 * Home's last answers, kept for the tab across page loads (owner,
 * 2026-11-15: "It should keep the state from the previous time I was on
 * the home screen, and only refresh the queries, so I can quickly cycle
 * through PRs"). A PR opens as a new page (a review binds its page for
 * life, api.ts bindReview), so Back, or the review's Home link, starts a
 * new query client: TanStack's persister keeps Home's view and repo rows
 * in sessionStorage, restored before the app renders, stale, so Home shows
 * them at once and reads them again.
 */
export const HOME_STORAGE_KEY = "crb.home";

/** A saved answer older than this is dropped, as a repo's cache drops it. */
export const HOME_MAX_AGE_MS = REPO_GC_MS;

/**
 * This build: a new one drops what an older one saved (its shapes may
 * differ). The bundle's URL carries its content hash.
 */
const BUSTER = `home-1 ${import.meta.url}`;

/** Home's own reads: the view (["home","view"]) and each repo's rows. */
export const isHomeRead = (key: readonly unknown[]) =>
	key[0] === "home" && (key[1] === "view" || key[1] === "repo");

const kept = (query: Query) =>
	query.state.status === "success" &&
	isHomeRead(query.queryKey) &&
	Date.now() - query.state.dataUpdatedAt <= HOME_MAX_AGE_MS;

/** The tab's sessionStorage; none where it's blocked (nothing is kept). */
export function tabStorage(): Storage | undefined {
	try {
		return window.sessionStorage;
	} catch {
		return undefined;
	}
}

/**
 * Whether this page is a reload of Home: it starts from nothing, as a first
 * open does (a reload asks for the page anew).
 */
export function reloadedHome(): boolean {
	try {
		const [nav] = performance.getEntriesByType(
			"navigation",
		) as PerformanceNavigationTiming[];
		return nav?.type === "reload" && window.location.pathname === "/";
	} catch {
		return false;
	}
}

/**
 * Keeps `client`'s Home answers in `storage`: restores them (unless
 * `restore` is false), marked stale so Home reads them again, then saves
 * each change (throttled) and, at once, as the page goes or is hidden
 * (a row opened right after an answer came). Resolves once restored, to
 * a function that stops it all (tests); never rejects (unreadable storage
 * restores nothing).
 */
export async function persistHome(
	client: QueryClient,
	{
		storage = tabStorage(),
		restore = true,
		throttleTime,
	}: { storage?: Storage; restore?: boolean; throttleTime?: number } = {},
): Promise<() => void> {
	if (!storage) return () => {};
	const throttled = createSyncStoragePersister({
		storage,
		key: HOME_STORAGE_KEY,
		...(throttleTime === undefined ? {} : { throttleTime }),
	});
	// A page without Home's answers (a review's, long after) never wipes
	// the saved ones.
	const some = (persisted: PersistedClient) =>
		persisted.clientState.queries.length > 0;
	const persister: Persister = {
		...throttled,
		persistClient: (saved) => {
			if (some(saved)) return throttled.persistClient(saved);
		},
		...(restore ? {} : { restoreClient: () => undefined }),
	};
	const options: PersistQueryClientOptions = {
		queryClient: client,
		persister,
		maxAge: HOME_MAX_AGE_MS,
		buster: BUSTER,
		dehydrateOptions: { shouldDehydrateQuery: kept },
		// Kept while no page shows them (a review's page), so its saves keep
		// them too.
		hydrateOptions: {
			defaultOptions: { queries: { gcTime: HOME_MAX_AGE_MS } },
		},
	};
	const [unsubscribe, restored] = persistQueryClient(options);
	// The same save, written now: the page is going.
	const now: Persister = {
		...persister,
		persistClient: (saved) => {
			if (!some(saved)) return;
			try {
				storage.setItem(HOME_STORAGE_KEY, JSON.stringify(saved));
			} catch {
				// Full or blocked: the last save stands.
			}
		},
	};
	const flush = () => {
		void persistQueryClientSave({ ...options, persister: now });
	};
	const hidden = () => {
		if (document.visibilityState === "hidden") flush();
	};
	window.addEventListener("pagehide", flush);
	document.addEventListener("visibilitychange", hidden);
	try {
		await restored;
	} catch {
		// Unreadable: dropped, Home loads as on a first open.
	}
	// Restored answers are read again when Home shows them, however young.
	void client.invalidateQueries({ queryKey: ["home"], refetchType: "none" });
	return () => {
		unsubscribe();
		window.removeEventListener("pagehide", flush);
		document.removeEventListener("visibilitychange", hidden);
	};
}
