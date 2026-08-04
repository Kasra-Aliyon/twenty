import { type SendMessageInput } from 'src/modules/messaging/message-outbound-manager/types/send-message-input.type';
import { toMailComposerOptions } from 'src/modules/messaging/message-outbound-manager/utils/to-mail-composer-options.util';

const sendMessageInput: SendMessageInput = {
  to: 'recipient@example.com',
  subject: 'Hello',
  body: 'Plain text body',
  html: '<p>HTML body</p>',
};

describe('toMailComposerOptions', () => {
  it('should omit the HTML MIME part for plain-text-only email', () => {
    const options = toMailComposerOptions('sender@example.com', {
      ...sendMessageInput,
      isPlainTextOnly: true,
    });

    expect(options).not.toHaveProperty('html');
    expect(options.text).toBe('Plain text body');
  });

  it('should include both body formats by default', () => {
    const options = toMailComposerOptions(
      'sender@example.com',
      sendMessageInput,
    );

    expect(options.text).toBe('Plain text body');
    expect(options.html).toBe('<p>HTML body</p>');
  });
});
