import { describe, expect, it, vi } from 'vitest';

import { TwentyApiClient } from '../twenty-api';

describe('TwentyApiClient company capture', () => {
  it('creates a company with fields scraped from LinkedIn', async () => {
    const client = new TwentyApiClient('https://twenty.example');
    const graphqlRequest = vi
      .spyOn(client, 'graphqlRequest')
      .mockResolvedValue({
        data: {
          createCompany: {
            id: 'company-id',
            name: 'Twenty',
          },
        },
      });

    await client.createCompany({
      type: 'company',
      linkedinUrl: 'https://www.linkedin.com/company/twenty',
      name: 'Twenty',
      website: 'https://twenty.com',
      industry: 'Technology, Information and Internet',
      employeeCount: '34 employees',
    });

    expect(graphqlRequest).toHaveBeenCalledWith(
      expect.stringContaining('mutation CreateCompany'),
      {
        input: {
          name: 'Twenty',
          linkedinLink: {
            primaryLinkUrl: 'https://www.linkedin.com/company/twenty',
            primaryLinkLabel: 'LinkedIn',
          },
          domainName: {
            primaryLinkUrl: 'https://twenty.com',
            primaryLinkLabel: 'Website',
          },
          employees: 34,
          industry: 'Technology, Information and Internet',
        },
      },
    );
  });
});
