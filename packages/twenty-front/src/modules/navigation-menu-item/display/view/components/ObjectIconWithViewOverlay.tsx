import { styled } from '@linaria/react';
import { useContext } from 'react';
import { getIconTileColorShades } from 'twenty-ui/data-display';
import { type IconComponent } from 'twenty-ui/icon';
import { ThemeContext, themeCssVariables } from 'twenty-ui/theme-constants';

const StyledCompositeContainer = styled.div`
  align-items: center;
  border-radius: 4px;
  box-sizing: border-box;
  display: flex;
  flex-shrink: 0;
  height: 16px;
  justify-content: center;
  position: relative;
  width: 16px;
`;

const StyledObjectIconWrapper = styled.div`
  align-items: center;
  background-color: transparent;
  border: none;
  border-radius: 4px;
  box-sizing: border-box;
  display: flex;
  inset: 0;
  justify-content: center;
  position: absolute;
`;

const StyledViewOverlay = styled.div`
  align-items: center;
  background-color: transparent;
  border-radius: 4px;
  bottom: -5px;
  display: flex;
  height: 14px;
  justify-content: center;
  position: absolute;
  right: -6px;
  width: 12px;
`;

export type ObjectIconWithViewOverlayProps = {
  ObjectIcon: IconComponent;
  ViewIcon: IconComponent;
  objectColor?: string | null;
};

export const ObjectIconWithViewOverlay = ({
  ObjectIcon,
  ViewIcon,
  objectColor,
}: ObjectIconWithViewOverlayProps) => {
  const { theme } = useContext(ThemeContext);
  const objectStyle = getIconTileColorShades(objectColor);

  return (
    <StyledCompositeContainer>
      <StyledObjectIconWrapper>
        <ObjectIcon
          size="14px"
          stroke={theme.icon.stroke.md}
          color={objectStyle.iconColor}
        />
      </StyledObjectIconWrapper>
      <StyledViewOverlay>
        <ViewIcon
          size="12px"
          stroke={theme.icon.stroke.md}
          color={themeCssVariables.grayScale.gray10}
        />
      </StyledViewOverlay>
    </StyledCompositeContainer>
  );
};
