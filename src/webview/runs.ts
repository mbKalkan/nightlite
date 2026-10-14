/**
 * Runs, a query's or a table's rows sorted or filtered, are numbered across the webview, so a
 * page or grid never takes an answer meant for another.
 */
let next = 1;

export function newRun(): number {
  return next++;
}
