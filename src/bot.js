import { Client, GatewayIntentBits } from 'discord.js';
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});
import dotenv from 'dotenv';

dotenv.config({ path: '.dev.vars' });

client.login(process.env.DISCORD_TOKEN);

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});
