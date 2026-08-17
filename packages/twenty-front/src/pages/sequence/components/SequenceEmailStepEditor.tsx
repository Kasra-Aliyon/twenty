import { FormAdvancedTextFieldInput } from '@/object-record/record-field/ui/form-types/components/FormAdvancedTextFieldInput';
import { useUpdateOneRecord } from '@/object-record/hooks/useUpdateOneRecord';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { useState } from 'react';
import {
  SEQUENCE_ACTION_EXECUTION_MODES,
  type SequenceActionExecutionMode,
  type SequenceEmailVariant,
  type SequenceEmailStepSettings,
} from 'twenty-shared/types';
import { validateSpintax } from 'twenty-shared/utils';
import { IconTrash } from 'twenty-ui/icon';
import { Button, LightIconButton, TabButton, Toggle } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { type SequenceStepRecord } from '../types/SequenceRecords';
import { StyledActions, StyledField, StyledInput } from './SequencePageStyles';
import { SequenceExecutionModeFields } from './SequenceExecutionModeFields';
import { SequenceVariablePicker } from './SequenceVariablePicker';

const StyledEditor = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
`;

const StyledFieldHeader = styled.div`
  align-items: center;
  display: flex;
  justify-content: space-between;
`;

const StyledFieldHeaderActions = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledVariantHeader = styled.div`
  align-items: center;
  border-bottom: 1px solid ${themeCssVariables.border.color.light};
  display: flex;
  justify-content: space-between;
`;

const StyledVariantTabs = styled.div`
  display: flex;
  min-width: 0;
`;

const StyledVariantActions = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledSplitField = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledPercentSuffix = styled.span`
  color: ${themeCssVariables.font.color.tertiary};
`;

const StyledVariantWarning = styled.div`
  color: ${themeCssVariables.color.orange};
  font-size: ${themeCssVariables.font.size.sm};
`;

const StyledVariantHelper = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
`;

const StyledSpintaxHelper = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};

  code {
    color: ${themeCssVariables.font.color.secondary};
  }
`;

const StyledSpintaxError = styled.div`
  color: ${themeCssVariables.font.color.danger};
  font-size: ${themeCssVariables.font.size.sm};
`;

const StyledToggleRow = styled.label`
  align-items: center;
  color: ${themeCssVariables.font.color.secondary};
  display: flex;
  font-size: ${themeCssVariables.font.size.sm};
  gap: ${themeCssVariables.spacing[2]};
  justify-content: space-between;
`;

const StyledSelect = styled.select`
  background: ${themeCssVariables.background.transparent.lighter};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.primary};
  height: 32px;
  padding: 0 ${themeCssVariables.spacing[2]};
