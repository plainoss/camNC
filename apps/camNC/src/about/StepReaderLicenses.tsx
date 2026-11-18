import { FullText, LicenseCard, linkClass } from './licenseParts';
import { stepReaderDistribution, stepReaderLicenses } from './stepReaderLicenseData';

/** Notices, source and licenses for the STEP reader, which ships as its own LGPL WebAssembly module. */
export function StepReaderLicenses() {
  return (
    <section aria-labelledby="step-reader-notices-title">
      <h2 id="step-reader-notices-title" className="text-xl font-semibold">
        STEP reader notices and source
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        STEP files are read with occt-import-js, which makes use of facilities provided by the Open CASCADE Technology software.
      </p>
      <ul className="mt-3 space-y-2">
        <li>
          <a className={linkClass} href={stepReaderDistribution.noticeUrl} download>
            Download STEP reader notices
          </a>
        </li>
        <li>
          <a className={linkClass} href={stepReaderDistribution.sourceUrl} download>
            Download occt-import-js source archive
          </a>
        </li>
        <li>
          <a className={linkClass} href={stepReaderDistribution.manifestUrl}>
            View STEP reader provenance and checksums
          </a>
        </li>
        <li>
          <a className={linkClass} href={stepReaderDistribution.upstreamSource} target="_blank" rel="noreferrer">
            Upstream occt-import-js source and rebuild instructions
          </a>
        </li>
        <li>
          <a className={linkClass} href={stepReaderDistribution.occtSource} target="_blank" rel="noreferrer">
            Open CASCADE Technology source
          </a>
        </li>
      </ul>
      <FullText name="STEP reader notices" text={stepReaderDistribution.notice} />
      <div className="mt-4 space-y-4">
        {stepReaderLicenses.map(dependency => (
          <LicenseCard key={dependency.id} dependency={dependency} />
        ))}
      </div>
    </section>
  );
}
