import { styled } from '@linaria/react';
import { themeCssVariables } from 'twenty-ui/theme-constants';

export const StyledPageContent = styled.div`
  box-sizing: border-box;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[4]};
  min-height: 0;
  overflow: auto;
  padding: ${themeCssVariables.spacing[4]};
`;

export const StyledSection = styled.section`
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
  padding: ${themeCssVariables.spacing[4]};
`;

export const StyledSectionHeader = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  justify-content: space-between;
`;

export const StyledSectionTitle = styled.h2`
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.lg};
  font-weight: ${themeCssVariables.font.weight.semiBold};
  margin: 0;
`;

export const StyledFieldsGrid = styled.div`
  display: grid;
  gap: ${themeCssVariables.spacing[3]};
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
`;

export const StyledField = styled.label`
  color: ${themeCssVariables.font.color.secondary};
  display: flex;
  flex-direction: column;
  font-size: ${themeCssVariables.font.size.sm};
  gap: ${themeCssVariables.spacing[1]};
`;

export const StyledInput = styled.input`
  background: ${themeCssVariables.background.transparent.lighter};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  box-sizing: border-box;
  color: ${themeCssVariables.font.color.primary};
  font-family: inherit;
  font-size: ${themeCssVariables.font.size.md};
  height: 32px;
  padding: 0 ${themeCssVariables.spacing[2]};
  width: 100%;

  &:focus {
    border-color: ${themeCssVariables.border.color.strong};
    outline: none;
  }
`;

export const StyledTextarea = styled.textarea`
  background: ${themeCssVariables.background.transparent.lighter};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  box-sizing: border-box;
  color: ${themeCssVariables.font.color.primary};
  font-family: inherit;
  font-size: ${themeCssVariables.font.size.md};
  min-height: 88px;
  padding: ${themeCssVariables.spacing[2]};
  resize: vertical;
  width: 100%;

  &:focus {
    border-color: ${themeCssVariables.border.color.strong};
    outline: none;
  }
`;

export const StyledActions = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  justify-content: flex-end;
`;

export const StyledEmptyState = styled.div`
  align-items: center;
  color: ${themeCssVariables.font.color.tertiary};
  display: flex;
  flex: 1;
  justify-content: center;
  min-height: 160px;
  padding: ${themeCssVariables.spacing[6]};
  text-align: center;
`;

export const StyledPill = styled.span`
  background: ${themeCssVariables.background.transparent.light};
  border-radius: ${themeCssVariables.border.radius.pill};
  color: ${themeCssVariables.font.color.secondary};
  display: inline-flex;
  font-size: ${themeCssVariables.font.size.xs};
  padding: ${themeCssVariables.spacing['0.5']} ${themeCssVariables.spacing[1]};
  white-space: nowrap;
`;
