// jsdom has no ResizeObserver, which the chart and the collapsible groups use.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
