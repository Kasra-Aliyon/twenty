import { Injectable } from '@nestjs/common';

import {
  type AddressMetadata,
  type ActorMetadata,
  type CurrencyMetadata,
  FieldActorSource,
  type FullNameMetadata,
  type LinksMetadata,
} from 'twenty-shared/types';

import {
  type ApolloOrganization,
  type ApolloOrganizationMatchInput,
  type ApolloPerson,
  type ApolloPersonMatchInput,
} from 'src/modules/apollo-enrichment/types/apollo-api.type';
import { type CompanyWorkspaceEntity } from 'src/modules/company/standard-objects/company.workspace-entity';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';

export type ApolloCompanyMappedFields = Partial<
  Pick<
    CompanyWorkspaceEntity,
    | 'address'
    | 'annualRevenue'
    | 'employees'
    | 'industry'
    | 'keywords'
    | 'linkedinLink'
    | 'name'
    | 'technologies'
  >
> & {
  domain?: string;
  domainName?: LinksMetadata;
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
      'name' | 'emails' | 'phones' | 'linkedinLink' | 'companyId' | 'createdBy'
    >,
  ): boolean {
    return this.hasEnrichmentGap(person) && this.hasEnoughMatchInput(person);
  }

  shouldEnrichPersonGeneral(
    person: Pick<
      PersonWorkspaceEntity,
      | 'name'
      | 'emails'
      | 'linkedinLink'
      | 'jobTitle'
      | 'companyId'
      | 'createdBy'
    >,
  ): boolean {
    const hasGeneralEnrichmentGap =
      !hasText(person.name?.firstName) ||
      !hasText(person.name?.lastName) ||
      !hasText(person.emails?.primaryEmail) ||
      this.canRefreshPrimaryEmailFromApollo(person) ||
      !hasText(person.linkedinLink?.primaryLinkUrl) ||
      !hasText(person.jobTitle) ||
      !hasText(person.companyId);

    return hasGeneralEnrichmentGap && this.hasEnoughMatchInput(person);
  }

  shouldEnrichPersonPhone(
    person: Pick<
      PersonWorkspaceEntity,
      'name' | 'emails' | 'phones' | 'linkedinLink'
    >,
  ): boolean {
    return (
      !hasText(person.phones?.primaryPhoneNumber) &&
      this.hasEnoughMatchInput(person)
    );
  }

  shouldEnrichAfterUpdate({
    before,
    after,
    changedFields,
  }: {
    before: Pick<
      PersonWorkspaceEntity,
      | 'name'
      | 'emails'
      | 'phones'
      | 'linkedinLink'
      | 'companyId'
      | 'createdBy'
      | 'deletedAt'
    >;
    after: Pick<
      PersonWorkspaceEntity,
      | 'name'
      | 'emails'
      | 'phones'
      | 'linkedinLink'
      | 'companyId'
      | 'createdBy'
      | 'deletedAt'
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

    if (
      changedFields.includes('deletedAt') &&
      before.deletedAt !== null &&
      after.deletedAt === null
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
    const email = this.cleanEmail(person.emails?.primaryEmail);
    const firstName = cleanText(person.name?.firstName);
    const lastName = cleanText(person.name?.lastName);

    if (
      !hasText(linkedinUrl) &&
      !hasText(email) &&
      !this.hasNameMatchInput(person.name)
    ) {
      return undefined;
    }

    return {
      ...(hasText(email) ? { email } : {}),
      ...(hasText(firstName) ? { firstName } : {}),
      ...(hasText(lastName) ? { lastName } : {}),
      ...(hasText(linkedinUrl) ? { linkedinUrl } : {}),
    };
  }

  buildOrganizationMatchInput(
    company: Pick<
      CompanyWorkspaceEntity,
      'domainName' | 'linkedinLink' | 'name'
    >,
  ): ApolloOrganizationMatchInput | undefined {
    const domain = this.cleanDomain(company.domainName?.primaryLinkUrl);
    const linkedinUrl = this.cleanLinkedinUrl(
      company.linkedinLink?.primaryLinkUrl,
    );
    const name = cleanText(company.name);
    const website = cleanText(company.domainName?.primaryLinkUrl);

    if (
      !hasText(domain) &&
      !hasText(linkedinUrl) &&
      !hasText(name) &&
      !hasText(website)
    ) {
      return undefined;
    }

    return {
      ...(hasText(domain) ? { domain } : {}),
      ...(hasText(linkedinUrl) ? { linkedinUrl } : {}),
      ...(hasText(name) ? { name } : {}),
      ...(hasText(website) ? { website } : {}),
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

    if (hasText(email) && this.shouldUpdatePrimaryEmail({ person, email })) {
      const additionalEmails = this.mergeAdditionalEmails({
        currentPrimaryEmail: email,
        currentAdditionalEmails: person.emails?.additionalEmails,
        apolloEmails: apolloPerson.personal_emails,
      });

      update.emails = {
        primaryEmail: email,
        additionalEmails,
      };
    } else {
      const additionalEmails = this.mergeAdditionalEmails({
        currentPrimaryEmail: person.emails?.primaryEmail,
        currentAdditionalEmails: person.emails?.additionalEmails,
        apolloEmails: apolloPerson.personal_emails,
      });

      if (
        JSON.stringify(additionalEmails) !==
        JSON.stringify(person.emails?.additionalEmails ?? null)
      ) {
        update.emails = {
          primaryEmail: person.emails?.primaryEmail ?? '',
          additionalEmails,
        };
      }
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

  mapApolloPersonPhoneToTwentyUpdate({
    person,
    apolloPerson,
  }: {
    person: PersonWorkspaceEntity;
    apolloPerson: ApolloPerson;
  }): ApolloPersonMappedFields {
    if (hasText(person.phones?.primaryPhoneNumber)) {
      return {};
    }

    const phone = this.extractApolloPhone(apolloPerson);

    if (!hasText(phone)) {
      return {};
    }

    return {
      phones: {
        primaryPhoneNumber: phone,
        primaryPhoneCountryCode: person.phones?.primaryPhoneCountryCode ?? '',
        primaryPhoneCallingCode: person.phones?.primaryPhoneCallingCode ?? '',
        additionalPhones: person.phones?.additionalPhones ?? null,
      },
    };
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
    const industry = cleanText(apolloOrganization.industry);
    const keywords = this.cleanStringArray(apolloOrganization.keywords);
    const technologies = this.extractApolloTechnologies(apolloOrganization);
    const annualRevenue = this.extractApolloAnnualRevenue(apolloOrganization);
    const address = this.extractApolloAddress(apolloOrganization);

    if (
      !hasText(domain) &&
      !hasText(linkedinUrl) &&
      !hasText(name) &&
      employees === undefined &&
      !hasText(industry) &&
      keywords.length === 0 &&
      technologies.length === 0 &&
      annualRevenue === undefined &&
      address === undefined
    ) {
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
      ...(hasText(industry) ? { industry } : {}),
      ...(keywords.length > 0 ? { keywords } : {}),
      ...(technologies.length > 0 ? { technologies } : {}),
      ...(annualRevenue ? { annualRevenue } : {}),
      ...(address ? { address } : {}),
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
    person: Pick<
      PersonWorkspaceEntity,
      'emails' | 'phones' | 'companyId' | 'createdBy'
    >,
  ): boolean {
    return (
      !hasText(person.emails?.primaryEmail) ||
      this.canRefreshPrimaryEmailFromApollo(person) ||
      !hasText(person.phones?.primaryPhoneNumber) ||
      !hasText(person.companyId)
    );
  }

  private shouldUpdatePrimaryEmail({
    person,
    email,
  }: {
    person: Pick<PersonWorkspaceEntity, 'emails' | 'createdBy'>;
    email: string;
  }): boolean {
    const currentPrimaryEmail = this.cleanEmail(person.emails?.primaryEmail);

    if (!hasText(currentPrimaryEmail)) {
      return true;
    }

    return (
      currentPrimaryEmail !== email &&
      this.canRefreshPrimaryEmailFromApollo(person)
    );
  }

  private canRefreshPrimaryEmailFromApollo(
    person: Pick<PersonWorkspaceEntity, 'createdBy'>,
  ): boolean {
    return isApolloRefreshableContactSource(person.createdBy);
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

  private mergeAdditionalEmails({
    currentPrimaryEmail,
    currentAdditionalEmails,
    apolloEmails,
  }: {
    currentPrimaryEmail: string | null | undefined;
    currentAdditionalEmails: string[] | null | undefined;
    apolloEmails: string[] | null | undefined;
  }): string[] | null {
    const cleanPrimaryEmail = this.cleanEmail(currentPrimaryEmail);
    const mergedEmails = [
      ...(currentAdditionalEmails ?? []),
      ...(apolloEmails ?? []),
    ]
      .map((email) => this.cleanEmail(email))
      .filter(
        (email): email is string =>
          hasText(email) && email !== cleanPrimaryEmail,
      );
    const uniqueEmails = [...new Set(mergedEmails)];

    return uniqueEmails.length > 0 ? uniqueEmails : null;
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

  private extractApolloAnnualRevenue(
    apolloOrganization: ApolloOrganization,
  ): CurrencyMetadata | undefined {
    const revenue = this.parseNumber(
      apolloOrganization.annual_revenue ??
        apolloOrganization.organization_revenue,
    );

    if (revenue === undefined || revenue < 0) {
      return undefined;
    }

    return {
      amountMicros: revenue * 1_000_000,
      currencyCode: 'USD',
    };
  }

  private extractApolloAddress(
    apolloOrganization: ApolloOrganization,
  ): AddressMetadata | undefined {
    const addressStreet1 = cleanText(
      apolloOrganization.street_address ?? apolloOrganization.raw_address,
    );
    const addressCity = cleanText(apolloOrganization.city);
    const addressState = cleanText(apolloOrganization.state);
    const addressZipCode = cleanText(apolloOrganization.postal_code);
    const addressCountry = cleanText(apolloOrganization.country);
    const addressLat = this.parseNumber(apolloOrganization.latitude) ?? 0;
    const addressLng = this.parseNumber(apolloOrganization.longitude) ?? 0;

    if (
      !hasText(addressStreet1) &&
      !hasText(addressCity) &&
      !hasText(addressState) &&
      !hasText(addressZipCode) &&
      !hasText(addressCountry) &&
      addressLat === 0 &&
      addressLng === 0
    ) {
      return undefined;
    }

    return {
      addressStreet1: addressStreet1 ?? '',
      addressStreet2: '',
      addressCity: addressCity ?? '',
      addressState: addressState ?? '',
      addressZipCode: addressZipCode ?? '',
      addressCountry: addressCountry ?? '',
      addressLat,
      addressLng,
    };
  }

  private extractApolloTechnologies(
    apolloOrganization: ApolloOrganization,
  ): string[] {
    return this.cleanStringArray([
      ...(apolloOrganization.technologies ?? []),
      ...(apolloOrganization.current_technologies ?? []).map(
        (technology) => technology.name ?? '',
      ),
    ]);
  }

  private cleanStringArray(values: string[] | null | undefined): string[] {
    return [
      ...new Set(
        (values ?? [])
          .map((value) => cleanText(value))
          .filter((value): value is string => hasText(value)),
      ),
    ];
  }

  private parseNumber(
    value: number | string | null | undefined,
  ): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value !== 'string') {
      return undefined;
    }

    const parsedValue = Number(value.replace(/,/g, ''));

    return Number.isFinite(parsedValue) ? parsedValue : undefined;
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

const APOLLO_REFRESHABLE_CONTACT_SOURCES = new Set<FieldActorSource>([
  FieldActorSource.API,
  FieldActorSource.APPLICATION,
  FieldActorSource.CALENDAR,
  FieldActorSource.EMAIL,
]);

const isApolloRefreshableContactSource = (
  createdBy: ActorMetadata | null | undefined,
): boolean =>
  createdBy?.source !== undefined &&
  APOLLO_REFRESHABLE_CONTACT_SOURCES.has(createdBy.source);
