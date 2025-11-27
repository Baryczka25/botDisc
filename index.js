import pkg from "discord.js";
const {
  Client,
  GatewayIntentBits,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = pkg;

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
const pendingApprovals = new Map(); // <= AQUI
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
    sha = existing.data.sha;
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

  try {
    const { data: fileData } = await octokit.repos.getContent({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: `${GITHUB_PATH}/${sanitized}`,
    });

    await octokit.repos.deleteFile({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: `${GITHUB_PATH}/${sanitized}`,
      message: `Removido mod ${sanitized} via bot`,
      sha: fileData.sha,
    });

    console.log(`✅ Removido do GitHub: ${sanitized}`);
  } catch (err) {
    console.log("Erro ao remover GitHub:", err.message);
  }
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

async function listModsRaw() {
  await ensureSFTP();
  const modsPath = process.env.SFTP_MODS_PATH || "mods";
  return await sftp.list(modsPath);
}

async function listMods() {
  const raw = await listModsRaw();
  return raw.map((m) => m.name);
}

async function uploadMod(file) {
  const modsPath = process.env.SFTP_MODS_PATH || "mods";
  const tempPath = `${os.tmpdir()}/${file.name}`;

  const response = await fetch(file.url);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.promises.writeFile(tempPath, buffer);

  await ensureSFTP();
  await sftp.put(tempPath, `${modsPath}/${file.name}`);
}

async function removeModSFTP(filename) {
  const modsPath = process.env.SFTP_MODS_PATH || "mods";
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "");

  await ensureSFTP();
  await sftp.delete(`${modsPath}/${sanitized}`);

  return sanitized;
}

// ======================= PTERODACTYL =======================
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
  } catch (err) {
    return { online: false, error: err.message };
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
    return "🔄 Servidor reiniciado!";
  } catch (err) {
    return `Erro: ${err.message}`;
  }
}

async function sendCommandPtero(command) {
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
        body: JSON.stringify({ command }),
      }
    );
    return true;
  } catch {
    return false;
  }
}

// ======================= PEDIR APROVAÇÃO =======================
async function pedirAprovacao(interaction, file) {
  const embed = new EmbedBuilder()
    .setTitle("⚠️ Aprovar mod?")
    .setDescription(`O mod **${file.name}** não está na lista de mods permitidos.\nDeseja aprovar o envio?`)
    .setColor("Yellow");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`aprovar_${interaction.id}`)
      .setLabel("✔️ Aprovar")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId(`rejeitar_${interaction.id}`)
      .setLabel("❌ Rejeitar")
      .setStyle(ButtonStyle.Danger)
  );

  pendingApprovals.set(interaction.id, { interaction, file });

  return interaction.editReply({ embeds: [embed], components: [row] });
}

// ======================= UPLOAD CURADO =======================
async function uploadModCurated(interaction, file) {
  const userId = interaction.user.id;

  const now = Date.now();
  if (uploadCooldowns.has(userId)) {
    const diff = now - uploadCooldowns.get(userId);
    if (diff < COOLDOWN_TIME) {
      return interaction.editReply("⏱ Aguarde para enviar outro mod.");
    }
  }

  const ok = allowedMods.some((k) => file.name.toLowerCase().includes(k));
  if (!ok) return pedirAprovacao(interaction, file);

  return realizarUpload(interaction, file);
}

async function realizarUpload(interaction, file) {
  const userId = interaction.user.id;
  const now = Date.now();

  await uploadMod(file);
  await uploadToGitHub(file);

  uploadCooldowns.set(userId, now);

  await sendCommandPtero(`say Novo mod adicionado: ${file.name}`);
  const restartMsg = await restartServerPtero();

  return interaction.editReply(`✅ Mod enviado!\n${restartMsg}`);
}

// ======================= BOTÕES DE APROVAÇÃO =======================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  // ====== APROVAR ======
  if (interaction.customId.startsWith("aprovar_")) {
    const id = interaction.customId.replace("aprovar_", "");
    const data = pendingApprovals.get(id);
    if (!data) return interaction.reply({ content: "❌ Solicitação expirada.", ephemeral: true });

    pendingApprovals.delete(id);

    interaction.reply({ content: "✔️ Mod aprovado!", ephemeral: true });
    return realizarUpload(data.interaction, data.file);
  }

  // ====== REJEITAR ======
  if (interaction.customId.startsWith("rejeitar_")) {
    const id = interaction.customId.replace("rejeitar_", "");
    pendingApprovals.delete(id);

    return interaction.reply({ content: "❌ Mod rejeitado.", ephemeral: true });
  }
});

// ======================= AUTOCOMPLETE removermod =======================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isAutocomplete()) return;

  if (interaction.commandName === "removermod") {
    const mods = await listMods();
    const focused = interaction.options.getFocused();

    const filtered = mods
      .filter((m) => m.toLowerCase().includes(focused.toLowerCase()))
      .slice(0, 25)
      .map((m) => ({ name: m, value: m }));

    await interaction.respond(filtered);
  }
});

// ======================= PAINEL =======================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId === "painel_listar") {
    const mods = await listMods();
    return interaction.reply({
      content: mods.length ? mods.join("\n") : "Nenhum mod.",
      ephemeral: true,
    });
  }

  if (interaction.customId === "painel_restart") {
    const msg = await restartServerPtero();
    return interaction.reply({ content: msg, ephemeral: true });
  }

  if (interaction.customId === "painel_info") {
    const status = await getServerStatusPtero();
    return interaction.reply({
      content: JSON.stringify(status, null, 2),
      ephemeral: true,
    });
  }
});

// ======================= HANDLER COMANDOS =======================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    switch (interaction.commandName) {
      case "ping":
        return interaction.reply("Pong!");

      case "listmods":
        const mods = await listMods();
        return interaction.reply(mods.join("\n"));

      case "adicionarmod":
        const file = interaction.options.getAttachment("arquivo");
        if (!file.name.endsWith(".jar"))
          return interaction.reply("❌ Envie .jar");
        await interaction.reply("📤 Enviando...");
        return uploadModCurated(interaction, file);

      case "removermod":
        const name = interaction.options.getString("nome");
        await interaction.deferReply();
        await removeFromGitHub(name);
        const removed = await removeModSFTP(name);
        return interaction.editReply(`🗑 Removido: ${removed}`);

      case "painel": {
        const embed = new EmbedBuilder()
          .setTitle("⚙️ Painel de Gerenciamento")
          .setDescription("Gerencie o servidor usando os botões abaixo")
          .setColor("#5865F2");

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("painel_listar")
            .setLabel("📦 Listar Mods")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId("painel_restart")
            .setLabel("🔄 Reiniciar")
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId("painel_info")
            .setLabel("ℹ️ Info")
            .setStyle(ButtonStyle.Secondary)
        );

        return interaction.reply({ embeds: [embed], components: [row] });
      }

      default:
        return interaction.reply("Comando desconhecido.");
    }
  } catch (err) {
    console.error(err);
    return interaction.reply(`Erro: ${err.message}`);
  }
});

// ======================= LOGIN =======================
client.once("ready", () => console.log("🤖 Bot online!"));
client.login(process.env.DISCORD_TOKEN);
