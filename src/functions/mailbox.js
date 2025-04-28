export function createMailboxModal() {
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

import { InteractionResponseType, InteractionResponseFlags } from 'discord-interactions';

// Export a function that builds the embed
export function createMailboxEmbed(user, mailbox) {
    const embed = {
      author: {
        name: `${user.username}'s Mailbox 📬`,
        icon_url: user.avatar 
          ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
          : undefined,
      },
      color: 0x3498db, // Pretty blue
      timestamp: new Date().toISOString(),
      fields: mailbox.length > 0
        ? mailbox.map((mail, i) => ({
            name: `**${i + 1}. From:** @${mail.sender}`,
            value: mail.message,
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