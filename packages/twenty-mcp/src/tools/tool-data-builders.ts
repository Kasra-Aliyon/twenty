export type PhoneInput = {
  number: string;
  countryCode: string;
  callingCode: string;
};

export type AddressInput = {
  street1?: string;
  street2?: string;
  city?: string;
  postcode?: string;
  state?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
};

export const compactRecord = (
  entries: Array<readonly [string, unknown]>,
): Record<string, unknown> =>
  Object.fromEntries(
    entries.filter((entry) => entry[1] !== undefined),
  ) as Record<string, unknown>;

export const buildLinksValue = (url: string): Record<string, unknown> => ({
  primaryLinkLabel: '',
  primaryLinkUrl: url,
  secondaryLinks: [],
});

export const buildEmailsValue = (
  emails: string[],
): Record<string, unknown> => ({
  primaryEmail: emails[0] ?? '',
  additionalEmails: emails.slice(1),
});

export const buildPhonesValue = (
  phones: PhoneInput[],
): Record<string, unknown> => {
  const primary = phones[0];

  return {
    primaryPhoneNumber: primary?.number ?? '',
    primaryPhoneCountryCode: primary?.countryCode ?? '',
    primaryPhoneCallingCode: primary?.callingCode ?? '',
    additionalPhones: phones.slice(1).map((phone) => ({
      number: phone.number,
      countryCode: phone.countryCode,
      callingCode: phone.callingCode,
    })),
  };
};

export const buildCurrencyValue = (
  amount: number,
  currencyCode: string,
): Record<string, unknown> => ({
  amountMicros: Math.round(amount * 1_000_000),
  currencyCode,
});

export const buildAddressValue = (
  address: AddressInput,
): Record<string, unknown> => ({
  addressStreet1: address.street1 ?? '',
  addressStreet2: address.street2 ?? '',
  addressCity: address.city ?? '',
  addressPostcode: address.postcode ?? '',
  addressState: address.state ?? '',
  addressCountry: address.country ?? '',
  addressLat: address.latitude ?? 0,
  addressLng: address.longitude ?? 0,
});

export const buildRichTextValue = (
  markdown: string,
): Record<string, unknown> => ({
  blocknote: null,
  markdown,
});
