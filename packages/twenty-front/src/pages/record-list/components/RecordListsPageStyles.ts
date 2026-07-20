import { styled } from '@linaria/react';
import { Link } from 'react-router-dom';
import { themeCssVariables } from 'twenty-ui/theme-constants';

export const StyledContent = styled.div`
  display: flex;
  flex: 1;
  justify-content: center;
  overflow: auto;
  padding: ${themeCssVariables.spacing[6]};
`;

export const StyledPanel = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[4]};
  max-width: 720px;
  width: 100%;
`;

export const StyledForm = styled.form`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
`;

export const StyledInput = styled.input`
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  box-sizing: border-box;
  color: ${themeCssVariables.font.color.primary};
  height: 32px;
  min-width: 0;
  padding: 0 ${themeCssVariables.spacing[2]};
  width: 100%;
`;

export const StyledSelect = styled.select`
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  color: ${themeCssVariables.font.color.primary};
  height: 32px;
  min-width: 120px;
  padding: 0 ${themeCssVariables.spacing[2]};
`;

export const StyledFolder = styled.section`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[1]};
`;

export const StyledFolderHeader = styled.div`
  align-items: center;
  display: flex;
  justify-content: space-between;
`;

export const StyledFolderTitle = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
  font-weight: ${themeCssVariables.font.weight.semiBold};
`;

export const StyledActions = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[1]};
`;

export const StyledListRow = styled.div`
  align-items: center;
  border-radius: ${themeCssVariables.border.radius.sm};
  display: flex;
  min-height: 36px;

  &:hover {
    background: ${themeCssVariables.background.transparent.light};
  }
`;

export const StyledListLink = styled(Link)`
  align-items: center;
  color: ${themeCssVariables.font.color.primary};
  display: flex;
  flex: 1;
  gap: ${themeCssVariables.spacing[2]};
  min-width: 0;
  padding: ${themeCssVariables.spacing[2]};
  text-decoration: none;
`;

export const StyledListType = styled.span`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
  margin-left: auto;
`;

export const StyledEmptyState = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  padding: ${themeCssVariables.spacing[4]};
  text-align: center;
`;
