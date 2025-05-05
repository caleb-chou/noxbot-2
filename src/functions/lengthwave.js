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
        else if ((0.05 * (i + 1) > position + 0.1 && 0.05 * (i + 1) < position + 0.15) || (0.05 * (i + 1) < position - 0.05 && 0.05 * (i + 1) > position - 0.1  ))
            gamut_string += `🟨`
        else
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
    const message = {
        type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
        data: {
            embeds: [
                {
                    title: "Your Gamut!",
                    description: `${prompt[0]}\n${gamut_string}${prompt[1]}`,
                    color: 0x5865F2 // Discord blurple
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
            flags: 64
        }
    }
    return message;
}