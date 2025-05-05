import { text } from "itty-router";

const PROMPTS = {
    base: [
        ["normal", "weird"],
        ["funny", "sad"]
    ]
}

function generate_gamut_string(position) {
    let gamut_string = '';
    for (let i = 0; i < 19; i++) {
        if (0.05 * (i + 1) > position && 0.05 * (i + 1) < position + 0.05) {
            gamut_string += `🟦 < ${position}`;
        }
        else if ((0.05 * (i + 1) > position + 0.05 && 0.05 * (i + 1) < position + 0.1) || (0.05 * (i + 1) < position && 0.05 * (i + 1) > position - 0.05))
            gamut_string += `🟧`
        else if ((0.05 * (i + 1) > position + 0.1 && 0.05 * (i + 1) < position + 0.15) || (0.05 * (i + 1) < position - 0.05 && 0.05 * (i + 1) > position - 0.1))
            gamut_string += `🟨`
        else
            gamut_string += `⬛`
        if (i % 5 === 4)
            gamut_string += ` < ${(i + 1) * 0.05}`
        gamut_string += "\n";
    }
    return gamut_string;
}

function generate_guess_gamut_string() {
    let gamut_string = '';
    for (let i = 0; i < 19; i++) {
        gamut_string += `⬛`
        if (i % 5 === 4)
            gamut_string += ` < ${(i + 1) * 0.05}`
        gamut_string += "\n";
    }
    return gamut_string;
}

export function generate_gamut(prompts) {
    const position = Math.random();
    const prompt = prompts[Math.floor(Math.random() * prompts.length)];
    return {
        prompt: prompt,
        position: position
    }
}

export function generate_message_embed(prompts) {
    const { prompt, position } = generate_gamut(prompts)
    const gamut_string = generate_gamut_string(position);
    const game_id = crypto.randomUUID();
    const message = {
        type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
        data: {
            embeds: [
                {
                    title: "Your Gamut!",
                    description: `${prompt[0]}\n${gamut_string}${prompt[1]}`,
                    color: 0x5865F2,
                    footer: {
                        text: `${game_id}`
                    }
                }
            ],
            components: [
                {
                    type: 1, // Action row
                    components: [
                        {
                            type: 2, // Button
                            style: 3, // Primary button
                            label: "Type Clue",
                            custom_id: "gamut_clue_button"
                        },
                        {
                            type: 2, // Button
                            style: 4, // Primary button
                            label: "New Gamut",
                            custom_id: "new_gamut_button"
                        }
                    ]
                },
            ],
            flags: 64,
            game_data: {
                clue: "",
                prompt: {
                    left: prompt[0],
                    right: prompt[1]
                },
                position: position,
            }
        }
    }
    return message;
}

export function generate_guesser_message_embed(game_id, game_data, user) {
    const { clue, prompt } = game_data;
    const { left, right } = prompt;

    const message = {
        type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
        data: {
            embeds: [
                {
                    author: {
                        name: `${user.username}'s clue: "${clue}"`,
                        icon_url: user.avatar
                            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
                            : undefined,
                    },
                    description: `${left}\n${generate_guess_gamut_string()}${right}`,
                    color: 0x5865F2,
                    footer: {
                        text: `${game_id}`
                    }
                }
            ],
            components: [
                {
                    type: 1, // Action row
                    components: [
                        {
                            type: 2, // Button
                            style: 3, // Primary button
                            label: "Guess",
                            custom_id: `gamut_guess_button|${game_id}`
                        }
                    ]
                },
            ],
            game_data: game_data
        }
    }
    return message;
}

export function createLengthWaveClueModal(game_id) {
    return {
        type: 9, // InteractionResponseType.MODAL
        data: {
            custom_id: `lengthwave_clue_modal|${game_id}`,
            title: 'Type a Clue!',
            components: [
                {
                    type: 1, // Action Row
                    components: [
                        {
                            type: 4, // Text Input
                            custom_id: 'clue_input',
                            style: 1, // Short input
                            label: 'Clue',
                            min_length: 1,
                            max_length: 100,
                            required: true,
                            placeholder: 'Enter a clue',
                        },
                    ],
                },
            ],
        },
    };
}

export function createLengthWaveGuessModal(game_id) {
    return {
        type: 9, // InteractionResponseType.MODAL
        data: {
            custom_id: `lengthwave_guess_modal|${game_id}`,
            title: 'Make a Guess!',
            components: [
                {
                    type: 1, // Action Row
                    components: [
                        {
                            type: 4, // Text Input
                            custom_id: 'guess_input',
                            style: 1, // Short input
                            label: 'Guess',
                            min_length: 1,
                            max_length: 100,
                            required: true,
                            placeholder: 'Guess the value (0.0-1.0)',
                        },
                    ],
                },
            ],
        },
    };
}