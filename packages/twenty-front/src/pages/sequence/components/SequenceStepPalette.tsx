import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { useState } from 'react';
import {
  SEQUENCE_CONDITION_TYPES,
  SEQUENCE_STEP_TYPES,
  SEQUENCE_TASK_TYPES,
  type SequenceConditionType,
  type SequenceStepType,
  type SequenceTaskType,
} from 'twenty-shared/types';
import {
  type IconComponent,
  IconBrandLinkedin,
  IconClock,
  IconFilter,
  IconListCheck,
  IconMail,
  IconMessage,
  IconPhone,
  IconSearch,
  IconSparkles,
  IconUserMinus,
  IconX,
} from 'twenty-ui/icon';
import { LightIconButton } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { getSequenceConditionLabel } from '../utils/get-sequence-step-presentation';

const StyledPalette = styled.div`
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  box-shadow: ${themeCssVariables.boxShadow.strong};
  display: flex;
  flex-direction: column;
  overflow: hidden;
  width: min(420px, calc(100vw - 80px));
`;

const StyledSearchRow = styled.div`
  align-items: center;
  border-bottom: 1px solid ${themeCssVariables.border.color.light};
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  padding: ${themeCssVariables.spacing[2]};
`;

const StyledSearchInput = styled.input`
  background: transparent;
  border: 0;
  color: ${themeCssVariables.font.color.primary};
  flex: 1;
  font-family: inherit;
  font-size: ${themeCssVariables.font.size.md};
  min-width: 0;
  outline: none;
`;

const StyledTabs = styled.div<{ hasConditions: boolean }>`
  display: grid;
  grid-template-columns: ${({ hasConditions }) =>
    hasConditions ? '1fr 1fr' : '1fr'};
  padding: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[2]} 0;
`;

const StyledTab = styled.button<{ isActive: boolean }>`
  background: transparent;
  border: 0;
  border-bottom: 2px solid
    ${({ isActive }) =>
      isActive ? themeCssVariables.color.blue : 'transparent'};
  color: ${({ isActive }) =>
    isActive
      ? themeCssVariables.font.color.primary
      : themeCssVariables.font.color.tertiary};
  cursor: pointer;
  font-family: inherit;
  padding: ${themeCssVariables.spacing[2]};
`;

const StyledOptions = styled.div`
  display: grid;
  gap: ${themeCssVariables.spacing[1]};
  grid-template-columns: 1fr 1fr;
  max-height: 280px;
  overflow: auto;
  padding: ${themeCssVariables.spacing[2]};
`;

const StyledOption = styled.button`
  align-items: center;
  background: ${themeCssVariables.background.transparent.lighter};
  border: 1px solid ${themeCssVariables.border.color.light};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.secondary};
  cursor: pointer;
  display: flex;
  font-family: inherit;
  gap: ${themeCssVariables.spacing[2]};
  min-height: 46px;
  padding: ${themeCssVariables.spacing[2]};
  text-align: left;

  &:hover {
    background: ${themeCssVariables.background.transparent.light};
    border-color: ${themeCssVariables.border.color.medium};
    color: ${themeCssVariables.font.color.primary};
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
`;

const StyledOptionIcon = styled.span`
  align-items: center;
  color: ${themeCssVariables.color.blue};
  display: flex;
`;

const StyledEmpty = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  grid-column: 1 / -1;
  padding: ${themeCssVariables.spacing[4]};
  text-align: center;
`;

export type SequenceStepPaletteOption = {
  label: string;
  Icon: IconComponent;
  type: SequenceStepType;
  condition?: SequenceConditionType;
  taskType?: SequenceTaskType;
};

const ACTION_OPTIONS: SequenceStepPaletteOption[] = [
  { label: t`Email`, Icon: IconMail, type: SEQUENCE_STEP_TYPES.SEND_EMAIL },
  {
    label: t`LinkedIn message`,
    Icon: IconMessage,
    type: SEQUENCE_STEP_TYPES.SEND_LINKEDIN_MESSAGE,
  },
  {
    label: t`Connection request`,
    Icon: IconBrandLinkedin,
    type: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
  },
  {
    label: t`Withdraw connection`,
    Icon: IconUserMinus,
    type: SEQUENCE_STEP_TYPES.WITHDRAW_CONNECTION_REQUEST,
  },
  {
    label: t`Call`,
    Icon: IconPhone,
    type: SEQUENCE_STEP_TYPES.CREATE_TASK,
    taskType: SEQUENCE_TASK_TYPES.CALL,
  },
  {
    label: t`Manual task`,
    Icon: IconListCheck,
    type: SEQUENCE_STEP_TYPES.CREATE_TASK,
    taskType: SEQUENCE_TASK_TYPES.CUSTOM,
  },
  {
    label: t`Enrich phone number`,
    Icon: IconSparkles,
    type: SEQUENCE_STEP_TYPES.ENRICH_PHONE_NUMBER,
  },
  {
    label: t`Wait / Delay`,
    Icon: IconClock,
    type: SEQUENCE_STEP_TYPES.DELAY,
  },
];

const CONDITION_OPTIONS: SequenceStepPaletteOption[] = Object.values(
  SEQUENCE_CONDITION_TYPES,
).map((condition) => ({
  label: getSequenceConditionLabel(condition),
  Icon: IconFilter,
  type: SEQUENCE_STEP_TYPES.CONDITION,
  condition,
}));

type SequenceStepPaletteProps = {
  allowConditions?: boolean;
  isCreating: boolean;
  onAdd: (option: SequenceStepPaletteOption) => Promise<void>;
  onClose: () => void;
};

export const SequenceStepPalette = ({
  allowConditions = true,
  isCreating,
  onAdd,
  onClose,
}: SequenceStepPaletteProps) => {
  const [activeTab, setActiveTab] = useState<'actions' | 'conditions'>(
    'actions',
  );
  const [search, setSearch] = useState('');
  const options = (
    activeTab === 'actions' ? ACTION_OPTIONS : CONDITION_OPTIONS
  ).filter(({ label }) => label.toLowerCase().includes(search.toLowerCase()));

  return (
    <StyledPalette>
      <StyledSearchRow>
        <IconSearch size={16} color={themeCssVariables.font.color.tertiary} />
        <StyledSearchInput
          autoFocus
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t`Search steps and conditions…`}
        />
        <LightIconButton
          Icon={IconX}
          title={t`Close step picker`}
          onClick={onClose}
          accent="tertiary"
        />
      </StyledSearchRow>
      <StyledTabs hasConditions={allowConditions}>
        <StyledTab
          type="button"
          isActive={activeTab === 'actions'}
          onClick={() => setActiveTab('actions')}
        >
          {t`Actions`}
        </StyledTab>
        {allowConditions && (
          <StyledTab
            type="button"
            isActive={activeTab === 'conditions'}
            onClick={() => setActiveTab('conditions')}
          >
            {t`Conditions`}
          </StyledTab>
        )}
      </StyledTabs>
      <StyledOptions>
        {options.length === 0 ? (
          <StyledEmpty>{t`No matching sequence items.`}</StyledEmpty>
        ) : (
          options.map((option) => {
            const OptionIcon = option.Icon;

            return (
              <StyledOption
                key={`${option.type}-${option.condition ?? option.taskType ?? ''}`}
                type="button"
                disabled={isCreating}
                onClick={() => void onAdd(option)}
              >
                <StyledOptionIcon>
                  <OptionIcon size={17} />
                </StyledOptionIcon>
                {option.label}
              </StyledOption>
            );
          })
        )}
      </StyledOptions>
    </StyledPalette>
  );
};
