// ======================= NOVO INDEX.JS COMPLETO =======================
// Arquivo substituído conforme solicitado

import pkg from "discord.js";
const { Client, GatewayIntentBits, AttachmentBuilder } = pkg;

import SFTPClient from "ssh2-sftp-client";
import fs from "fs";
import os from "os";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { Octokit } from "@octokit/rest";
dotenv.config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ======================= CONFIGURAÇÕES =======================
const COOLDOWN_TIME = 1000 * 60 * 5; // 5 minutos
const allowedMods = ["examplemod", "forge", "fabric"];
const uploadCooldowns = new Map();
const uploadHistory = [];

// ======================= GITHUB =======================
const octokit = new Octokit({ auth: process.env.MGT_ID });
const GITHUB_OWNER = process.env.MGT_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_PATH = process.env.GITHUB_PATH || "mods";

async function uploadToGitHub(file) {
  const fullPath = `${GITHUB_PATH}/${file.name}`;
  const response = await fetch(file.url);
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentBase64 = buffer.toString("base64");
  let sha = null;

  try {
    const existing = await octokit.repos.getContent({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: fullPath,
    });
    if (existing?.data?.sha) sha = existing.data.sha;
  } catch {}

  await octokit.repos.createOrUpdateFileContents({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    path: fullPath,
    message: `Adicionado/Atualizado mod ${file.name} via bot`,
    content: contentBase64,
    sha: sha ?? undefined,
  });
}

async function removeFromGitHub(filename) {
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "");
  const { data } = await octokit.repos.getContent({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    path: `${GITHUB_PATH}/${sanitized}`,
  });
  await octokit.repos.deleteFile({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    path: `${GITHUB_PATH}/${sanitized}`,
    message: `Removido mod ${sanitized} via bot`,
    sha: data.sha,
  });
}

// ======================= SFTP =======================
const sftp = new SFTPClient();

async function ensureSFTP() {
  try {
    await sftp.list("/");
  } catch {
    await sftp.connect({
      host: process.env.SFTP_HOST,
      port: Number(process.env.SFTP_PORT) || 22,
      username: process.env.SFTP_USER,
      password: process.env.SFTP_PASS,
      hostVerifier: () => true,
    });
  }
}

async function listMods() {
  await ensureSFTP();
  const path = process.env.SFTP_MODS_PATH || "mods";
  const files = await sftp.list(path);
  return files.map(f => f.name).join("");
}

async function uploadMod(file) {
  const path = process.env.SFTP_MODS_PATH || "mods";
  const temp = `${os.tmpdir()}/${file.name}`;
  const response = await fetch(file.url);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.promises.writeFile(temp, buffer);
  await ensureSFTP();
  await sftp.put(temp, `${path}/${file.name}`);
}

async function removeModSFTP(filename) {
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "");
  const path = process.env.SFTP_MODS_PATH || "mods";
  await ensureSFTP();
  await sftp.delete(`${path}/${sanitized}`);
  return sanitized;
}

// ======================= PTERO =======================
async function getServerStatusPtero() {
  try {
    const res = await fetch(
      `${process.env.PTERO_PANEL_URL}/servers/${process.env.PTERO_SERVER_ID}/resources`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.PTERO_API_KEY}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );

    const data = await res.json();
    return {
      online: data.attributes.current_state === "running",
      cpu: data.attributes.resources.cpu_absolute,
      memory: data.attributes.resources.memory_bytes,
      disk: data.attributes.resources.disk_bytes,
      status: data.attributes.current_state,
    };
  } catch (e) {
    return { online: false, error: e.message };
  }
}

async function restartServerPtero() {
  try {
    await fetch(
      `${process.env.PTERO_PANEL_URL}/servers/${process.env.PTERO_SERVER_ID}/power`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.PTERO_API_KEY}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ signal: "restart" }),
      }
    );
    return "✅ Servidor reiniciado!";
  } catch (e) {
    return `❌ Falha ao reiniciar: ${e.message}`;
  }
}

async function sendCommandPtero(cmd) {
  try {
    await fetch(
      `${process.env.PTERO_PANEL_URL}/servers/${process.env.PTERO_SERVER_ID}/command`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.PTERO_API_KEY}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ command: cmd }),
      }
    );
    return true;
  } catch {
    return false;
  }
}

// ======================= CURADORIA =======================
function registerUpload(userId, username, fileName) {
  uploadHistory.push({ userId, username, fileName, timestamp: Date.now() });
}

async function uploadModCurated(interaction, file) {
  await uploadMod(file);
  await uploadToGitHub(file);
  registerUpload(interaction.user.id, interaction.user.username, file.name);
  await sendCommandPtero(`say Novo mod carregado: ${file.name}`);
  const restartMsg = await restartServerPtero();
  return interaction.editReply(`✅ Mod **${file.name}** enviado!
${restartMsg}`);
}

// ======================= REMOVER MOD =======================
async function removeModFull(interaction, filename) {
  await interaction.editReply("🗑 Removendo mod...");

  try {
    await removeFromGitHub(filename);
    const removed = await removeModSFTP(filename);

    await sendCommandPtero(`say Mod removido: ${removed}`);
    const restartMsg = await restartServerPtero();

    return interaction.editReply(`✅ Mod **${removed}** removido!
${restartMsg}`);
  } catch (e) {
    return interaction.editReply(`❌ Erro ao remover mod:

${e.message}`);
  }
}

// ======================= HANDLER =======================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    switch (interaction.commandName) {
      case "ping":
        return interaction.reply("🏓 Pong!");

      case "listmods":
        await interaction.reply("🔍 Listando mods...");
        const modsList = await listMods();
        const filePath = `${os.tmpdir()}/mods-list.txt`;
        await fs.promises.writeFile(filePath, modsList);
        return interaction.editReply({
          content: `📦 Mods instalados:`,
          files: [new AttachmentBuilder(filePath, { name: "mods-list.txt" })],
        });

      case "adicionarmod":
        const file = interaction.options.getAttachment("arquivo");
        if (!file.name.endsWith(".jar"))
          return interaction.reply("❌ Só aceito arquivos .jar");
        await interaction.reply("📤 Enviando mod...");
        return uploadModCurated(interaction, file);

      case "removermod":
        const name = interaction.options.getString("nome");
        await interaction.reply("Processando...");
        return removeModFull(interaction, name);

      default:
        return interaction.reply("❌ Comando desconhecido.");
    }
  } catch (e) {
    return interaction.editReply(`❌ Erro:
${e.message}`);
  }
});

// ======================= LOGIN =======================
client.once("ready", () => console.log("🤖 Bot online!"));
client.login(process.env.DISCORD_TOKEN);
