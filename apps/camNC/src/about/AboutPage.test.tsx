import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AboutPage } from './AboutPage';
import { applicationDistribution, dependencyLicenses, solverDistribution } from './licenses';
import { stepReaderDistribution, stepReaderLicenses } from './stepReaderLicenses';

vi.mock('@/components/page-header', () => ({ PageHeader: () => <header>About</header> }));

afterEach(cleanup);

describe('About licenses', () => {
  it('lets users read full shipped licenses without a network request or sign-in', () => {
    render(<AboutPage />);
    expect(screen.getByRole('heading', { name: 'About camNC', level: 1 })).toBeTruthy();
    for (const dependency of [...dependencyLicenses, ...stepReaderLicenses]) {
      const section = screen.getByRole('region', { name: dependency.name });
      const disclosure = within(section).getByText(`Read ${dependency.name} license`);
      const details = disclosure.closest('details')!;
      expect(details.open).toBe(false);
      fireEvent.click(disclosure);
      expect(details.open).toBe(true);
      const text = within(section).getByRole('region', { name: `${dependency.name} license` });
      expect(text.textContent).toBe(dependency.text);
      expect(text.getAttribute('tabindex')).toBe('0');
      const download = within(section).getByRole('link', { name: `Download ${dependency.name} license` });
      expect(download.getAttribute('href')).toBe(dependency.url);
      expect(download.hasAttribute('download')).toBe(true);
    }
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('exposes the matching application license, notices, source and provenance from the page', () => {
    render(<AboutPage />);
    expect(screen.getByRole('link', { name: 'Download camNC Apache 2.0 license' }).getAttribute('href')).toBe(
      applicationDistribution.licenseUrl
    );
    expect(screen.getByRole('link', { name: 'Download third-party notices' }).getAttribute('href')).toBe(solverDistribution.noticeUrl);
    expect(screen.getByRole('link', { name: 'Download PlaneGCS source archive' }).getAttribute('href')).toBe(solverDistribution.sourceUrl);
    expect(screen.getByRole('link', { name: 'View source provenance and checksums' }).getAttribute('href')).toBe(
      solverDistribution.manifestUrl
    );
    fireEvent.click(screen.getByText('Read third-party notices'));
    expect(screen.getByRole('region', { name: 'third-party notices' }).textContent).toBe(solverDistribution.notice);
    fireEvent.click(screen.getByText('Read camNC Apache 2.0 license'));
    expect(screen.getByRole('region', { name: 'camNC Apache 2.0 license' }).textContent).toBe(applicationDistribution.text);
  });

  it('exposes the STEP reader notices, OCCT exception, source and provenance from the page', () => {
    render(<AboutPage />);
    expect(screen.getByRole('link', { name: 'Download STEP reader notices' }).getAttribute('href')).toBe(stepReaderDistribution.noticeUrl);
    expect(screen.getByRole('link', { name: 'Download occt-import-js source archive' }).getAttribute('href')).toBe(
      stepReaderDistribution.sourceUrl
    );
    expect(screen.getByRole('link', { name: 'View STEP reader provenance and checksums' }).getAttribute('href')).toBe(
      stepReaderDistribution.manifestUrl
    );
    expect(screen.getByRole('link', { name: 'Open CASCADE Technology source' }).getAttribute('href')).toBe(
      stepReaderDistribution.occtSource
    );
    fireEvent.click(screen.getByText('Read STEP reader notices'));
    const notices = screen.getByRole('region', { name: 'STEP reader notices' });
    expect(notices.textContent).toBe(stepReaderDistribution.notice);
    expect(notices.textContent).toContain('makes use of facilities provided by the Open CASCADE Technology software');
    expect(stepReaderLicenses.find(license => license.id === 'occt-exception')?.text).toContain('Open CASCADE exception');
  });
});
