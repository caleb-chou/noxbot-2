export async function getUserData(env, userId) {
    try {
        const userData = await env.noxbotdata.get(userId);
        if (userData === null) {
            return new Response(`No data found for user ${userId}`, {status: 404})
        }
        return new Response(userData, {status:200});
    } catch (error) {
        console.error('Error fetching user data:', error);
        return new Response('Internal Server Error', {status: 500});
    }
}

export async function setUserData(env, userId, data) {
    try {
        const insertedData = await env.noxbotdata.put(userId, data);
        return new Response(insertedData, {status:200});
    } catch (error) {
        console.error('Error fetching user data:', error);
        return new Response('Internal Server Error', {status: 500});
    }
}