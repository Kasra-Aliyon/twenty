import { Injectable } from '@nestjs/common';

import { type FullNameMetadata, type LinksMetadata } from 'twenty-shared/types';

import {
  type ApolloOrganization,
  type ApolloPerson,
  type ApolloPersonMatchInput,
} from 'src/modules/apollo-enrichment/types/apollo-api.type';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';

export type ApolloCompanyMappedFields = {
  name?: string;
  domain?: string;
  domainName?: LinksMetadata;
  linkedinLink?: LinksMetadata;
  employees?: number;
};

export type ApolloPersonMappedFields = Partial<
  Pick<
    PersonWorkspaceEntity,
    'name' | 'emails' | 'phones' | 'linkedinLink' | 'jobTitle' | 'companyId'
  >
>;

@Injectable()
export class ApolloEnrichmentMapperService {
  shouldEnrichPerson(
    person: Pick<
      PersonWorkspaceEntity,
      'name' | 'emails' | 'phones' | 'linkedinLink' | 'companyId'
    >,
  ): boolean {
    return this.hasEnrichmentGap(person) && this.hasEnoughMatchInput(person);
  }

  shouldEnrichAfterUpdate({
    before,
    after,
    changedFields,
  }: {
    before: Pick<
      PersonWorkspaceEntity,
      'name' | 'emails' | 'phones' | 'linkedinLink' | 'companyId'
    >;
    after: Pick<
      PersonWorkspaceEntity,
      'name' | 'emails' | 'phones' | 'linkedinLink' | 'companyId'
    >;
    changedFields: string[];
  }): boolean {
    if (!this.shouldEnrichPerson(after)) {
      return false;
    }

    if (
      changedFields.includes('linkedinLink') &&
      !hasText(before.linkedinLink?.primaryLinkUrl) &&
      hasText(after.linkedinLink?.primaryLinkUrl)
    ) {
      return true;
    }

    return false;
  }

  buildPersonMatchInput(
    person: Pick<PersonWorkspaceEntity, 'name' | 'emails' | 'linkedinLink'>,
  ): ApolloPersonMatchInput | undefined {
    const linkedinUrl = this.cleanLinkedinUrl(
      person.linkedinLink?.primaryLinkUrl,
    );

    if (hasText(linkedinUrl)) {
      return {
        linkedinUrl,
      };
    }

    const email = this.cleanEmail(person.emails?.primaryEmail);
    const firstName = cleanText(person.name?.firstName);
    const lastName = cleanText(person.name?.lastName);

    if (!hasText(email) && !this.hasNameMatchInput(person.name)) {
      return undefined;
    }

    return {
      ...(hasText(email) ? { email } : {}),
      ...(hasText(firstName) ? { firstName } : {}),
      ...(hasText(lastName) ? { lastName } : {}),
    };
  }

  mapApolloPersonToTwentyUpdate({
    person,
    apolloPerson,
    companyId,
  }: {
    person: PersonWorkspaceEntity;
    apolloPerson: ApolloPerson;
    companyId?: string;
  }): ApolloPersonMappedFields {
    const update: ApolloPersonMappedFields = {};
    const apolloName = this.extractApolloName(apolloPerson);

    if (this.shouldUpdateName(person.name, apolloName)) {
      update.name = {
        firstName: hasText(person.name?.firstName)
          ? person.name.firstName
          : apolloName.firstName,
        lastName: hasText(person.name?.lastName)
          ? person.name.lastName
          : apolloName.lastName,
      };
    }

    const email = this.extractApolloEmail(apolloPerson);

    if (!hasText(person.emails?.primaryEmail) && hasText(email)) {
      update.emails = {
        primaryEmail: email,
        additionalEmails: person.emails?.additionalEmails ?? null,
      };
    }

    const phone = this.extractApolloPhone(apolloPerson);

    if (!hasText(person.phones?.primaryPhoneNumber) && hasText(phone)) {
      update.phones = {
        primaryPhoneNumber: phone,
        primaryPhoneCountryCode: person.phones?.primaryPhoneCountryCode ?? '',
        primaryPhoneCallingCode: person.phones?.primaryPhoneCallingCode ?? '',
        additionalPhones: person.phones?.additionalPhones ?? null,
      };
    }

    const linkedinUrl = this.cleanLinkedinUrl(apolloPerson.linkedin_url);

    if (!hasText(person.linkedinLink?.primaryLinkUrl) && hasText(linkedinUrl)) {
      update.linkedinLink = this.buildLinkMetadata(linkedinUrl);
    }

    const jobTitle = cleanText(apolloPerson.title ?? apolloPerson.headline);

    if (!hasText(person.jobTitle) && hasText(jobTitle)) {
      update.jobTitle = jobTitle;
    }

    if (!hasText(person.companyId) && hasText(companyId)) {
      update.companyId = companyId;
    }

    return update;
  }

  extractApolloOrganization(
    apolloPerson: ApolloPerson,
  ): ApolloOrganization | undefined {
    return apolloPerson.organization ?? apolloPerson.company ?? undefined;
  }

  mapApolloOrganization(
    apolloOrganization: ApolloOrganization | null | undefined,
  ): ApolloCompanyMappedFields | undefined {
    if (!apolloOrganization) {
      return undefined;
    }

    const domain = this.extractApolloOrganizationDomain(apolloOrganization);
    const linkedinUrl = this.cleanLinkedinUrl(
      apolloOrganization.linkedin_url ?? apolloOrganization.linkedin,
    );
    const name = cleanText(apolloOrganization.name);
    const employees = this.extractApolloEmployees(apolloOrganization);

    if (!hasText(domain) && !hasText(linkedinUrl) && !hasText(name)) {
      return undefined;
    }

    return {
      ...(hasText(name) ? { name } : {}),
      ...(hasText(domain)
        ? {
            domain,
            domainName: this.buildLinkMetadata(`https://${domain}`),
          }
        : {}),
      ...(hasText(linkedinUrl)
        ? { linkedinLink: this.buildLinkMetadata(linkedinUrl) }
        : {}),
      ...(employees !== undefined ? { employees } : {}),
    };
  }

