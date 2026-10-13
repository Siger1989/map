import path from 'node:path';

const ignoredProjectRoots = new Set(['.build', 'dist', 'apk', '.openai', 'artifacts']);

/** Return a chokidar ignored predicate scoped to one project root. */
export function createPreviewWatchIgnore(projectRoot) {
  const root = path.resolve(projectRoot);
  return (candidatePath) => {
    const absolutePath = path.isAbsolute(candidatePath)
      ? path.resolve(candidatePath)
      : path.resolve(root, candidatePath);
    const relativePath = path.relative(root, absolutePath);
    if (relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
      // Chokidar must be able to traverse the worktree's parent directories.
      // Keep their unrelated entries ignored by evaluating those paths normally.
      const rootFromCandidate = path.relative(absolutePath, root);
      const isAncestor = rootFromCandidate !== '' && rootFromCandidate !== '..' &&
        !rootFromCandidate.startsWith(`..${path.sep}`) && !path.isAbsolute(rootFromCandidate);
      return !isAncestor;
    }
    if (!relativePath) return false;

    const normalized = relativePath.split(path.sep).join('/').toLowerCase();
    if (normalized.split('/').some((segment) => ignoredProjectRoots.has(segment))) return true;
    return normalized.startsWith('config/ui-layout-draft.json');
  };
}
