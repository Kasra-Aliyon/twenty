import { getLinkNavigationMenuItemComputedLink } from '@/navigation-menu-item/display/link/utils/getLinkNavigationMenuItemComputedLink';

describe('getLinkNavigationMenuItemComputedLink', () => {
  it('should preserve an internal application path', () => {
    expect(getLinkNavigationMenuItemComputedLink({ link: '/lists' })).toBe(
      '/lists',
    );
  });

  it('should preserve an absolute HTTP URL', () => {
    expect(
      getLinkNavigationMenuItemComputedLink({ link: 'https://example.com' }),
    ).toBe('https://example.com');
  });

  it('should add HTTPS to a bare external URL', () => {
    expect(getLinkNavigationMenuItemComputedLink({ link: 'example.com' })).toBe(
      'https://example.com',
    );
  });

  it('should not treat a protocol-relative URL as an internal path', () => {
    expect(
      getLinkNavigationMenuItemComputedLink({ link: '//example.com' }),
    ).toBe('https://example.com');
  });
});
