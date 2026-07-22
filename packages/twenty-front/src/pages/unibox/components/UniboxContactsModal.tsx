import { styled } from '@linaria/react';
import { format } from 'date-fns';
import { useState } from 'react';
import { generatePath, Link } from 'react-router-dom';
import { AppPath } from 'twenty-shared/types';
import { Avatar } from 'twenty-ui/data-display';
import { Checkbox, Button, SearchInput } from 'twenty-ui/input';
import { ModalContent, ModalFooter, ModalHeader } from 'twenty-ui/surfaces';
import { themeCssVariables } from 'twenty-ui/theme-constants';
import { useDebounce } from 'use-debounce';

import { CustomResolverFetchMoreLoader } from '@/activities/components/CustomResolverFetchMoreLoader';
import { useUniboxContacts } from '@/unibox/hooks/useUniboxContacts';
import {
  type UniboxContactCrmFilter,
  type UniboxContactSince,
} from '@/unibox/types/UniboxThread';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { ModalStatefulWrapper } from '@/ui/layout/modal/components/ModalStatefulWrapper';
import { UniboxAddToRecordListButton } from '~/pages/unibox/components/UniboxRecordListControls';
import { t } from '@lingui/core/macro';

export const UNIBOX_CONTACTS_MODAL_ID = 'unibox-contacts';

const StyledHeader = styled.div`
  display: flex;
  flex: 1;
  justify-content: space-between;
`;

const StyledControls = styled.div`
  align-items: center;
  border-bottom: 1px solid ${themeCssVariables.border.color.medium};
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  padding: ${themeCssVariables.spacing[3]};
`;

const StyledSearch = styled.div`
  flex: 1;
`;

const StyledSelect = styled.select`
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.secondary};
  height: 30px;
  padding: 0 ${themeCssVariables.spacing[2]};
`;

const StyledFilterTabs = styled.div`
  display: flex;
`;

const StyledFilterTab = styled.button<{ isActive: boolean }>`
  background: ${({ isActive }) =>
    isActive
      ? themeCssVariables.background.transparent.blue
      : themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  color: ${themeCssVariables.font.color.secondary};
  cursor: pointer;
  font-size: ${themeCssVariables.font.size.xs};
  padding: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[2]};
`;

const StyledList = styled.div`
  height: min(58vh, 560px);
  overflow-y: auto;
`;

const StyledSelectAll = styled.button`
  all: unset;
  color: ${themeCssVariables.color.blue};
  cursor: pointer;
  font-size: ${themeCssVariables.font.size.sm};
  padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[4]};
`;

const StyledRow = styled.div`
  align-items: center;
  border-bottom: 1px solid ${themeCssVariables.border.color.light};
  contain: content;
  contain-intrinsic-size: auto 76px;
  content-visibility: auto;
  display: grid;
  gap: ${themeCssVariables.spacing[3]};
  grid-template-columns: 20px 32px minmax(0, 1fr) auto;
  padding: ${themeCssVariables.spacing[3]} ${themeCssVariables.spacing[4]};
`;

const StyledContact = styled.div`
  min-width: 0;
`;

const StyledName = styled.div`
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.sm};
  font-weight: ${themeCssVariables.font.weight.medium};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledHandle = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
`;

const StyledSecondary = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
  margin-top: ${themeCssVariables.spacing[1]};
`;

const StyledPersonLink = styled(Link)`
  color: ${themeCssVariables.color.blue};
  font-size: ${themeCssVariables.font.size.xs};
  text-decoration: none;
  white-space: nowrap;
`;

const StyledStatus = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  padding: ${themeCssVariables.spacing[8]};
  text-align: center;
`;

const StyledFooter = styled.div`
  align-items: center;
  display: flex;
  flex: 1;
  gap: ${themeCssVariables.spacing[2]};
  justify-content: flex-end;
`;

