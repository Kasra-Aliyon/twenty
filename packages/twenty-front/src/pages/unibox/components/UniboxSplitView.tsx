import { styled } from '@linaria/react';
import { type ReactNode, useEffect, useState } from 'react';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const StyledSplit = styled.div`
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
`;

const StyledLeftPane = styled.div<{ width: number }>`
  display: flex;
  flex: 0 0 ${({ width }) => width}px;
  flex-direction: column;
  min-height: 0;
  min-width: 300px;
  overflow: hidden;
`;

const StyledDivider = styled.div`
  background: ${themeCssVariables.border.color.medium};
  cursor: ew-resize;
  flex: 0 0 1px;
  position: relative;

  &::after {
    content: '';
    inset: 0 -4px;
    position: absolute;
  }
`;

const StyledRightPane = styled.div`
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 320px;
  overflow: hidden;
`;

export const UniboxSplitView = ({
  list,
  detail,
}: {
  list: ReactNode;
  detail: ReactNode;
}) => {
  const [leftPaneWidth, setLeftPaneWidth] = useState(410);
  const [resizeStart, setResizeStart] = useState<{
    pointerX: number;
    width: number;
  } | null>(null);

  useEffect(() => {
    if (!resizeStart) return;

    const handleMouseMove = (event: MouseEvent) => {
      const nextWidth =
        resizeStart.width + event.clientX - resizeStart.pointerX;

      setLeftPaneWidth(Math.min(620, Math.max(300, nextWidth)));
    };
    const handleMouseUp = () => setResizeStart(null);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizeStart]);

  return (
    <StyledSplit>
      <StyledLeftPane width={leftPaneWidth}>{list}</StyledLeftPane>
      <StyledDivider
        onMouseDown={(event) => {
          setResizeStart({
            pointerX: event.clientX,
            width: leftPaneWidth,
          });
        }}
      />
      <StyledRightPane>{detail}</StyledRightPane>
    </StyledSplit>
  );
};
