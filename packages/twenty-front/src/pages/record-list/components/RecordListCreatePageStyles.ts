import { styled } from '@linaria/react';
import { themeCssVariables } from 'twenty-ui/theme-constants';

export const StyledCreateListContent = styled.form`
  box-sizing: border-box;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[5]};
  max-width: 960px;
  overflow: auto;
  padding: ${themeCssVariables.spacing[6]};
  width: 100%;
`;

export const StyledCreateListNameRow = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[3]};
`;

export const StyledCreateListNameIcon = styled.span`
  align-items: center;
  color: ${themeCssVariables.color.green};
  display: flex;
  flex-shrink: 0;
`;

export const StyledCreateListNameInput = styled.input`
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  box-sizing: border-box;
  color: ${themeCssVariables.font.color.primary};
  flex: 1;
  font-size: ${themeCssVariables.font.size.lg};
  height: 40px;
  min-width: 0;
  padding: 0 ${themeCssVariables.spacing[3]};

  &::placeholder {
    color: ${themeCssVariables.font.color.light};
  }
`;

export const StyledCreateListSection = styled.section`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
`;

export const StyledCreateListSectionTitle = styled.h2`
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.md};
  font-weight: ${themeCssVariables.font.weight.semiBold};
  margin: 0;
`;

export const StyledObjectTypePicker = styled.div`
  background: ${themeCssVariables.background.transparent.light};
  border-radius: ${themeCssVariables.border.radius.md};
  display: flex;
  padding: ${themeCssVariables.spacing[1]};
`;

export const StyledObjectTypeButton = styled.button<{ isSelected: boolean }>`
  align-items: center;
  background: ${({ isSelected }) =>
    isSelected ? themeCssVariables.background.primary : 'transparent'};
  border: 0;
  border-radius: ${themeCssVariables.border.radius.md};
  box-shadow: ${({ isSelected }) =>
    isSelected ? `0 1px 3px ${themeCssVariables.border.color.medium}` : 'none'};
  color: ${({ isSelected }) =>
    isSelected
      ? themeCssVariables.font.color.primary
      : themeCssVariables.font.color.tertiary};
  cursor: pointer;
  display: flex;
  flex: 1;
  font-family: inherit;
  font-size: ${themeCssVariables.font.size.md};
  font-weight: ${themeCssVariables.font.weight.medium};
  gap: ${themeCssVariables.spacing[2]};
  height: 40px;
  justify-content: center;
`;

export const StyledCreateListActions = styled.div`
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  justify-content: flex-end;
`;
