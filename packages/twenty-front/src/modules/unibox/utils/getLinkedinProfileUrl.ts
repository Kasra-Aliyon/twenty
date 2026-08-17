import { type LinksMetadata } from 'twenty-shared/types';

type LinkedinProfileIdentity = {
  handle?: string | null;
  profileUrl?: LinksMetadata | null;
};

export const getLinkedinProfileUrl = ({
  handle,
  profileUrl,
}: LinkedinProfileIdentity) => {
  const directProfileUrl = profileUrl?.primaryLinkUrl?.trim();

  if (directProfileUrl) {
    return directProfileUrl;
  }

  const normalizedHandle = handle?.trim();

  if (!normalizedHandle) {
    return null;
  }

  if (
    normalizedHandle.startsWith('https://') ||
    normalizedHandle.startsWith('http://')
  ) {
    return normalizedHandle;
  }

  return `https://www.linkedin.com/in/${normalizedHandle.replace(/^\/+|\/+$/g, '')}`;
};
