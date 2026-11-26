// Retained publisher evidence is data. It never authorizes execution or an admission by itself.
import { digest, requireThat, stable } from './model.mjs';

const paths = {
  outline: 'package/journeys/customer-life.outline.md',
  life: 'package/journeys/customer-life.json',
  outlineVerdict: 'package/journeys/customer-life.outline.verdict.json',
  lifeVerdict: 'package/journeys/customer-life.verdict.json',
};

export function publisherReview(files, vendor) {
  const review = { schemaVersion: 1, vendor };
  for (const [key, path] of Object.entries(paths)) {
    const bytes = files.get(path);
    requireThat(bytes, `artifact is missing ${path}`);
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    review[key] = { path, text, sha256: digest(text) };
  }
  return review;
}

function independent(verdict, author, label) {
  const named = value => typeof value === 'string' && value.trim().length > 0;
  requireThat(verdict?.plausible === true, `${label}: publisher verdict is not plausible`);
  requireThat(named(verdict.judge?.agent) && Array.isArray(verdict.authors) && verdict.authors.length > 0 &&
    verdict.authors.every(named), `${label}: publisher verdict needs judge and author attribution`);
  requireThat(!verdict.authors.includes(verdict.judge.agent), `${label}: judge is among the authors`);
  const judgeName = verdict.judge.name ?? verdict.judge.session;
  requireThat((judgeName === undefined || named(judgeName)) && !/self-judged/i.test(judgeName ?? '') &&
    (!author || judgeName !== author), `${label}: verdict is self-judged`);
}

function validatePublisherReview(review, vendor) {
  requireThat(review?.schemaVersion === 1 && review.vendor === vendor, 'publisher review vendor differs');
  for (const [key, path] of Object.entries(paths)) requireThat(review[key]?.path === path &&
    typeof review[key].text === 'string' && digest(review[key].text) === review[key].sha256,
    `${path}: retained publisher bytes differ`);
  requireThat(review.outline.text.trim().length > 0, 'publisher outline is empty');
  const life = JSON.parse(review.life.text);
  requireThat(Array.isArray(life?.steps) && life.steps.length > 0, 'publisher customer life is empty');
  requireThat(life.author === undefined || (typeof life.author === 'string' && life.author.trim()), 'publisher life has invalid author attribution');
  const outlineVerdict = JSON.parse(review.outlineVerdict.text), lifeVerdict = JSON.parse(review.lifeVerdict.text);
  independent(outlineVerdict, undefined, 'outline');
  independent(lifeVerdict, life.author, 'customer life');
}

/** Shared by authenticated admission and the JSON-only installed reader. */
export function validatePublisherEnvelope(envelope) {
  const s = envelope.input?.submission, prepared = envelope.prepared, report = envelope.report;
  requireThat(envelope.schemaVersion === 2 && envelope.kind === 'publisher-review' && s &&
    envelope.inputSha256 === digest(envelope.input) && envelope.status === 'ready' && report?.ready === true,
    'publisher review is not a complete successful envelope');
  requireThat(report.schemaVersion === 2 && report.kind === 'publisher-review' && report.vendor === s.vendor &&
    report.package === s.package && report.version === s.version && report.integrity === s.integrity,
    'publisher review release identity differs');
  requireThat(prepared?.schemaVersion === 2 && stable(prepared.submission) === stable(s) &&
    prepared.integrity === s.integrity && stable(report.prepared) === stable(prepared), 'publisher preparation differs');
  requireThat(prepared.packageMetadata && Object.keys(prepared.facts?.packs ?? {}).length === 1 &&
    prepared.facts.packs[s.vendor]?.protocol?.declared === '3', 'publisher artifact facts differ');
  const provenance = prepared.provenance, source = envelope.input.source;
  requireThat(/^[a-f0-9]{40}$/.test(prepared.sourceCommit) &&
    (s.sourceCommit === undefined || s.sourceCommit === prepared.sourceCommit), 'publisher source commit differs');
  requireThat(['public', 'restricted'].includes(prepared.registryVisibility), 'publisher registry visibility is missing');
  if (prepared.registryVisibility === 'public') {
    const workflow = `${source?.repository}/.github/workflows/${source?.workflow ?? 'release.yml'}@`;
    requireThat(provenance && provenance.sourceCommit === prepared.sourceCommit &&
      provenance.signer?.startsWith(`https://github.com/${workflow}`) && provenance.bundle &&
      provenance.subjectSha512 === Buffer.from(s.integrity.slice('sha512-'.length), 'base64').toString('hex'),
      'publisher provenance is not bound to the registered source and artifact');
  } else requireThat(s.sourceCommit === prepared.sourceCommit && provenance === null, 'restricted publisher source binding differs');
  validatePublisherReview(report.publisherReview, s.vendor);
}
