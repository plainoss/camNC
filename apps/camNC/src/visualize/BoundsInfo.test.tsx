import { i18n } from '@wbcnc/i18n';
import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoundsInfo } from './BoundsInfo';
import { getTimeAgoLocale } from './timeAgoLocale';

const pnpResult = vi.hoisted(() => ({ lastPnPTime: Date.now() - 120_000, lastReprojectionError: 0.2 }));
const camera = vi.hoisted(() => ({ ready: true }));

vi.mock('@/store/store', () => ({
  useStore: (selector: (state: { toolpath: undefined }) => unknown) => selector({ toolpath: undefined }),
  usePnPResult: () => pnpResult,
  useIsCameraReady: () => camera.ready,
}));
vi.mock('@tanstack/react-router', () => ({
  ClientOnly: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('./RecomputePnpButton', () => ({ RecomputePnpButton: () => null }));

afterEach(() => {
  void i18n.changeLanguage('en');
  cleanup();
  camera.ready = true;
  vi.restoreAllMocks();
});

describe('relative-time locale', () => {
  it.each(['en-US@posix', 'en_US', ''])('falls back to English for invalid locale %s', language => {
    expect(getTimeAgoLocale(language)).toBe('en');
  });

  it('falls back to English when no browser locale is available', () => {
    expect(getTimeAgoLocale(undefined)).toBe('en');
  });

  it('preserves and canonicalizes valid non-English locales', () => {
    expect(getTimeAgoLocale('de-at')).toBe('de-AT');
  });
});

describe('BoundsInfo relative time', () => {
  it.each([
    { language: 'en', expectedLocale: 'en' },
    { language: 'fr', expectedLocale: 'fr' },
  ])('renders relative time in application language $language', async ({ language, expectedLocale }) => {
    await i18n.changeLanguage(language);
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-AT');
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['de-AT']);
    pnpResult.lastPnPTime = Date.now() - 120_000;

    const { container } = render(<BoundsInfo />);

    expect(container.querySelector('time')?.textContent).toBe(
      new Intl.RelativeTimeFormat(expectedLocale, { numeric: 'auto', style: 'long' }).format(-2, 'minute')
    );
  });
});

describe('BoundsInfo without a camera', () => {
  it('leaves out the camera pose, e.g. one saved before the camera was removed', () => {
    camera.ready = false;
    const { container } = render(<BoundsInfo />);
    expect(container.textContent).not.toContain('PnP');
    expect(container.textContent).toContain('No program loaded');
  });
});
