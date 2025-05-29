export async function image_to_buffer(source, url) {
    console.log(`Converting image to buffer from ${url}`);
    const { pathname } = new URL(url);
    if(source == '7tv'){
        const realpath = pathname.substring(pathname.lastIndexOf('/') + 1);
        console.log(`Fetching image from ${realpath}`);
        const get_the_url = `https://cdn.7tv.app/emote/${realpath}/4x.avif`;
        const response = await fetch(get_the_url);
    }
    else if(source == 'other'){
        const response = await fetch(url);
    }
    console.log(`Response status: ${response.status}`);
    const buffer = await response.arrayBuffer();
    console.log(`Buffer length: ${buffer.byteLength}`);
    const b64 = arrayBufferToBase64(buffer);
    const mimeType = response.headers.get('Content-Type');
    console.log(`MIME type: ${mimeType}`);
    return `data:${mimeType};base64,${b64}`;
}

export async function add_emoji(token, guildId, name, image_data) {
    const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/emojis`, {
        method: "POST",
        headers: {
            Authorization: `Bot ${token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            name: name,
            image: image_data
        })
    });
    return res;
}

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}