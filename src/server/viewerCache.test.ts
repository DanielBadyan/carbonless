import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ghCallKinds } from "../../test/gh-log";
import { GIT_TEST_TIMEOUTS } from "../../test/git-fixture";
import { createPrFixture, type PrFixture } from "../../test/pr-fixture";
import type { Person } from "../shared/home";
import { runGh } from "./gh";
import { HomeService } from "./home/homeService";
import { SessionRegistry } from "./registry";
import { VIEWER_TTL_MS, ViewerCache } from "./viewerCache";

// Real git and fake-gh processes: see GIT_TEST_TIMEOUTS.
vi.setConfig(GIT_TEST_TIMEOUTS);

describe("ViewerCache", () => {
	const octo: Person = { login: "Octo_Cat", avatarUrl: "a" };
	/** A cache over a counted read, on a clock the test moves. */
	const counted = (answers: (() => Promise<Person>)[] = []) => {
		let now = 1_000;
		let reads = 0;
		const cache = new ViewerCache({
			now: () => now,
			read: () => {
				reads++;
				return answers.shift()?.() ?? Promise.resolve(octo);
			},
		});
		return {
			cache,
			reads: () => reads,
			advance: (ms: number) => {
				now += ms;
			},
		};
	};

	it("keeps the login for VIEWER_TTL_MS, then reads it again", async () => {
		const c = counted();
		expect(await c.cache.get()).toEqual(octo);
		c.advance(VIEWER_TTL_MS);
		expect(await c.cache.slug()).toBe("octo-cat");
		expect(c.reads()).toBe(1);
		c.advance(1);
		await c.cache.get();
		expect(c.reads()).toBe(2);
	});

	it("shares one read between calls at once, and keeps no failed read", async () => {
		let answer: (p: Person) => void = () => {};
		const c = counted([
			() => Promise.reject(new Error("offline")),
			() =>
				new Promise<Person>((resolve) => {
					answer = resolve;
				}),
		]);
		await expect(c.cache.get()).rejects.toThrow("offline");
		const [a, b] = [c.cache.get(), c.cache.get()];
		answer(octo);
		expect(await a).toEqual(octo);
		expect(await b).toEqual(octo);
		expect(c.reads()).toBe(2);
	});

	it("reads again after forget()", async () => {
		const c = counted();
		await c.cache.get();
		c.cache.forget();
		await c.cache.get();
		expect(c.reads()).toBe(2);
	});

	it("refuses a login with nothing to slug", async () => {
		const c = counted([() => Promise.resolve({ login: "--", avatarUrl: "" })]);
		await expect(c.cache.slug()).rejects.toThrow(
			"Could not determine your GitHub login",
		);
	});

	describe("with the fake gh", () => {
		let pr: PrFixture;
		let registry: SessionRegistry | undefined;
		beforeEach(() => {
			pr = createPrFixture();
		});
		afterEach(async () => {
			await registry?.closeAll();
			registry = undefined;
			await pr.cleanup();
		});
		const viewerReads = () =>
			ghCallKinds(pr.ghLog()).filter((k) => k === "viewer").length;

		it("reads the login again once any gh call found gh logged out", async () => {
			const cache = new ViewerCache();
			expect(await cache.slug()).toBe("octo-cat");
			await cache.slug();
			expect(viewerReads()).toBe(1);
			pr.scenario({ loggedOut: true });
			await expect(runGh(["api", "user"])).rejects.toThrow(
				"gh is not logged in",
			);
			await expect(cache.get()).rejects.toThrow("gh is not logged in");
			pr.scenario({ user: { login: "Other" } });
			expect(await cache.slug()).toBe("other");
			expect(viewerReads()).toBe(3);
		});

		it("is the server's: opens share one read with Home, without `gh auth status`; a reset reads it again", async () => {
			const viewers = new ViewerCache();
			registry = new SessionRegistry({ viewers });
			const config = { views: [], refresh: { minutes: 5 } };
			const home = new HomeService({
				config: {
					read: async () => ({ config, problems: [] }),
					update: async () => config,
				},
				viewers,
			});
			await registry.open({ pr: pr.arg });
			// Another request form: an open of its own.
			await registry.open({ pr: pr.arg, viewer: "someone-else" });
			expect(await home.viewerLogin()).toBe("Octo_Cat");
			expect(viewerReads()).toBe(1);
			expect(pr.ghLog()).not.toMatch(/^auth status/m);
			await registry.reset();
			await registry.open({ pr: pr.arg });
			expect(viewerReads()).toBe(2);
		});
	});
});
