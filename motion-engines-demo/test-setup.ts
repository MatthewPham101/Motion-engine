import "@testing-library/jest-dom/vitest";

// jsdom doesn't do layout, so every size reads as 0. Give every element a phone-sized box
// and a very tall scroll height, so the code under test has real numbers to work with.
Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 800 });
Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, value: 400 });
Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 800 });
Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 400 });
Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, value: 10_000_000 });
Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, value: 10_000_000 });