export const UniboxContactsModal = () => {
  const [search, setSearch] = useState('');
  const [debouncedSearch] = useDebounce(search, 300);
  const [since, setSince] = useState<UniboxContactSince>('LIFETIME');
  const [inCrmFilter, setInCrmFilter] =
    useState<UniboxContactCrmFilter>('NOT_IN_CRM');
  const [selectedHandles, setSelectedHandles] = useState<string[]>([]);
  const [isAllMatchingSelected, setIsAllMatchingSelected] = useState(false);
  const [excludedHandles, setExcludedHandles] = useState<string[]>([]);
  const { enqueueSuccessSnackBar, enqueueErrorSnackBar } = useSnackBar();
  const {
    contacts,
    totalCount,
    loading,
    isFetchingMore,
    isAdding,
    fetchMoreContacts,
    addContacts,
    contactFilter,
    error,
  } = useUniboxContacts({
    search: debouncedSearch,
    since,
    inCrmFilter,
  });

  const resetSelection = () => {
    setSelectedHandles([]);
    setExcludedHandles([]);
    setIsAllMatchingSelected(false);
  };

  const selectedCount = isAllMatchingSelected
    ? Math.max(totalCount - excludedHandles.length, 0)
    : selectedHandles.length;

  const handleAdd = async (recordListId?: string) => {
    try {
      const result = await addContacts(
        isAllMatchingSelected
          ? { filter: contactFilter, excludedHandles }
          : { handles: selectedHandles },
        recordListId,
      );
      enqueueSuccessSnackBar({
        message: t`${result.createdPersonCount} contacts added to Twenty.`,
      });
      resetSelection();
    } catch {
      enqueueErrorSnackBar({ message: t`Contacts could not be added.` });
    }
  };

  return (
    <ModalStatefulWrapper
      modalInstanceId={UNIBOX_CONTACTS_MODAL_ID}
      size="large"
      padding="none"
      isClosable
      renderInDocumentBody
      onClose={resetSelection}
    >
      <ModalHeader autoHeight>
        <StyledHeader>
          <span>{t`Contacts found`}</span>
          <span>{totalCount.toLocaleString()}</span>
        </StyledHeader>
      </ModalHeader>
      <ModalContent noPadding>
        <StyledControls>
          <StyledSearch>
            <SearchInput
              value={search}
              onChange={(value) => {
                setSearch(value);
                resetSelection();
              }}
              placeholder={t`Search people`}
            />
          </StyledSearch>
          <StyledSelect
            aria-label={t`Contact period`}
            value={since}
            onChange={(event) => {
              setSince(event.target.value as UniboxContactSince);
              resetSelection();
            }}
          >
            <option value="LIFETIME">{t`Lifetime`}</option>
            <option value="LAST_YEAR">{t`Last year`}</option>
            <option value="LAST_90_DAYS">{t`Last 90 days`}</option>
            <option value="LAST_30_DAYS">{t`Last 30 days`}</option>
          </StyledSelect>
          <StyledFilterTabs>
            {(
              [
                ['NOT_IN_CRM', t`Not in Twenty`],
                ['IN_CRM', t`In Twenty`],
                ['ALL', t`All`],
              ] as const
            ).map(([value, label]) => (
              <StyledFilterTab
                key={value}
                type="button"
                isActive={inCrmFilter === value}
                onClick={() => {
                  setInCrmFilter(value);
                  resetSelection();
                }}
              >
                {label}
              </StyledFilterTab>
            ))}
          </StyledFilterTabs>
        </StyledControls>
        <StyledList>
          {contacts.length > 0 && (
            <StyledSelectAll
              type="button"
              onClick={() => {
                if (isAllMatchingSelected) {
                  resetSelection();
                } else {
                  setSelectedHandles([]);
                  setExcludedHandles([]);
                  setIsAllMatchingSelected(true);
                }
              }}
            >
              {isAllMatchingSelected
                ? t`Clear selection`
                : t`Select all ${totalCount} matching contacts`}
            </StyledSelectAll>
          )}
          {contacts.map((contact) => {
            const label = contact.displayName || contact.handle;
            return (
              <StyledRow key={contact.handle}>
                <Checkbox
                  checked={
                    isAllMatchingSelected
                      ? !excludedHandles.includes(contact.handle)
                      : selectedHandles.includes(contact.handle)
                  }
                  onCheckedChange={(checked) => {
                    if (isAllMatchingSelected) {
                      setExcludedHandles((currentHandles) =>
                        checked
                          ? currentHandles.filter(
                              (handle) => handle !== contact.handle,
                            )
                          : [...new Set([...currentHandles, contact.handle])],
                      );
                      return;
                    }

                    setSelectedHandles((currentHandles) =>
                      checked
                        ? [...new Set([...currentHandles, contact.handle])]
                        : currentHandles.filter(
                            (handle) => handle !== contact.handle,
                          ),
                    );
                  }}
                  aria-label={t`Select ${label}`}
                />
                <Avatar
                  placeholder={label}
                  placeholderColorSeed={contact.handle}
                  size="sm"
                  type="rounded"
                />
                <StyledContact>
                  <StyledName>{label}</StyledName>
                  <StyledHandle>{contact.handle}</StyledHandle>
                  <StyledSecondary>
                    {t`${contact.messageCount} emails`} ·{' '}
                    {t`last ${format(new Date(contact.lastContactedAt), 'd MMM yyyy')}`}
                  </StyledSecondary>
                </StyledContact>
                {contact.personId && (
                  <StyledPersonLink
                    to={generatePath(AppPath.RecordShowPage, {
                      objectNameSingular: 'person',
                      objectRecordId: contact.personId,
                    })}
                  >
                    {t`In Twenty →`}
                  </StyledPersonLink>
                )}
              </StyledRow>
            );
          })}
          {loading && contacts.length === 0 && (
            <StyledStatus>{t`Loading contacts…`}</StyledStatus>
          )}
          {!loading && !error && contacts.length === 0 && (
            <StyledStatus>{t`No contacts match these filters.`}</StyledStatus>
          )}
          {error && (
            <StyledStatus>{t`Contacts could not be loaded.`}</StyledStatus>
          )}
          <CustomResolverFetchMoreLoader
            loading={isFetchingMore}
            onLastRowVisible={fetchMoreContacts}
          />
        </StyledList>
      </ModalContent>
      {selectedCount > 0 && (
        <ModalFooter autoHeight>
          <StyledFooter>
            <Button
              title={t`${selectedCount} selected ×`}
              variant="tertiary"
              size="small"
              onClick={resetSelection}
            />
            <Button
              title={t`Add to Twenty`}
              size="small"
              isLoading={isAdding}
              onClick={() => void handleAdd()}
            />
            <UniboxAddToRecordListButton
              disabled={isAdding}
              onRecordListSelected={(recordListId) => handleAdd(recordListId)}
            />
          </StyledFooter>
        </ModalFooter>
      )}
    </ModalStatefulWrapper>
  );
};
