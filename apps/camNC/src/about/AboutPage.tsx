import { PageHeader } from '@/components/page-header';
import { FullText, LicenseCard, linkClass } from './licenseParts';
import { applicationDistribution, dependencyLicenses, solverDistribution } from './licenses';
import { StepReaderLicenses } from './StepReaderLicenses';

export function AboutPage() {
  return (
    <div className="flex h-dvh min-w-0 flex-1 flex-col">
      <PageHeader title="About" />
      <main aria-labelledby="about-title" className="min-h-0 flex-1 overflow-y-auto px-4 py-6 pb-28 sm:px-6">
        <div className="mx-auto max-w-3xl space-y-8">
          <section aria-labelledby="about-title">
            <h1 id="about-title" className="text-2xl font-semibold">
              About camNC
            </h1>
            <p className="mt-2 text-muted-foreground">Design flat parts, prepare their cuts, and machine them in one workspace.</p>
            <p className="mt-3 text-sm">
              camNC is open source under the Apache License 2.0. Its CAD solver and other components retain their own licenses.
            </p>
            <p className="mt-3">
              <a className={linkClass} href={applicationDistribution.licenseUrl} download>
                Download camNC Apache 2.0 license
              </a>
            </p>
            <FullText name="camNC Apache 2.0 license" text={applicationDistribution.text} />
          </section>

          <section aria-labelledby="solver-notices-title">
            <h2 id="solver-notices-title" className="text-xl font-semibold">
              CAD solver notices and source
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The full notices, license texts and pinned library source are included with this application.
            </p>
            <ul className="mt-3 space-y-2">
              <li>
                <a className={linkClass} href={solverDistribution.noticeUrl} download>
                  Download third-party notices
                </a>
              </li>
              <li>
                <a className={linkClass} href={solverDistribution.sourceUrl} download>
                  Download PlaneGCS source archive
                </a>
              </li>
              <li>
                <a className={linkClass} href={solverDistribution.manifestUrl}>
                  View source provenance and checksums
                </a>
              </li>
              <li>
                <a className={linkClass} href={solverDistribution.upstreamSource} target="_blank" rel="noreferrer">
                  Upstream source and rebuild instructions
                </a>
              </li>
            </ul>
            <FullText name="third-party notices" text={solverDistribution.notice} />
          </section>

          <section aria-labelledby="dependency-licenses-title">
            <h2 id="dependency-licenses-title" className="text-xl font-semibold">
              Solver component licenses
            </h2>
            <div className="mt-4 space-y-4">
              {dependencyLicenses.map(dependency => (
                <LicenseCard key={dependency.id} dependency={dependency} />
              ))}
            </div>
          </section>

          <StepReaderLicenses />
        </div>
      </main>
    </div>
  );
}
