export const runtime = 'nodejs';

import { getLocale } from 'next-intl/server';
import RunbookWorkspace from '@/components/runbook/RunbookWorkspace';
import { getRunbookEntry, listRunbookEntries, resolveRunbookScenario } from '@/lib/runbook';
import { loadRunbookMarkdown, RunbookContentError, type RunbookContentErrorCode } from '@/lib/runbook-content';

type RunbookPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function RunbookPage({ searchParams }: RunbookPageProps) {
  const locale = await getLocale();
  const params = await searchParams;
  const scenario = resolveRunbookScenario(params.scenario);
  const entry = getRunbookEntry(scenario);
  const entries = listRunbookEntries();
  let markdown: string | null = null;
  let contentError: RunbookContentErrorCode | null = null;

  try {
    markdown = await loadRunbookMarkdown(locale, scenario);
  } catch (error: unknown) {
    contentError = error instanceof RunbookContentError ? error.code : 'CONTENT_UNAVAILABLE';
  }

  return <RunbookWorkspace entries={entries} entry={entry} markdown={markdown} contentError={contentError} />;
}