/**
 * Wiki module — public API.
 *
 * Two namespaces (`kb` and `docs`) share the same storage and pipeline
 * but maintain disjoint page sets. Plan-016 §3.
 */
export {
  enqueueWikiIngest, archiveWikiSourcePage,
  getNamespaceMode, setNamespaceMode,
  getIngestQueue, getLintQueue, getBackfillQueue,
  WIKI_INGEST_QUEUE, WIKI_LINT_QUEUE, WIKI_BACKFILL_QUEUE,
  type IngestJobPayload, type NamespaceMode,
} from './sources';
export {
  listPages, getPage, getPageBySource, upsertPage,
  archivePage, restorePage, listVersions, deletePage,
  OptimisticConflictError,
  type ListPagesOpts, type UpsertPageInput,
} from './pages';
export { runIngest, markIngestDone, markIngestFailed, getIngestJob, type IngestContext, type WikiUpdatePlan } from './ingest';
export { runLint, type LintReport } from './lint';
export { seedNamespace } from './seed';
export { acquirePageLocks, type PageLock } from './locks';
export { notifyIngestSuccess, notifyIngestFailure, type IngestNotice } from './notify';
