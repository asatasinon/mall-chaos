import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { NextIntlClientProvider } from 'next-intl';
import { EvidencePanel } from './EvidencePanel';
import messages from '@/i18n/messages';

test('EvidencePanel initial state is labelled and announces metadata loading', () => {
  const html = renderToStaticMarkup(
    <NextIntlClientProvider
      locale="en"
      messages={messages.en}
      timeZone="UTC"
      now={new Date('2026-10-11T06:00:00.000Z')}
    >
      <EvidencePanel
        faultRunId="123e4567-e89b-12d3-a456-426614174000"
        controlState="Recovered"
      />
    </NextIntlClientProvider>,
  );

  assert.match(html, /aria-labelledby="evidence-panel-title"/u);
  assert.match(html, /aria-busy="true"/u);
  assert.match(html, /role="status" aria-live="polite"/u);
  assert.match(html, /Loading Evidence metadata/u);
  assert.doesNotMatch(html, /Run live report/u);
});
