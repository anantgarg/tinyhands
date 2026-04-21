/**
 * Parser module — public API.
 *
 * Two callers: the wiki ingest worker (parses the source's bytes/inline
 * content) and the KB sync handler (which now stores binaries in
 * kb_source_files and calls in to parse on demand).
 *
 * See plan-016 §2 + the format coverage matrix.
 */
export { parseSource, type ParseRequest } from './router';
export { parseLocal, isTextLike, requiresCloudParser, renderDocContent, renderSheetTabs, type LocalParseInput } from './local';
export { parseReducto, type ReductoInput } from './reducto';
export { parseLlamaParse, type LlamaParseInput } from './llamaparse';
