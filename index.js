
const { Client, GatewayIntentBits } = require('discord.js');
const ClientSFTP = require('ssh2-sftp-client');

const TOKEN = "1442010203921973340";
const SFTP_HOST = "enx-cirion-95.enx.host";
const SFTP_PORT = 2022;
const SFTP_USER = "dwho4u2a.f75839cd";
const SFTP_PASS = "enx-cirion-95.enx.host:10130";

const MC_MODS_PATH = "/mods";

const bot = new Client({ intents: [GatewayIntentBits.Guilds] });

bot.once('ready', () => {
    console.log('Bot online!');
});

bot.login(TOKEN);
