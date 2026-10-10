export const getDeploymentOrigin = (
  configuredUrl: string | undefined,
  fallback: string,
): string => {
  const url = new URL(configuredUrl || fallback);
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);

  if (
    (url.protocol !== 'https:' && !(isLocal && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error(
      'Twenty deployment URLs must be HTTPS origins (HTTP is allowed for localhost).',
    );
  }

  return url.origin;
};
