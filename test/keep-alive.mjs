// Preloaded (`node --import`) into a process under test: a ref'd timer that
// keeps it alive, so it ends only by exiting on purpose (process.exit),
// never because nothing is left in its event loop.
setInterval(() => {}, 1 << 30);
