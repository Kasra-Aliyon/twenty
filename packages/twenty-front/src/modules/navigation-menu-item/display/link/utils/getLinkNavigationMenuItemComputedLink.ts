import { type NavigationMenuItem } from '~/generated-metadata/graphql';

export const getLinkNavigationMenuItemComputedLink = (
  item: Pick<NavigationMenuItem, 'link'>,
): string => {
  const linkUrl = (item.link ?? '').trim();
  if (linkUrl.startsWith('http://') || linkUrl.startsWith('https://')) {
    return linkUrl;
  }
  if (linkUrl.startsWith('//')) {
    return `https:${linkUrl}`;
  }
  if (linkUrl.startsWith('/')) {
    return linkUrl;
  }
  return linkUrl ? `https://${linkUrl}` : '';
};
