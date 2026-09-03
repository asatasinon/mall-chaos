import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isLocale, type Locale } from '@/i18n/config';
import {
  getRunbookEntry,
  resolveRunbookScenario,
  type RunbookScenarioInput,
} from './runbook';

const RUNBOOK_CONTENT_ROOT = path.resolve(process.cwd(), 'src', 'content', 'runbook');

export type RunbookContentErrorCode =
  | 'INVALID_LOCALE'
  | 'CONTENT_NOT_FOUND'
  | 'CONTENT_EMPTY'
  | 'CONTENT_UNAVAILABLE';

export class RunbookContentError extends Error {
  readonly code: RunbookContentErrorCode;

  constructor(code: RunbookContentErrorCode) {
    super(code);
    this.name = 'RunbookContentError';
    this.code = code;
  }
}

function getLocaleRoot(locale: Locale): string {
  return path.resolve(RUNBOOK_CONTENT_ROOT, locale);
}

export function getRunbookContentPath(locale: unknown, input: RunbookScenarioInput): string {
  if (!isLocale(locale)) throw new RunbookContentError('INVALID_LOCALE');

  const entry = getRunbookEntry(resolveRunbookScenario(input));
  const localeRoot = getLocaleRoot(locale);
  const contentPath = path.resolve(localeRoot, entry.articleFile);
  if (!contentPath.startsWith(`${localeRoot}${path.sep}`)) {
    throw new RunbookContentError('CONTENT_UNAVAILABLE');
  }
  return contentPath;
}

export async function loadRunbookMarkdown(
  locale: unknown,
  input: RunbookScenarioInput,
): Promise<string> {
  const contentPath = getRunbookContentPath(locale, input);
  let markdown: string;
  try {
    markdown = await fs.readFile(contentPath, 'utf8');
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      throw new RunbookContentError('CONTENT_NOT_FOUND');
    }
    throw new RunbookContentError('CONTENT_UNAVAILABLE');
  }

  if (markdown.trim().length === 0) {
    throw new RunbookContentError('CONTENT_EMPTY');
  }
  return markdown;
}