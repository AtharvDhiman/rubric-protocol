/**
 * Stub for the `server-only` package, used by vitest alone.
 *
 * `server-only` exists to make importing a server module from a client bundle a
 * build error. That guard is real and stays real: Next resolves the actual
 * package when it builds the app, so a bad import still fails there. It just
 * cannot be loaded by a plain node test runner, which would leave server code
 * untestable - including the code that authenticates workers.
 */
export {};
