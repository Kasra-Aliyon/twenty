import { useNavigationDrawerExpanded } from '@/navigation/hooks/useNavigationDrawerExpanded';
import { isRecordListsPanelOpenState } from '@/record-list/states/isRecordListsPanelOpenState';
import { NAVIGATION_DRAWER_COLLAPSED_WIDTH } from '@/ui/layout/resizable-panel/constants/NavigationDrawerCollapsedWidth';
import { NAVIGATION_DRAWER_WIDTH_VAR } from '@/ui/navigation/states/navigationDrawerWidthState';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { useSetAtomState } from '@/ui/utilities/state/jotai/hooks/useSetAtomState';
import { styled } from '@linaria/react';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { RecordListsPanel } from '~/pages/record-list/RecordListsPage';

const RECORD_LISTS_PANEL_WIDTH = `clamp(260px, calc(var(${NAVIGATION_DRAWER_WIDTH_VAR}) * 1.25), 320px)`;

const StyledPanelWrapper = styled.div<{
  isNavigationDrawerExpanded: boolean;
  isOpen: boolean;
}>`
  bottom: 0;
  left: ${({ isNavigationDrawerExpanded }) =>
    isNavigationDrawerExpanded
      ? `var(${NAVIGATION_DRAWER_WIDTH_VAR})`
      : `${NAVIGATION_DRAWER_COLLAPSED_WIDTH}px`};
  min-width: 0;
  overflow: hidden;
  pointer-events: ${({ isOpen }) => (isOpen ? 'auto' : 'none')};
  position: absolute;
  top: 0;
  transition: width calc(${themeCssVariables.animation.duration.normal} * 1s);
  width: ${({ isOpen }) => (isOpen ? RECORD_LISTS_PANEL_WIDTH : '0px')};
  z-index: ${themeCssVariables.lastLayerZIndex};
`;

const StyledPanel = styled.aside`
  background: ${themeCssVariables.background.primary};
  border-left: 1px solid ${themeCssVariables.border.color.medium};
  border-right: 1px solid ${themeCssVariables.border.color.medium};
  box-sizing: border-box;
  display: flex;
  height: 100%;
  overflow: hidden;
  width: ${RECORD_LISTS_PANEL_WIDTH};
`;

export const RecordListsPanelForDesktop = () => {
  const isRecordListsPanelOpen = useAtomStateValue(isRecordListsPanelOpenState);
  const isNavigationDrawerExpanded = useNavigationDrawerExpanded();
  const setIsRecordListsPanelOpen = useSetAtomState(
    isRecordListsPanelOpenState,
  );

  return (
    <StyledPanelWrapper
      isNavigationDrawerExpanded={isNavigationDrawerExpanded}
      isOpen={isRecordListsPanelOpen}
    >
      <StyledPanel>
        {isRecordListsPanelOpen && (
          <RecordListsPanel onClose={() => setIsRecordListsPanelOpen(false)} />
        )}
      </StyledPanel>
    </StyledPanelWrapper>
  );
};
