/** React.lazy caches a rejected import. Clearing its boundary cannot fetch a new build's chunks. */
export function needsPageReload(error: Error): boolean {
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Failed to load module script|Loading (?:CSS )?chunk .+ failed|Unable to preload CSS/i.test(
    error.message,
  );
}
