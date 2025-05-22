import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

if (!DISCORD_TOKEN || !GUILD_ID) {
  console.error('Missing DISCORD_TOKEN or GUILD_ID in .env file. Please set them.');
  process.exit(1);
}

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildIntegrations // Necessary for slash commands
  ],
});

const commands = [
  new SlashCommandBuilder()
    .setName('hello')
    .setDescription('Replies with Hello there!'),
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

client.once('ready', async () => {
  console.log(`Minimal bot logged in as ${client.user.tag}!`);
  console.log(`Application ID: ${client.user.id}`);
  console.log(`Target Guild ID: ${GUILD_ID}`);

  try {
    console.log('Started refreshing application (/) commands for the guild.');

    // The put method is used to fully refresh all commands in the guild with the current set
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, GUILD_ID),
      { body: commands },
    );

    console.log('Successfully reloaded application (/) commands for the guild.');
  } catch (error) {
    console.error('Error reloading application (/) commands:', error);
  }
});

client.on('interactionCreate', async (interaction) => {
  console.log(`[INTERACTION RECEIVED] Type: ${interaction.type}, ID: ${interaction.id}`);

  if (!interaction.isChatInputCommand()) {
    console.log('[INTERACTION IGNORED] Not a chat input command.');
    return;
  }

  console.log(`[CHAT INPUT COMMAND] Name: ${interaction.commandName}, User: ${interaction.user.tag} (${interaction.user.id})`);

  const { commandName } = interaction;

  if (commandName === 'hello') {
    console.log('[COMMAND MATCH] Matched /hello command. Attempting to reply...');
    try {
      await interaction.reply('Hello there! I received your command.');
      console.log('[REPLY SUCCESS] Replied to /hello command.');
    } catch (error) {
      console.error('[REPLY FAIL] Error replying to /hello command:', error);
    }
  } else {
    console.log(`[COMMAND NO MATCH] Received command "${commandName}" but expected "hello".`);
  }
});

client.login(DISCORD_TOKEN); 