export const PROMPTS = {
    base: [
        ["normal", "weird"],
        ["funny", "sad"],
        ["hot", "cold"],
        ["light", "dark"],
        ["hard", "soft"],
        ["big", "small"],
        ["easy", "difficult"],
        ["cheap", "expensive"],
    ],
    advanced: [
        ["red flag", "green flag"],
        ["smash", "pass"],
        ["rewatcahble", "unwatchable"],
        ["main character", "bit character"],
        ["worthless", "worthwhile"],
        ["nightmare", "daydream"],
        ["person you could beat up", "person who could beat you up"],
        ["fight", "flight"],
        ["better together", "better alone"],
     ],
}

export const ALL_PROMPTS = Object.values(PROMPTS).map((prompt) => prompt.map((p) => p))

function generate_gamut_string(position) {
    let gamut_string = '';
    for (let i = 0; i < 19; i++) {
        if (Math.abs(0.05 * (i + 1) - position) < 0.025) {
            gamut_string += `🟦 < ${Math.trunc(position * 1000) / 1000}\n`;
            continue;
        }
        else if (Math.abs(0.05 * (i + 1) - position) < 0.075)
            gamut_string += `🟧`
        else if (Math.abs(0.05 * (i + 1) - position) < 0.125)
            gamut_string += `🟨`
        else
            gamut_string += `⬛`
        if (i % 5 === 4)
            gamut_string += ` < ${(i + 1) * 0.05}`
        gamut_string += "\n";
    }
    return gamut_string;
}

function generate_gamut_result_string(position, guess) {
    let gamut_string = '';
    for (let i = 0; i < 20; i++) {
        if (Math.abs(0.05 * (i + 1) - position) < 0.025) {
            gamut_string += `🟦 < Actual ${Math.trunc(position * 1000) / 1000}`;
        }
        else if (Math.abs(0.05 * (i + 1) - position) < 0.075)
            gamut_string += `🟧`
        else if (Math.abs(0.05 * (i + 1) - position) < 0.125)
            gamut_string += `🟨`
        else
            gamut_string += `⬛`
        if (0.05 * (i + 1) >= guess && 0.05 * (i + 1) < guess + 0.05) {
            gamut_string += ` < Your guess ${guess}`;
        }
        if (i % 5 === 4)
            gamut_string += ` < ${(i + 1) * 0.05}`
        gamut_string += "\n";
    }
    return gamut_string;
}

function generate_guess_gamut_string() {
    let gamut_string = '';
    for (let i = 0; i < 20; i++) {
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

export function generate_guess_response_message_embed(game_id, game_data, guess_value) {
    const { prompt } = game_data;
    const { left, right } = prompt;
    const guess = parseFloat(guess_value);
    const distance = Math.abs(game_data.position - (Number.isNaN(guess) ? 0 : guess));

    const message = {
        type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
        data: {
            embeds: [
                {
                    description: `||${left}\n${generate_gamut_result_string(game_data.position, guess)}${right}\n\n**Your guess was ${guess}**\n**Distance: ${distance}**\n**Score: ${calculate_score(distance)}**||`,
                    color: 0x5865F2,
                    footer: {
                        text: `${game_id}`
                    }
                }
            ], 
            // flags: 64,
        },

    }
    return message;
}

export function calculate_score(distance) {
    if (distance < 0.025) {
        return 4;
    } else if (distance < 0.075) {
        return 3;
    } else if (distance < 0.125) {
        return 2;
    } else {
        return 0;
    }
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