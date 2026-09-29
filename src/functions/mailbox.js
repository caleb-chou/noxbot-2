import { InteractionResponseType, InteractionResponseFlags } from 'discord-interactions';
import { avatarUrl } from '../util.js';

export function createMailboxModal(user) {
    return {
        type: 9, // InteractionResponseType.MODAL
        data: {
            custom_id: 'mailbox_modal',
            title: '📬 Mailbox',
            components: [
                {
                    type: 1, // Action Row
                    components: [
                        {
                            type: 4, // Text Input
                            custom_id: 'recipient_input',
                            style: 1, // Short input
                            label: 'Who is this addressed to?',
                            min_length: 1,
                            max_length: 100,
                            required: true,
                            placeholder: 'Enter a user\'s unique id',
                            value: user?.id || undefined
                        },
                    ],
                },
                {
                    type: 1, // Action Row
                    components: [
                        {
                            type: 4, // Text Input
                            custom_id: 'subject_input',
                            style: 1, // Short input
                            label: 'Subject',
                            min_length: 1,
                            max_length: 100,
                            required: true,
                            placeholder: 'Subject',
                        },
                    ],
                },
                {
                    type: 1, // Action Row
                    components: [
                        {
                            type: 4, // Text Input
                            custom_id: 'message_input',
                            style: 2, // Paragraph input
                            label: 'Your Message',
                            min_length: 1,
                            max_length: 2000,
                            required: true,
                            placeholder: 'Write your message here...',
                        },
                    ],
                },
            ],
        },
    };
}

// Discord caps a field value at 1024 and a whole embed at 6000. Ten mails of
// 400 leaves room for the names; /readmail shows the rest.
const PREVIEW_CHARS = 400;

const truncate = (text, max) =>
    text.length > max ? `${text.slice(0, max - 1)}…` : text;

export function createMailboxEmbed(user, mailbox) {
    const embed = {
      author: {
        name: `${user.username}'s Mailbox 📬`,
        icon_url: avatarUrl(user),
      },
      color: 0x3498db, // Pretty blue
      timestamp: new Date().toISOString(),
      fields: mailbox.length > 0
        ? mailbox.map((mail, i) => ({
            name: truncate(
                `${i + 1}. ${mail.subject ?? '(no subject)'} — from @${mail.sender}`,
                256,
            ),
            value:
                mail.message.length > PREVIEW_CHARS
                    ? `${truncate(mail.message, PREVIEW_CHARS)}\n_…\`/readmail ${i + 1}\`_`
                    : mail.message,
            inline: false, // Doesn't stack fields next to each other
        }))
        : [{ name: "No Mail", value: "_You have no mail._", inline: false }],
    };
  
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        embeds: [embed],
        flags: InteractionResponseFlags.EPHEMERAL,
      },
    };
  }

/** One mail in full: an embed description holds 4096, the modal caps input at 2000. */
export function createSingleMailEmbed(mail, index) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        embeds: [
          {
            title: truncate(mail.subject ?? '(no subject)', 256),
            description: mail.message,
            color: 0x3498db,
            footer: { text: `Mail ${index} · from @${mail.sender}` },
            timestamp: mail.timestamp,
          },
        ],
        // Mail sent before sender ids were stored can't be replied to.
        components: mail.senderId
          ? [
              {
                type: 1, // Action row
                components: [
                  {
                    type: 2, // Button
                    style: 1, // Primary
                    label: 'Reply',
                    custom_id: `mail_reply|${mail.senderId}`,
                  },
                ],
              },
            ]
          : undefined,
        flags: InteractionResponseFlags.EPHEMERAL,
      },
    };
  }