`;

type SequenceEmailStepEditorProps = {
  step: SequenceStepRecord;
  settings: SequenceEmailStepSettings;
  disabled: boolean;
};

const SPINTAX_EXAMPLE = '{Hi|Hello}';

const buildInitialVariants = (
  settings: SequenceEmailStepSettings,
): SequenceEmailVariant[] =>
  settings.variants?.length
    ? settings.variants.map((variant) => ({ ...variant }))
    : [
        {
          id: 'control',
          name: 'A',
          subject: settings.subject,
          bodyHtml: settings.bodyHtml,
          weight: 100,
        },
      ];

const createVariantId = () =>
  globalThis.crypto?.randomUUID?.() ?? `variant-${Date.now()}`;

export const SequenceEmailStepEditor = ({
  step,
  settings,
  disabled,
}: SequenceEmailStepEditorProps) => {
  const [variants, setVariants] = useState<SequenceEmailVariant[]>(() =>
    buildInitialVariants(settings),
  );
  const [activeVariantId, setActiveVariantId] = useState(
    () => buildInitialVariants(settings)[0].id,
  );
  const [bodyEditorVersion, setBodyEditorVersion] = useState(0);
  const [threadAsReplyToPreviousEmail, setThreadAsReplyToPreviousEmail] =
    useState(settings.threadAsReplyToPreviousEmail);
  const [stopOnReply, setStopOnReply] = useState<boolean | null>(
    settings.stopOnReply,
  );
  const [executionMode, setExecutionMode] = useState(
    settings.executionMode ?? SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED,
  );
  const [manualTaskTitle, setManualTaskTitle] = useState(
    settings.manualTaskTitle ?? '',
  );
  const [manualTaskDescription, setManualTaskDescription] = useState(
    settings.manualTaskDescription ?? '',
  );
  const [isSaving, setIsSaving] = useState(false);
  const { updateOneRecord } = useUpdateOneRecord();
  const { enqueueSuccessSnackBar, enqueueErrorSnackBar } = useSnackBar();
  const activeVariant =
    variants.find((variant) => variant.id === activeVariantId) ?? variants[0];
  const variantsToValidate =
    executionMode === SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED
      ? variants
      : [variants[0]];
  const spintaxValidationError = variantsToValidate.reduce<string | null>(
    (currentError, variant) => {
      if (currentError !== null) {
        return currentError;
      }

      const subjectValidation = validateSpintax(variant.subject);

      if (!subjectValidation.isValid) {
        return t`Variant ${variant.name} subject: ${subjectValidation.error ?? 'Invalid spintax.'}`;
      }

      const bodyValidation = validateSpintax(variant.bodyHtml);

      return bodyValidation.isValid
        ? null
        : t`Variant ${variant.name} body: ${bodyValidation.error ?? 'Invalid spintax.'}`;
    },
    null,
  );
  const isEmailDraftEmpty = variantsToValidate.some(
    (variant) =>
      variant.subject.trim().length === 0 ||
      variant.bodyHtml.trim().length === 0,
  );
  const hasUnsupportedVariantCount =
    executionMode === SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED &&
    variants.length > 2;

  const updateVariant = (
    variantId: string,
    update: Partial<SequenceEmailVariant>,
  ) => {
    setVariants((currentVariants) =>
      currentVariants.map((variant) =>
        variant.id === variantId ? { ...variant, ...update } : variant,
      ),
    );
  };

  const addVariant = () => {
    if (variants.length >= 2) {
      return;
    }

    const controlVariant = variants[0];
    const newVariant: SequenceEmailVariant = {
      ...controlVariant,
      id: createVariantId(),
      name: 'B',
      weight: 50,
    };

    setVariants([{ ...controlVariant, weight: 50 }, newVariant]);
    setActiveVariantId(newVariant.id);
    setBodyEditorVersion((version) => version + 1);
  };

  const removeActiveVariant = () => {
    if (variants.length === 1 || activeVariant.id === variants[0].id) {
      return;
    }

    const remainingVariants = variants.filter(
      (variant) => variant.id !== activeVariant.id,
    );
    const normalizedRemainingVariants =
      remainingVariants.length === 1
        ? [{ ...remainingVariants[0], weight: 100 }]
        : remainingVariants.length === 2
          ? remainingVariants.map((variant) => ({ ...variant, weight: 50 }))
          : remainingVariants;

    setVariants(normalizedRemainingVariants);
    setActiveVariantId(normalizedRemainingVariants[0].id);
    setBodyEditorVersion((version) => version + 1);
  };

  const updateActiveVariantWeight = (weight: number) => {
    if (variants.length !== 2) {
      return;
    }

    const normalizedWeight = Math.max(1, Math.min(99, weight || 1));

    setVariants((currentVariants) =>
      currentVariants.map((variant) =>
        variant.id === activeVariant.id
          ? { ...variant, weight: normalizedWeight }
          : { ...variant, weight: 100 - normalizedWeight },
      ),
    );
  };

  const updateExecutionMode = (mode: SequenceActionExecutionMode) => {
    setExecutionMode(mode);

    if (mode === SEQUENCE_ACTION_EXECUTION_MODES.MANUAL) {
      setActiveVariantId(variants[0].id);
      setBodyEditorVersion((version) => version + 1);
    }
  };

  const save = async () => {
    if (isEmailDraftEmpty) {
      enqueueErrorSnackBar({
        message: t`Add both an email subject and body before saving.`,
      });

      return;
    }

    if (spintaxValidationError !== null) {
      enqueueErrorSnackBar({ message: spintaxValidationError });

      return;
    }

    setIsSaving(true);

    const controlVariant = variants[0];

    try {
      await updateOneRecord<SequenceStepRecord>({
        objectNameSingular: 'sequenceStep',
        idToUpdate: step.id,
        updateOneRecordInput: {
          settings: {
            type: 'SEND_EMAIL',
            branch: settings.branch,
            subject: controlVariant.subject,
            bodyHtml: controlVariant.bodyHtml,
            variants:
              executionMode === SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED &&
              variants.length > 1
                ? variants
                : undefined,
            threadAsReplyToPreviousEmail,
            stopOnReply,
            executionMode,
            manualTaskTitle,
            manualTaskDescription,
          },
        },
      });
      enqueueSuccessSnackBar({ message: t`Email step saved.` });
    } catch {
      enqueueErrorSnackBar({ message: t`The email step could not be saved.` });
    } finally {
      setIsSaving(false);
    }
  };

  const appendVariableToBody = (variableName: string) => {
    updateVariant(activeVariant.id, {
      bodyHtml: `${activeVariant.bodyHtml}{{ ${variableName} }}`,
    });
    setBodyEditorVersion((version) => version + 1);
  };

  return (
    <StyledEditor>
      <SequenceExecutionModeFields
        executionMode={executionMode}
        manualTaskTitle={manualTaskTitle}
        manualTaskDescription={manualTaskDescription}
        onExecutionModeChange={updateExecutionMode}
        onManualTaskTitleChange={setManualTaskTitle}
        onManualTaskDescriptionChange={setManualTaskDescription}
      />

      {executionMode === SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED && (
        <>
          <StyledVariantHeader>
            <StyledVariantTabs>
              {variants.map((variant) => (
                <TabButton
                  key={variant.id}
                  id={`sequence-email-variant-${step.id}-${variant.id}`}
                  title={t`Variant ${variant.name}`}
                  active={variant.id === activeVariant.id}
                  onClick={() => {
                    setActiveVariantId(variant.id);
                    setBodyEditorVersion((version) => version + 1);
                  }}
                />
              ))}
            </StyledVariantTabs>
            <StyledVariantActions>
              {variants.length < 2 && (
                <Button
                  title={t`Add B variant`}
                  size="small"
                  variant="secondary"
                  onClick={addVariant}
                  disabled={disabled}
                />
              )}
              {variants.length > 1 && activeVariant.id !== variants[0].id && (
                <LightIconButton
                  Icon={IconTrash}
                  title={t`Remove variant ${activeVariant.name}`}
                  accent="tertiary"
                  onClick={removeActiveVariant}
                  disabled={disabled}
                />
              )}
            </StyledVariantActions>
          </StyledVariantHeader>

          {variants.length === 2 && (
            <StyledField>
              <span>{t`Traffic share for variant ${activeVariant.name}`}</span>
              <StyledSplitField>
                <StyledInput
                  type="number"
                  min={1}
                  max={99}
                  value={activeVariant.weight}
                  onChange={(event) =>
                    updateActiveVariantWeight(Number(event.target.value))
                  }
                />
                <StyledPercentSuffix>%</StyledPercentSuffix>
              </StyledSplitField>
            </StyledField>
          )}
          {hasUnsupportedVariantCount && (
            <StyledVariantWarning>
              {t`A/B email steps support two variants. Remove extra variants before saving.`}
            </StyledVariantWarning>
          )}
          <StyledVariantHelper>
            {t`Each contact keeps the same variant for this step. Compare results in the Analytics tab.`}
          </StyledVariantHelper>
        </>
      )}

      <StyledField as="div">
        <StyledFieldHeader>
          <span>{t`Subject`}</span>
          <StyledFieldHeaderActions>
            <Button
              title={t`Insert subject spintax`}
              size="small"
              variant="secondary"
              disabled={disabled}
              onClick={() =>
                updateVariant(activeVariant.id, {
                  subject: `${activeVariant.subject}${SPINTAX_EXAMPLE}`,
                })
              }
            />
            <SequenceVariablePicker
              dropdownId={`sequence-subject-variable-${step.id}`}
              onVariableSelect={(variableName) =>
                updateVariant(activeVariant.id, {
                  subject: `${activeVariant.subject}{{ ${variableName} }}`,
                })
              }
            />
          </StyledFieldHeaderActions>
        </StyledFieldHeader>
        <StyledInput
          aria-label={t`Subject`}
          value={activeVariant.subject}
          disabled={disabled}
          onChange={(event) =>
            updateVariant(activeVariant.id, { subject: event.target.value })
          }
          placeholder={t`A quick question for {{ firstName }}`}
        />
      </StyledField>

      <div>
        <StyledFieldHeader>
          <span>{t`Email body`}</span>
          <StyledFieldHeaderActions>
            <Button
              title={t`Insert body spintax`}
              size="small"
              variant="secondary"
              disabled={disabled}
              onClick={() => {
                updateVariant(activeVariant.id, {
                  bodyHtml: `${activeVariant.bodyHtml}<p>${SPINTAX_EXAMPLE}</p>`,
                });
                setBodyEditorVersion((version) => version + 1);
              }}
            />
            <SequenceVariablePicker
              dropdownId={`sequence-body-variable-${step.id}-${activeVariant.id}`}
              onVariableSelect={appendVariableToBody}
            />
          </StyledFieldHeaderActions>
        </StyledFieldHeader>
        <FormAdvancedTextFieldInput
          key={`${activeVariant.id}-${bodyEditorVersion}`}
          defaultValue={activeVariant.bodyHtml}
          onChange={(bodyHtml) => updateVariant(activeVariant.id, { bodyHtml })}
          placeholder={t`Write the email sent at this step`}
          minHeight={180}
          maxWidth={800}
          contentType="html"
          readonly={disabled}
        />
      </div>

      <StyledSpintaxHelper>
        {t`Use spintax in the subject or body to vary a phrase, for example`}{' '}
        <code>{SPINTAX_EXAMPLE}</code>.{' '}
        {t`One option is chosen when the email is sent.`}
      </StyledSpintaxHelper>
      {spintaxValidationError !== null && (
        <StyledSpintaxError role="alert">
          {spintaxValidationError}
        </StyledSpintaxError>
      )}

      <StyledToggleRow>
        <span>{t`Thread as a reply to the previous sequence email`}</span>
        <Toggle
          value={threadAsReplyToPreviousEmail}
          onChange={setThreadAsReplyToPreviousEmail}
          toggleSize="small"
        />
      </StyledToggleRow>

      <StyledField>
        <span>{t`Stop on reply`}</span>
        <StyledSelect
          value={stopOnReply === null ? 'INHERIT' : String(stopOnReply)}
          onChange={(event) =>
            setStopOnReply(
              event.target.value === 'INHERIT'
                ? null
                : event.target.value === 'true',
            )
          }
        >
          <option value="INHERIT">{t`Use sequence setting`}</option>
          <option value="true">{t`Always stop`}</option>
          <option value="false">{t`Do not stop`}</option>
        </StyledSelect>
      </StyledField>

      <StyledActions>
        <Button
          title={t`Save email step`}
          size="small"
          onClick={() => void save()}
          isLoading={isSaving}
          disabled={
            disabled ||
            isEmailDraftEmpty ||
            spintaxValidationError !== null ||
            hasUnsupportedVariantCount ||
            (executionMode === SEQUENCE_ACTION_EXECUTION_MODES.MANUAL &&
              manualTaskTitle.trim().length === 0)
          }
        />
      </StyledActions>
    </StyledEditor>
  );
};
