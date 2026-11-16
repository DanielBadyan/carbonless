// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { type ReactNode, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageActive } from "../pageActive";
import { threadFocus, useFocusAmong, useFocusCard } from "./threadFocus";

function Card(props: {
	id: string;
	onOpen?: () => void;
	children?: ReactNode;
}) {
	const ref = useRef<HTMLDivElement>(null);
	useFocusCard(props.id, ref, props.onOpen);
	return (
		<div ref={ref} data-card={props.id}>
			{props.children}
		</div>
	);
}

function Holder(props: { ids: string[]; onOpen: (id: string) => void }) {
	useFocusAmong(
		(id) => props.ids.includes(id),
		(f) => props.onOpen(f.id),
	);
	return null;
}

let scrollTo: ReturnType<typeof vi.fn>;
beforeEach(() => {
	threadFocus.cancel();
	// Drawn: jsdom lays nothing out.
	vi.spyOn(Element.prototype, "getClientRects").mockImplementation(
		() => [{}] as unknown as DOMRectList,
	);
	// Frames at once.
	vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
		cb(0);
		return 0;
	});
	scrollTo = vi.fn();
	vi.stubGlobal("scrollTo", scrollTo);
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	threadFocus.cancel();
});

describe("threadFocus", () => {
	it("a card asked for opens, scrolls in once, and ends the request", () => {
		const onOpen = vi.fn();
		render(<Card id="T1" onOpen={onOpen} />);
		act(() => {
			threadFocus.request({ id: "T1" });
		});
		expect(onOpen).toHaveBeenCalledTimes(1);
		expect(scrollTo).toHaveBeenCalledTimes(1);
		expect(threadFocus.get()).toBeNull();
	});

	it("a card mounted later takes the request then", () => {
		act(() => {
			threadFocus.request({ id: "T1" });
		});
		const onOpen = vi.fn();
		render(<Card id="T1" onOpen={onOpen} />);
		expect(onOpen).toHaveBeenCalledTimes(1);
		expect(scrollTo).toHaveBeenCalledTimes(1);
	});

	it("a request cancelled (the reviewer went elsewhere) opens and scrolls nothing later", () => {
		act(() => {
			threadFocus.request({ id: "T1" });
			threadFocus.cancel();
		});
		const onOpen = vi.fn();
		render(<Card id="T1" onOpen={onOpen} />);
		expect(onOpen).not.toHaveBeenCalled();
		expect(scrollTo).not.toHaveBeenCalled();
	});

	it("a newer request replaces an older one", () => {
		act(() => {
			threadFocus.request({ id: "T1" });
			threadFocus.request({ id: "T2" });
		});
		const one = vi.fn();
		const two = vi.fn();
		render(
			<>
				<Card id="T1" onOpen={one} />
				<Card id="T2" onOpen={two} />
			</>,
		);
		expect(one).not.toHaveBeenCalled();
		expect(two).toHaveBeenCalledTimes(1);
	});

	it("a hidden copy (an inert kept page) neither opens nor takes the request; the shown one does", () => {
		const hidden = vi.fn();
		const shown = vi.fn();
		render(
			<>
				<div inert>
					<Card id="T1" onOpen={hidden} />
				</div>
				<Card id="T1" onOpen={shown} />
			</>,
		);
		act(() => {
			threadFocus.request({ id: "T1" });
		});
		expect(hidden).not.toHaveBeenCalled();
		expect(shown).toHaveBeenCalledTimes(1);
		expect(scrollTo).toHaveBeenCalledTimes(1);
		expect(threadFocus.get()).toBeNull();
	});

	it("a card on a page that isn't showing waits", () => {
		const onOpen = vi.fn();
		const { rerender } = render(
			<PageActive value={false}>
				<Card id="T1" onOpen={onOpen} />
			</PageActive>,
		);
		act(() => {
			threadFocus.request({ id: "T1" });
		});
		expect(onOpen).not.toHaveBeenCalled();
		expect(threadFocus.get()).not.toBeNull();
		rerender(
			<PageActive value={true}>
				<Card id="T1" onOpen={onOpen} />
			</PageActive>,
		);
		expect(onOpen).toHaveBeenCalledTimes(1);
	});

	it("nested copies (a shell and its card) scroll once", () => {
		render(
			<Card id="T1">
				<Card id="T1" />
			</Card>,
		);
		act(() => {
			threadFocus.request({ id: "T1" });
		});
		expect(scrollTo).toHaveBeenCalledTimes(1);
	});

	it("a container opens for a request that names one of its threads, once", () => {
		const onOpen = vi.fn();
		const { rerender } = render(<Holder ids={["A", "B"]} onOpen={onOpen} />);
		act(() => {
			threadFocus.request({ id: "C" });
		});
		expect(onOpen).not.toHaveBeenCalled();
		act(() => {
			threadFocus.request({ id: "B" });
		});
		rerender(<Holder ids={["A", "B"]} onOpen={onOpen} />);
		expect(onOpen).toHaveBeenCalledTimes(1);
		expect(onOpen).toHaveBeenCalledWith("B");
	});
});
