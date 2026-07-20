import { styled } from '@linaria/react';
import { Link } from 'react-router-dom';
import { themeCssVariables } from 'twenty-ui/theme-constants';

export const StyledContent = styled.div`
  display: flex;
  flex: 1;
  overflow: auto;
  padding: ${themeCssVariables.spacing[4]};
`;

export const StyledPanel = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
  max-width: 560px;
  width: 100%;
`;

export const StyledExplorerHeader = styled.div`
  align-items: center;
  display: flex;
  justify-content: space-between;
  min-height: 24px;
  padding: 0 ${themeCssVariables.spacing[1]};
`;

export const StyledExplorerTitle = styled.span`
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.sm};
  font-weight: ${themeCssVariables.font.weight.medium};
`;

export const StyledManagementPanel = styled.div`
  background: ${themeCssVariables.background.transparent.lighter};
  border: 1px solid ${themeCssVariables.border.color.light};
  border-radius: ${themeCssVariables.border.radius.md};
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
  padding: ${themeCssVariables.spacing[3]};
`;

export const StyledForm = styled.form`
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: ${themeCssVariables.spacing[2]};
`;

export const StyledInput = styled.input`
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  box-sizing: border-box;
  color: ${themeCssVariables.font.color.primary};
  flex: 1 1 180px;
  height: 32px;
  min-width: 0;
  padding: 0 ${themeCssVariables.spacing[2]};
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
  gap: 2px;
`;

export const StyledFolderHeader = styled.div`
  align-items: center;
  border-radius: ${themeCssVariables.border.radius.sm};
  display: flex;
  justify-content: space-between;
  min-height: 32px;
  padding: 0 ${themeCssVariables.spacing[2]};
  position: relative;

  &:hover {
    background: ${themeCssVariables.background.transparent.light};
  }

  &:hover > [data-record-list-actions],
  &:focus-within > [data-record-list-actions] {
    opacity: 1;
  }
`;

export const StyledFolderTitle = styled.div`
  align-items: center;
  color: ${themeCssVariables.font.color.primary};
  display: flex;
  flex: 1;
  font-size: ${themeCssVariables.font.size.md};
  font-weight: ${themeCssVariables.font.weight.semiBold};
  gap: ${themeCssVariables.spacing[2]};
  min-width: 0;
`;

export const StyledFolderIcon = styled.span`
  align-items: center;
  color: ${themeCssVariables.color.blue};
  display: flex;
`;

export const StyledFolderCount = styled.span`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
  font-weight: ${themeCssVariables.font.weight.regular};
  margin-left: auto;
`;

export const StyledActions = styled.div`
  align-items: center;
  background: ${themeCssVariables.background.primary};
  display: flex;
  gap: ${themeCssVariables.spacing[1]};
  opacity: 0;
  padding-left: ${themeCssVariables.spacing[2]};
  position: absolute;
  right: ${themeCssVariables.spacing[1]};
  transition: opacity 100ms ease;
  z-index: 1;
`;

export const StyledListRow = styled.div`
  align-items: center;
  border-radius: ${themeCssVariables.border.radius.sm};
  display: flex;
  min-height: 36px;
  padding-left: ${themeCssVariables.spacing[3]};
  position: relative;

  &:hover {
    background: ${themeCssVariables.background.transparent.light};
  }

  &:hover > [data-record-list-actions],
  &:focus-within > [data-record-list-actions] {
    opacity: 1;
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

export const StyledListIcon = styled.span`
  align-items: center;
  color: ${themeCssVariables.font.color.secondary};
  display: flex;
`;

export const StyledEmptyState = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  padding: ${themeCssVariables.spacing[4]};
  text-align: center;
`;
