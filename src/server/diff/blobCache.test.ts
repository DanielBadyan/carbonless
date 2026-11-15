import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	createGitFixture,
	GIT_TEST_TIMEOUTS,
	type GitFixture,
	testGitEnv,
} from "../../../test/git-fixture.js";
import { BlobCache, ENTRY_OVERHEAD_BYTES } from "./blobCache.js";
import { clearSnapshotCaches, readBlobs } from "./snapshot.js";

// Real git processes: see GIT_TEST_TIMEOUTS.
vi.setConfig(GIT_TEST_TIMEOUTS);

/** A blob whose cache cost is exactly `cost` bytes. */
const blobCosting = (cost: number) =>
	Buffer.alloc(cost - ENTRY_OVERHEAD_BYTES, 0x61);

describe("BlobCache", () => {
	it("evicts the least recently used blobs once their bytes pass the cap", () => {
		const cache = new BlobCache(6000);
		cache.set("a", blobCosting(2000));
		cache.set("b", blobCosting(2000));
		cache.set("c", blobCosting(2000));
		expect(cache.keys()).toEqual(["a", "b", "c"]);
		expect(cache.bytes).toBe(6000);

		cache.set("d", blobCosting(3000));
		expect(cache.keys()).toEqual(["c", "d"]);
		expect(cache.bytes).toBe(5000);
	});

	it("holds many small blobs where an entry count would have evicted them", () => {
		const cache = new BlobCache(1000 * (ENTRY_OVERHEAD_BYTES + 10));
		for (let i = 0; i < 1000; i++) cache.set(`oid${i}`, Buffer.alloc(10));
		expect(cache.keys()).toHaveLength(1000);
		cache.set("one more", Buffer.alloc(10));
		expect(cache.keys()).toHaveLength(1000);
		expect(cache.has("oid0")).toBe(false);
	});

	it("bounds empty blobs too: each entry costs its overhead", () => {
		const cache = new BlobCache(10 * ENTRY_OVERHEAD_BYTES);
		for (let i = 0; i < 50; i++) cache.set(`oid${i}`, Buffer.alloc(0));
		expect(cache.keys()).toHaveLength(10);
		expect(cache.bytes).toBe(10 * ENTRY_OVERHEAD_BYTES);
	});

	it("never caches a blob larger than the cap, and keeps what it held", () => {
		const cache = new BlobCache(6000);
		cache.set("a", blobCosting(2000));
		cache.set("huge", blobCosting(6001));
		expect(cache.has("huge")).toBe(false);
		expect(cache.keys()).toEqual(["a"]);
		expect(cache.bytes).toBe(2000);
	});

	it("a hit makes the blob the most recently used", () => {
		const cache = new BlobCache(6000);
		cache.set("a", blobCosting(2000));
		cache.set("b", blobCosting(2000));
		cache.set("c", blobCosting(2000));
		expect(cache.get("a")?.length).toBe(2000 - ENTRY_OVERHEAD_BYTES);
		expect(cache.keys()).toEqual(["b", "c", "a"]);

		cache.set("d", blobCosting(2000));
		expect(cache.keys()).toEqual(["c", "a", "d"]);
	});

	it("clear forgets every blob and its bytes", () => {
		const cache = new BlobCache(6000);
		cache.set("a", blobCosting(2000));
		cache.set("b", blobCosting(2000));
		cache.clear();
		expect(cache.keys()).toEqual([]);
		expect(cache.bytes).toBe(0);
		expect(cache.get("a")).toBeUndefined();
		// The cap applies afresh: three fit again.
		for (const oid of ["c", "d", "e"]) cache.set(oid, blobCosting(2000));
		expect(cache.keys()).toEqual(["c", "d", "e"]);
	});

	it("setting a cached OID again counts its bytes once", () => {
		const cache = new BlobCache(6000);
		cache.set("a", blobCosting(2000));
		cache.set("a", blobCosting(2400));
		expect(cache.bytes).toBe(2400);
		expect(cache.keys()).toEqual(["a"]);
	});
});

describe("readBlobs", () => {
	const FILES = 300;
	let fixture: GitFixture;
	let oids: string[];

	beforeAll(() => {
		const files: Record<string, string> = {};
		for (let i = 0; i < FILES; i++) files[`f${i}.txt`] = `file ${i}\n`;
		fixture = createGitFixture([{ message: "many", files }]);
		const tree = execFileSync(
			"git",
			["ls-tree", "-r", "--format=%(objectname)", "HEAD"],
			{ cwd: fixture.path, env: testGitEnv(), encoding: "utf8" },
		);
		oids = tree.trim().split("\n");
	});

	afterAll(() => fixture.cleanup());

	it("serves a large PR's many small blobs from the cache, without git", async () => {
		expect(oids).toHaveLength(FILES);
		const first = await readBlobs(fixture.path, oids);
		expect(first.size).toBe(FILES);
		// No repo: any blob not cached would need git and fail.
		const again = await readBlobs("/nonexistent-carbonless-repo", oids);
		expect([...again.keys()].sort()).toEqual([...oids].sort());
		expect(again.get(oids[0] as string)?.toString()).toBe(
			first.get(oids[0] as string)?.toString(),
		);
	});

	it("gives each blob its own allocation, never a slice of a shared pool slab", async () => {
		const blobs = await readBlobs(fixture.path, oids.slice(0, 3));
		for (const bytes of blobs.values()) {
			expect(bytes.length).toBeGreaterThan(0);
			expect(bytes.buffer.byteLength).toBe(bytes.length);
		}
	});

	it("clearSnapshotCaches empties the blob cache: the next read needs git", async () => {
		await readBlobs(fixture.path, oids);
		clearSnapshotCaches();
		await expect(
			readBlobs("/nonexistent-carbonless-repo", oids.slice(0, 1)),
		).rejects.toThrow();
		const again = await readBlobs(fixture.path, oids.slice(0, 1));
		expect(again.size).toBe(1);
	});
});
