// ==========================
// IMPORTS
// ==========================
import {
  Client,
  GatewayIntentBits,
  AttachmentBuilder,
  EmbedBuilder,
  PermissionsBitField,
} from "discord.js";

import dotenv from "dotenv";
import SFTPClient from "ssh2-sftp-client";
import fs from "fs";
import AdmZip from "adm-zip";
import fetch from "node-fetch";
import { Octokit } from "@octokit/rest";

dotenv.config();

// ==========================
// CHECK ENV
// ==========================
if (!process.env.DISCORD_TOKEN) {
  console.error("❌ DISCORD_TOKEN faltando no .env");
  process.exit(1);
}
if (!process.env.GITHUB_TOKEN) {
  console.error("❌ GITHUB_TOKEN faltando no .env");
  process.exit(1);
}

// ==========================
// CLIENT DISCORD
// ==========================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

// ==========================
// HISTÓRICOS
// ==========================
let uploadHistory = [];
let removeHistory = [];
let githubHistory = [];

// ==========================
// SFTP CONFIG
// ==========================
const sftp = new SFTPClient();

async function connectSFTP() {
  await sftp.connect({
    host: process.env.SFTP_HOST,
    username: process.env.SFTP_USER,
    password: process.env.SFTP_PASS,
    port: 22,
  });
}

// ==========================
// GITHUB CONFIG
// ==========================
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

const repoOwner = "Baryczka25";
const repoName = "MGT-Server";
const modsFolder = "mods";

// ==========================
// BOT ON
// ==========================
client.once("ready", () => {
  console.log(`✅ Bot online como ${client.user.tag}`);
});

// ==========================
// FUNÇÃO — LISTAR MODS GITHUB
// ==========================
async function listModsFromGitHub() {
  const response = await octokit.repos.getContent({
    owner: repoOwner,
    repo: repoName,
    path: modsFolder,
  });

  if (!Array.isArray(response.data)) {
    return [];
  }

  return response.data.map((file) => file.name);
}

// ==========================
// FUNÇÃO — UPLOAD GITHUB
// ==========================
async function uploadFileToGitHub(fileName, buffer) {
  await octokit.repos.createOrUpdateFileContents({
    owner: repoOwner,
    repo: repoName,
    path: `${modsFolder}/${fileName}`,
    message: `Add mod ${fileName}`,
    content: buffer.toString("base64"),
  });

  githubHistory.push({
    action: "UPLOAD",
    file: fileName,
    date: new Date().toISOString(),
  });
}

// ==========================
// FUNÇÃO — REMOVER GITHUB
// ==========================
async function removeFileFromGitHub(fileName) {
  try {
    const file = await octokit.repos.getContent({
      owner: repoOwner,
      repo: repoName,
      path: `${modsFolder}/${fileName}`,
    });

    await octokit.repos.deleteFile({
      owner: repoOwner,
      repo: repoName,
      path: `${modsFolder}/${fileName}`,
      sha: file.data.sha,
      message: `Remove mod ${fileName}`,
    });

    githubHistory.push({
      action: "REMOVE",
      file: fileName,
      date: new Date().toISOString(),
    });

    return true;
  } catch (e) {
    return false;
  }
}

// ==========================
// INTERAÇÕES
// ==========================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // ==========================
  // /PING
  // ==========================
  if (commandName === "ping") {
    return interaction.reply({ content: "🏓 Pong!", flags: 64 });
  }

  // ==========================
  // /LISTMODS
  // ==========================
  if (commandName === "listmods") {
    await interaction.reply({ content: "🔍 Buscando mods...", flags: 64 });

    const mods = await listModsFromGitHub();

    const list = mods.length
      ? mods.map((m) => `📦 ${m}`).join("\n")
      : "Nenhum mod encontrado";

    return interaction.editReply({
      content: `**📂 Mods instalados:**\n${list}`,
    });
  }

  // ==========================
  // /ADICIONARMOD
  // ==========================
  if (commandName === "adicionarmod") {
    const file = interaction.options.getAttachment("arquivo");

    if (!file.name.endsWith(".jar")) {
      return interaction.reply({
        content: "❌ Envie apenas arquivos .jar",
        flags: 64,
      });
    }

    await interaction.reply({
      content: `⚠️ Você confirma adicionar o mod **${file.name}** ao servidor?  
Clique em **Sim** abaixo.`,
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              label: "SIM — APROVAR",
              style: 3,
              custom_id: "approve_mod",
            },
          ],
        },
      ],
      flags: 64,
    });

    // Guardar arquivo na memória desta interação
    interaction.client.pendingMod = file;
  }

  // ==========================
  // CALLBACK — APROVAR MOD
  // ==========================
  if (interaction.isButton()) {
    if (interaction.customId === "approve_mod") {
      const file = interaction.client.pendingMod;

      if (!file) {
        return interaction.reply({
          content: "❌ Nenhum mod está esperando aprovação.",
          flags: 64,
        });
      }

      await interaction.reply({
        content: "⏳ Baixando o mod...",
        flags: 64,
      });

      // BAIXAR
      const res = await fetch(file.url);
      const buffer = Buffer.from(await res.arrayBuffer());

      await uploadFileToGitHub(file.name, buffer);

      uploadHistory.push({
        file: file.name,
        date: new Date().toISOString(),
      });

      return interaction.editReply({
        content: `✅ Mod **${file.name}** foi aprovado e enviado com sucesso!`,
      });
    }
  }

  // ==========================
  // /REMOVERMOD
  // ==========================
  if (commandName === "removermod") {
    const name = interaction.options.getString("nome");

    await interaction.reply({
      content: "🗑️ Removendo mod...",
      flags: 64,
    });

    const success = await removeFileFromGitHub(name);

    if (!success) {
      return interaction.editReply({
        content: "❌ Não encontrei esse mod no GitHub.",
      });
    }

    removeHistory.push({
      file: name,
      date: new Date().toISOString(),
    });

    return interaction.editReply({
      content: `🗑️ Mod **${name}** removido com sucesso!`,
    });
  }

  // ==========================
  // /HISTORICO
  // ==========================
  if (commandName === "historico") {
    const embed = new EmbedBuilder()
      .setTitle("📜 Histórico de modificações")
      .setColor("Blue")
      .addFields(
        {
          name: "📥 Uploads",
          value:
            uploadHistory.length > 0
              ? uploadHistory
                  .map((h) => `➕ ${h.file} — *${h.date}*`)
                  .join("\n")
              : "Nenhum upload ainda.",
        },
        {
          name: "📤 Remoções",
          value:
            removeHistory.length > 0
              ? removeHistory
                  .map((h) => `🗑️ ${h.file} — *${h.date}*`)
                  .join("\n")
              : "Nenhuma remoção ainda.",
        }
      );

    return interaction.reply({ embeds: [embed], flags: 64 });
  }

  // ==========================
  // /PAINEL
  // ==========================
  if (commandName === "painel") {
    return interaction.reply({
      content: "🖥️ **Painel do Servidor**\n\n" +
        "➡ `/listmods`\n" +
        "➡ `/adicionarmod`\n" +
        "➡ `/removermod`\n" +
        "➡ `/historico`\n" +
        "➡ `/modpack`\n",
      flags: 64,
    });
  }
});

// ==========================
// LOGIN
// ==========================
client.login(process.env.DISCORD_TOKEN);