  cleanLinkedinUrl(value: string | null | undefined): string | undefined {
    const url = cleanText(value);

    if (!hasText(url)) {
      return undefined;
    }

    try {
      const urlWithProtocol = hasProtocol(url) ? url : `https://${url}`;
      const parsedUrl = new URL(urlWithProtocol);

      parsedUrl.search = '';
      parsedUrl.hash = '';

      const normalizedPath = parsedUrl.pathname.replace(/\/$/, '');

      return `${parsedUrl.origin}${normalizedPath}`;
    } catch {
      return url;
    }
  }

  extractApolloOrganizationDomain(
    apolloOrganization: ApolloOrganization,
  ): string | undefined {
    return this.cleanDomain(
      apolloOrganization.primary_domain ??
        apolloOrganization.domain ??
        apolloOrganization.website_url ??
        apolloOrganization.website,
    );
  }

  cleanDomain(value: string | null | undefined): string | undefined {
    const domainOrUrl = cleanText(value);

    if (!hasText(domainOrUrl)) {
      return undefined;
    }

    try {
      const urlWithProtocol = hasProtocol(domainOrUrl)
        ? domainOrUrl
        : `https://${domainOrUrl}`;
      const parsedUrl = new URL(urlWithProtocol);

      return stripWww(parsedUrl.hostname.toLowerCase());
    } catch {
      return stripWww(domainOrUrl.toLowerCase().replace(/\/$/, ''));
    }
  }

  private hasEnrichmentGap(
    person: Pick<PersonWorkspaceEntity, 'emails' | 'phones' | 'companyId'>,
  ): boolean {
    return (
      !hasText(person.emails?.primaryEmail) ||
      !hasText(person.phones?.primaryPhoneNumber) ||
      !hasText(person.companyId)
    );
  }

  private hasEnoughMatchInput(
    person: Pick<PersonWorkspaceEntity, 'name' | 'emails' | 'linkedinLink'>,
  ): boolean {
    return (
      hasText(person.linkedinLink?.primaryLinkUrl) ||
      hasText(person.emails?.primaryEmail) ||
      this.hasNameMatchInput(person.name)
    );
  }

  private hasNameMatchInput(
    name: FullNameMetadata | null | undefined,
  ): boolean {
    return hasText(name?.firstName) && hasText(name?.lastName);
  }

  private shouldUpdateName(
    currentName: FullNameMetadata | null | undefined,
    apolloName: FullNameMetadata,
  ): boolean {
    return (
      (!hasText(currentName?.firstName) && hasText(apolloName.firstName)) ||
      (!hasText(currentName?.lastName) && hasText(apolloName.lastName))
    );
  }

  private extractApolloName(apolloPerson: ApolloPerson): FullNameMetadata {
    const firstName = cleanText(apolloPerson.first_name);
    const lastName = cleanText(apolloPerson.last_name);

    if (hasText(firstName) || hasText(lastName)) {
      return {
        firstName: firstName ?? '',
        lastName: lastName ?? '',
      };
    }

    const fullName = cleanText(apolloPerson.name);

    if (!hasText(fullName)) {
      return {
        firstName: '',
        lastName: '',
      };
    }

    const [parsedFirstName, ...lastNameParts] = fullName.split(/\s+/);

    return {
      firstName: parsedFirstName,
      lastName: lastNameParts.join(' '),
    };
  }

  private extractApolloEmail(apolloPerson: ApolloPerson): string | undefined {
    return this.cleanEmail(
      apolloPerson.email ??
        apolloPerson.sanitized_email ??
        apolloPerson.personal_email,
    );
  }

  private cleanEmail(value: string | null | undefined): string | undefined {
    return cleanText(value)?.toLowerCase();
  }

  private extractApolloPhone(apolloPerson: ApolloPerson): string | undefined {
    const firstApolloPhone = apolloPerson.phone_numbers?.find(
      (phoneNumber) =>
        hasText(phoneNumber.sanitized_number) ||
        hasText(phoneNumber.raw_number),
    );

    return cleanText(
      apolloPerson.sanitized_phone ??
        apolloPerson.phone ??
        firstApolloPhone?.sanitized_number ??
        firstApolloPhone?.raw_number,
    );
  }

  private extractApolloEmployees(
    apolloOrganization: ApolloOrganization,
  ): number | undefined {
    const rawEmployees =
      apolloOrganization.estimated_num_employees ??
      apolloOrganization.employees ??
      apolloOrganization.num_employees;

    if (typeof rawEmployees === 'number' && Number.isFinite(rawEmployees)) {
      return rawEmployees;
    }

    if (typeof rawEmployees !== 'string') {
      return undefined;
    }

    const parsedEmployees = Number.parseInt(rawEmployees, 10);

    return Number.isFinite(parsedEmployees) ? parsedEmployees : undefined;
  }

  private buildLinkMetadata(url: string): LinksMetadata {
    return {
      primaryLinkLabel: '',
      primaryLinkUrl: url,
      secondaryLinks: null,
    };
  }
}

export const cleanText = (
  value: string | null | undefined,
): string | undefined => {
  const trimmedValue = value?.trim();

  return hasText(trimmedValue) ? trimmedValue : undefined;
};

export const hasText = (value: string | null | undefined): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const hasProtocol = (value: string): boolean => /^https?:\/\//i.test(value);

const stripWww = (value: string): string => value.replace(/^www\./i, '');
