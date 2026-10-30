import { type Meta, type StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { IconBell } from '@ui/icon';
import {
  A11Y_DEFER_COLOR_CONTRAST,
  CatalogDecorator,
  type CatalogDimension,
  type CatalogOptions,
  type CatalogStory,
  ComponentDecorator,
} from '@ui/testing';
import { MenuItemMultiSelect } from '@ui/navigation/MenuItemMultiSelect/MenuItemMultiSelect';

const meta: Meta<typeof MenuItemMultiSelect> = {
  title: 'UI/Navigation/Menu/MenuItem/MenuItemMultiSelect',
  component: MenuItemMultiSelect,
  decorators: [
    (Story) => (
      <div role="listbox" aria-label="Options" aria-multiselectable>
        <Story />
      </div>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof MenuItemMultiSelect>;

export const Default: Story = {
  parameters: { a11y: A11Y_DEFER_COLOR_CONTRAST },
  args: {
    text: 'First option',
    selected: false,
    onSelectChange: fn(),
  },
  decorators: [ComponentDecorator],
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByRole('checkbox')).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole('option', { name: args.text }));
    await expect(args.onSelectChange).toHaveBeenCalledTimes(1);
    await expect(args.onSelectChange).toHaveBeenCalledWith(true);
  },
};

export const Disabled: Story = {
  ...Default,
  args: {
    ...Default.args,
    disabled: true,
    onSelectChange: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const option = canvas.getByRole('option', { name: args.text });

    await expect(option).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(option);
    await expect(args.onSelectChange).not.toHaveBeenCalled();
  },
};

export const Catalog: CatalogStory<Story, typeof MenuItemMultiSelect> = {
  args: { LeftIcon: IconBell, text: 'Menu item' },
  argTypes: {
    className: { control: false },
  },
  parameters: {
    a11y: A11Y_DEFER_COLOR_CONTRAST,
    pseudo: { hover: ['.hover'], active: ['.pressed'], focus: ['.focus'] },
    catalog: {
      dimensions: [
        {
          name: 'withIcon',
          values: [true, false],
          props: (withIcon: boolean) => ({
            LeftIcon: withIcon ? IconBell : undefined,
          }),
          labels: (withIcon: boolean) =>
            withIcon ? 'With left icon' : 'Without left icon',
        },
        {
          name: 'withIconContainer',
          values: [true, false],
          props: (withIconContainer: boolean) => ({ withIconContainer }),
          labels: (withIconContainer: boolean) =>
            withIconContainer
              ? 'With icon container'
              : 'Without icon container',
        },
        {
          name: 'selected',
          values: [true, false],
          props: (selected: boolean) => ({ selected }),
          labels: (selected: boolean) =>
            selected ? 'Selected' : 'Not selected',
        },
        {
          name: 'states',
          values: ['default', 'hover'],
          props: (state: string) => {
            switch (state) {
              case 'default':
                return {};
              case 'hover':
                return { className: state };
              default:
                return {};
            }
          },
        },
      ] as CatalogDimension[],
      options: {
        elementContainer: {
          width: 200,
        },
      } as CatalogOptions,
    },
  },
  decorators: [CatalogDecorator],
};
