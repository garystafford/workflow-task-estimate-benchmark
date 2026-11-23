export function recoveryIssues(trace, write, read) {
  const timeout = trace.findIndex(e => e.name === write && /time[ -]?out|timed out/i.test(e.error ?? ''));
  if (timeout < 0) return ['uncertain write never exercised'];
  const after = trace.slice(timeout + 1);
  const lookup = after.findIndex(e => e.name === read && !e.error);
  const nextWrite = after.findIndex(e => e.name === write);
  return lookup < 0 || (nextWrite >= 0 && nextWrite < lookup)
    ? ['missing authoritative lookup before retry'] : [];
}
