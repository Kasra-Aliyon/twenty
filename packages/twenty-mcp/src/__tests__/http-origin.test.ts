import { httpTransportTesting } from '../transports/http.transport.js';

describe('HTTP origin authorization behind a production proxy', () => {
  it('allows a configured HTTPS origin while binding to all container interfaces', () => {
    expect(
      httpTransportTesting.isAllowedOrigin(
        'https://mcp.example.com',
        '0.0.0.0',
        ['https://mcp.example.com'],
      ),
    ).toBe(true);
  });

  it.each([
    'https://mcp.example.com.attacker.test',
    'http://mcp.example.com',
    'https://mcp.example.com:444',
    'https://mcp.example.com/path',
    'null',
  ])('rejects an untrusted or malformed origin: %s', (origin) => {
    expect(
      httpTransportTesting.isAllowedOrigin(origin, '0.0.0.0', [
        'https://mcp.example.com',
      ]),
    ).toBe(false);
  });

  it('allows native MCP clients without an Origin header', () => {
    expect(httpTransportTesting.isAllowedOrigin(undefined, '0.0.0.0')).toBe(
      true,
    );
  });
});
