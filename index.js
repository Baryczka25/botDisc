import {
  Client,
  GatewayIntentBits,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from "discord.js";

import dotenv from "dotenv";
import fs from "fs";
import SFTPClient from "ssh2-sftp-client";
dotenv.config();

// ===============================
// BOT
// ===============================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

// ===============================
// SFTP CONFIG
// ===============================
const sftp = new SFTPClient();

// ===============================
// UTILIDADE: evitar mensagens >2000 chars
// ===============================
async function sendLongMessage(interaction, text) {
  if (text.length <= 1900) {
    return interaction.reply({ content: text, flags: 0 });
  }

  const buffer = Buffer.from(text, "utf-8");

  return interaction.reply({
    content: "📄 Texto muito grande — enviado como arquivo:",
    files: [{ attachment: buffer, name: "resposta.txt" }],
    flags: 0
  });
}

// ===============================
// PAINEL DE CONTROLE
// ===============================
function getPainel() {
  return {
    content: "🛠 **Painel de Gerenciamento do Servidor Minecraft**",
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("painel_listar")
          .setLabel("📦 Listar Mods")
          .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
          .setCustomId("painel_historico")
          .setLabel("📜 Histórico")
          .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
          .setCustomId("painel_restart")
          .setLabel("🔄 Reiniciar Servidor")
          .setStyle(ButtonStyle.Danger)
      )
    ]
  };
}

// ===============================
// BOT ONLINE
// ===============================
client.once("ready", () => {
  console.log(`✅ Bot online como ${client.user.tag}`);
});

// ===============================
// HANDLER PRINCIPAL
// ===============================
client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand()) {
    // ================
    // /ping
    // ================
    if (interaction.commandName === "ping") {
      return interaction.reply("🏓 Pong!");
    }

    // ================
    // /help
    // ================
    if (interaction.commandName === "help") {
      return interaction.reply({
        content:
          "📌 **Comandos Disponíveis:**\n\n" +
          "• `/ping` — Testa o bot\n" +
          "• `/listmods` — Lista todos os mods\n" +
          "• `/adicionarmod` — Envia um mod .jar\n" +
          "• `/removermod nome:` — Remove um mod\n" +
          "• `/historico` — Histórico de alterações\n" +
          "• `/info` — Informações do servidor\n" +
          "• `/restart` — Reinicia o servidor\n" +
          "• `/modpack` — Baixa o modpack do GitHub\n",
        flags: 0
      });
    }

    // ================
    // /listmods
    // ================
    if (interaction.commandName === "listmods") {
      const mods = fs.readdirSync("./mods").join("\n");
      return sendLongMessage(
        interaction,
        `📦 **Mods Instalados:**\n\n${mods}`
      );
    }

    // ================
    // /historico
    // ================
    if (interaction.commandName === "historico") {
      const histFile = "./historico.txt";

      if (!fs.existsSync(histFile)) {
        return interaction.reply("📜 Nenhum histórico encontrado.");
      }

      const content = fs.readFileSync(histFile, "utf-8");

      return sendLongMessage(interaction, `📜 **Histórico:**\n\n${content}`);
    }

    // ================
    // /info
    // ================
    if (interaction.commandName === "info") {
      const mods = fs.readdirSync("./mods").length;

      return interaction.reply({
        content:
          `📊 **Informações do Servidor**\n\n` +
          `• Mods instalados: **${mods}**\n` +
          `• Status: Online\n` +
          `• Última atualização: Automática`,
        flags: 0
      });
    }

    // ================
    // /adicionarmod
    // ================
    if (interaction.commandName === "adicionarmod") {
      const file = interaction.options.getAttachment("arquivo");

      if (!file.name.endsWith(".jar")) {
        return interaction.reply("❌ Envie apenas arquivos .jar");
      }

      const response = await fetch(file.url);
      const buffer = Buffer.from(await response.arrayBuffer());

      fs.writeFileSync(`./mods/${file.name}`, buffer);

      fs.appendFileSync(
        "./historico.txt",
        `[+${new Date().toLocaleString()}] ${file.name}\n`
      );

      return interaction.reply(`✅ Mod **${file.name}** adicionado!`);
    }

    // ================
    // /removermod
    // ================
    if (interaction.commandName === "removermod") {
      const nome = interaction.options.getString("nome");

      if (!fs.existsSync(`./mods/${nome}`)) {
        return interaction.reply("❌ Mod não encontrado.");
      }

      fs.unlinkSync(`./mods/${nome}`);

      fs.appendFileSync(
        "./historico.txt",
        `[-${new Date().toLocaleString()}] ${nome}\n`
      );

      return interaction.reply(`🗑 Mod **${nome}** removido!`);
    }

    // ================
    // /restart
    // ================
    if (interaction.commandName === "restart") {
      return interaction.reply("🔄 Reiniciando servidor...");
    }

    // ================
    // /modpack
    // ================
    if (interaction.commandName === "modpack") {
      return interaction.reply({
        content: "📦 Baixe o modpack:\nhttps://github.com/seurepo/modpack.zip",
        flags: 0
      });
    }
  }

  // ===============================
  // BOTÕES DO PAINEL
  // ===============================
  if (interaction.isButton()) {
    // LISTAR
    if (interaction.customId === "painel_listar") {
      const mods = fs.readdirSync("./mods").join("\n");
      return sendLongMessage(
        interaction,
        `📦 **Mods Instalados:**\n\n${mods}`
      );
    }

    // HISTÓRICO
    if (interaction.customId === "painel_historico") {
      const hist = fs.readFileSync("./historico.txt", "utf-8");
      return sendLongMessage(
        interaction,
        `📜 **Histórico de alterações:**\n\n${hist}`
      );
    }

    // RESTART
    if (interaction.customId === "painel_restart") {
      return interaction.reply("🔄 Servidor reiniciando...");
    }
  }
});

// ===============================
// LOGIN
// ===============================
client.login(process.env.DISCORD_TOKEN);
// ===============================