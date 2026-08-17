import { getLinkedinProfileUrl } from '@/unibox/utils/getLinkedinProfileUrl';

describe('getLinkedinProfileUrl', () => {
  it('prefers the synchronized profile URL', () => {
    expect(
      getLinkedinProfileUrl({
        handle: 'fallback-handle',
        profileUrl: {
          primaryLinkLabel: 'LinkedIn',
          primaryLinkUrl: 'https://www.linkedin.com/in/synchronized-profile',
          secondaryLinks: [],
        },
      }),
    ).toBe('https://www.linkedin.com/in/synchronized-profile');
  });

  it('builds a profile URL from a public handle', () => {
    expect(getLinkedinProfileUrl({ handle: '/public-handle/' })).toBe(
      'https://www.linkedin.com/in/public-handle',
    );
  });

  it('preserves a full profile URL stored as the handle', () => {
    expect(
      getLinkedinProfileUrl({
        handle: 'https://www.linkedin.com/in/already-a-url',
      }),
    ).toBe('https://www.linkedin.com/in/already-a-url');
  });

  it('returns null when no public profile identity is available', () => {
    expect(
      getLinkedinProfileUrl({ handle: null, profileUrl: null }),
    ).toBeNull();
  });
});
