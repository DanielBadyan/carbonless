/**
 * What one cached entry costs beyond its bytes: the Buffer object, the
 * 40-char OID key and the Map slot. Measured on Node 24 with 100k entries:
 * about 200 B of heap each (about 600 B of RSS for an empty blob). Charging
 * it keeps many tiny or empty blobs bounded by the same byte cap, so no
 * separate entry-count limit is needed.
 */
export const ENTRY_OVERHEAD_BYTES = 512;

/**
 * Blob contents by OID, least recently used first, held to `maxBytes` in
 * total (each entry costs its length plus ENTRY_OVERHEAD_BYTES). A blob that
 * alone costs more than the cap is never cached.
 */
export class BlobCache {
	readonly #entries = new Map<string, Buffer>();
	#bytes = 0;

	constructor(readonly maxBytes: number) {}

	/** The blob, now the most recently used; undefined if not cached. */
	get(oid: string): Buffer | undefined {
		const bytes = this.#entries.get(oid);
		if (bytes) {
			this.#entries.delete(oid);
			this.#entries.set(oid, bytes);
		}
		return bytes;
	}

	/** Caches `bytes` as the most recently used, evicting the least. */
	set(oid: string, bytes: Buffer): void {
		this.#drop(oid);
		const cost = costOf(bytes);
		if (cost > this.maxBytes) return;
		this.#entries.set(oid, bytes);
		this.#bytes += cost;
		while (this.#bytes > this.maxBytes) {
			this.#drop(this.#entries.keys().next().value as string);
		}
	}

	has(oid: string): boolean {
		return this.#entries.has(oid);
	}

	/** Cached OIDs, least recently used first. */
	keys(): string[] {
		return [...this.#entries.keys()];
	}

	/** Total cost of the cached entries, overhead included. */
	get bytes(): number {
		return this.#bytes;
	}

	/** Forgets every blob, as a fresh process has none. */
	clear(): void {
		this.#entries.clear();
		this.#bytes = 0;
	}

	#drop(oid: string): void {
		const bytes = this.#entries.get(oid);
		if (!bytes) return;
		this.#entries.delete(oid);
		this.#bytes -= costOf(bytes);
	}
}

const costOf = (bytes: Buffer) => bytes.length + ENTRY_OVERHEAD_BYTES;
