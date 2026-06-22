export type ApolloPhoneNumber = {
  raw_number?: string | null;
  sanitized_number?: string | null;
  type?: string | null;
};

export type ApolloOrganization = {
  id?: string | null;
  name?: string | null;
  primary_domain?: string | null;
  domain?: string | null;
  website_url?: string | null;
  website?: string | null;
  linkedin_url?: string | null;
  linkedin?: string | null;
  estimated_num_employees?: number | string | null;
  employees?: number | string | null;
  num_employees?: number | string | null;
};

export type ApolloPerson = {
  id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  email?: string | null;
  sanitized_email?: string | null;
  personal_email?: string | null;
  title?: string | null;
  headline?: string | null;
  linkedin_url?: string | null;
  phone?: string | null;
  sanitized_phone?: string | null;
  phone_numbers?: ApolloPhoneNumber[] | null;
  organization?: ApolloOrganization | null;
  company?: ApolloOrganization | null;
};

export type ApolloPersonMatchResponse = {
  person?: ApolloPerson | null;
  organization?: ApolloOrganization | null;
};

export type ApolloOrganizationEnrichResponse = {
  organization?: ApolloOrganization | null;
};

export type ApolloPersonMatchInput = {
  email?: string;
  firstName?: string;
  lastName?: string;
  linkedinUrl?: string;
  organizationName?: string;
};

export type ApolloOrganizationMatchInput = {
  domain?: string;
  linkedinUrl?: string;
  name?: string;
  website?: string;
};
