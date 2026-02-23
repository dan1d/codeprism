import { AsyncLocalStorage } from "node:async_hooks";

const devEmailStorage = new AsyncLocalStorage<string | undefined>();

/** Runs a function with the dev email in async context. */
export function runWithDevEmail<T>(email: string | undefined, fn: () => T): T {
  return devEmailStorage.run(email, fn);
}

/** Returns the dev email from the current async context, if any. */
export function getDevEmail(): string | undefined {
  return devEmailStorage.getStore();
}
