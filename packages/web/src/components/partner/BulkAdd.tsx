/**
 * Adding products from a spreadsheet, for Shop Partner Pro (ruling 96, 5 November 2026): the CSV
 * template to download and fill in, the file chosen from the phone or computer (or the text
 * pasted), and each row's outcome in plain words, so a row that went wrong can be put right and
 * sent again. Every product still goes through the usual check before Shoppers see it.
 */

import { useId, useState } from 'react';

import {
  bulkAddPartnerProducts,
  downloadPartnerTemplate,
  type BulkRowResult,
  type PartnerCatalogueOptions,
} from '../../lib/api';

const field = 'w-full min-h-control rounded-2xl border-2 border-paper bg-paper text-ink p-3';

export function BulkAdd({
  catalogue,
  onNews,
  onProblem,
  onAdded,
}: {
  catalogue: PartnerCatalogueOptions;
  onNews: (words: string) => void;
  onProblem: (words: string) => void;
  onAdded: () => void;
}): JSX.Element {
  const id = useId();
  const [csv, setCsv] = useState('');
  const [results, setResults] = useState<BulkRowResult[] | null>(null);
  const [busy, setBusy] = useState(false);

  const readFile = (file: File): void => {
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result ?? ''));
    reader.onerror = () => onProblem('That file could not be read. Please choose it again.');
    reader.readAsText(file);
  };

  const send = async (): Promise<void> => {
    if (csv.trim() === '') {
      onProblem('Choose the filled-in CSV file, or paste its lines, first.');
      return;
    }
    setBusy(true);
    try {
      const outcome = await bulkAddPartnerProducts(csv);
      setResults(outcome.results);
      onNews(outcome.message);
      if (outcome.added > 0) onAdded();
    } catch (failure) {
      onProblem(failure instanceof Error ? failure.message : 'That could not be sent.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby={`${id}-heading`} className="space-y-3 border-2 border-paper/40 rounded-2xl p-4">
      <h2 id={`${id}-heading`} className="text-lead font-bold m-0">
        Add products from a spreadsheet
      </h2>
      <p className="m-0">
        Download the template, fill in one line for each product ({catalogue.bulkColumns.join(', ')}),
        save it as a CSV file, then choose it here. Each product is checked as usual before Shoppers
        see it. Up to 500 at a time.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() =>
            void downloadPartnerTemplate().catch((failure: unknown) =>
              onProblem(failure instanceof Error ? failure.message : 'The template could not be opened.'),
            )
          }
          className="control border-paper bg-paper/10 text-paper"
        >
          Download the template (CSV)
        </button>
        <label className="control bg-highlight text-on-accent cursor-pointer focus-within:outline focus-within:outline-4 focus-within:outline-offset-2">
          Choose the filled-in file
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) readFile(file);
            }}
            className="visually-hidden"
          />
        </label>
      </div>
      <label htmlFor={`${id}-csv`} className="block font-bold">
        Or paste the lines here
      </label>
      <textarea
        id={`${id}-csv`}
        rows={4}
        value={csv}
        onChange={(event) => setCsv(event.target.value)}
        className={field}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => void send()}
        className="control bg-highlight text-on-accent disabled:opacity-70"
      >
        Add these products
      </button>
      {results && (
        <ul className="list-none m-0 p-0 space-y-1" aria-label="What happened to each row">
          {results.map((result) => (
            <li key={result.row} className={result.ok ? '' : 'font-bold'}>
              Row {result.row}, {result.name}:{' '}
              {result.ok ? (result.status === 'approved' ? 'added and live.' : 'added, waiting to be checked.') : result.error}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
