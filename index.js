import pkg from "discord.js";
const {
  Client,
  GatewayIntentBits,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
} = pkg;

import SFTPClient from "ssh2-sftp-client";
import fs from "fs";
import os from "os";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { Octokit } from "@octokit/rest";
dotenv.config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ========== CONFIGURAÇÃO (tuneável) ==========
const COOLDOWN_TIME = 1000 * 60 * 5; // 5 minutos
// Nota: agora a checagem de "allowed" é feita por isAllowed(fileName)
const uploadCooldowns = new Map(); // userId -> timestamp
const uploadHistory = []; // histórico simples
const pendingApprovals = new Map(); // messageId -> { file, uploader, requestMessageId }

// ========== GITHUB ==========
const octokit = new Octokit({ auth: process.env.MGT_ID });
const GITHUB_OWNER = process.env.MGT_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_PATH = process.env.GITHUB_PATH || "mods";

// upload/update file to GitHub
async function uploadToGitHub(file) {
  const fullPath = `${GITHUB_PATH}/${file.name}`;
  const res = await fetch(file.url);
  const buf = Buffer.from(await res.arrayBuffer());
  const content = buf.toString("base64");

  let sha;
  try {
    const existing = await octokit.repos.getContent({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: fullPath,
    });
    if (existing && existing.data && existing.data.sha) sha = existing.data.sha;
  } catch (e) {
    // não existe, segue
  }

  await octokit.repos.createOrUpdateFileContents({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    path: fullPath,
    message: `Adicionado/Atualizado mod ${file.name} via bot`,
    content,
    sha: sha ?? undefined,
  });
}

// remove file from GitHub
async function removeFromGitHub(filename) {
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "");
  try {
    const { data } = await octokit.repos.getContent({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: `${GITHUB_PATH}/${sanitized}`,
    });
    const sha = data.sha;
    await octokit.repos.deleteFile({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: `${GITHUB_PATH}/${sanitized}`,
      message: `Removido mod ${sanitized} via bot`,
      sha,
    });
    return sanitized;
  } catch (err) {
    throw new Error(`GitHub: ${err.message}`);
  }
}

// ========== SFTP ==========
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

async function uploadModToSFTP(file) {
  const modsPath = process.env.SFTP_MODS_PATH || "mods";
  const tempPath = `${os.tmpdir()}/${file.name}`;
  const res = await fetch(file.url);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.promises.writeFile(tempPath, buf);
  await ensureSFTP();
  await sftp.put(tempPath, `${modsPath}/${file.name}`);
  try { await fs.promises.unlink(tempPath); } catch {}
}

async function removeModSFTP(filename) {
  const modsPath = process.env.SFTP_MODS_PATH || "mods";
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "");
  await ensureSFTP();
  await sftp.delete(`${modsPath}/${sanitized}`);
  return sanitized;
}

// ========== PTERODACTYL ==========
async function getServerStatusPtero() {
  try {
    const res = await fetch(
      `${process.env.PTERO_PANEL_URL}/servers/${process.env.PTERO_SERVER_ID}/resources`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.PTERO_API_KEY}`,
          "Content-Type": "application/json",
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
    await fetch(`${process.env.PTERO_PANEL_URL}/servers/${process.env.PTERO_SERVER_ID}/power`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PTERO_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ signal: "restart" }),
    });
    return "🔄 Servidor reiniciado!";
  } catch (err) {
    return `Erro: ${err.message}`;
  }
}

async function sendCommandPtero(command) {
  try {
    await fetch(`${process.env.PTERO_PANEL_URL}/servers/${process.env.PTERO_SERVER_ID}/command`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PTERO_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command }),
    });
    return true;
  } catch {
    return false;
  }
}

// ========== UPLOADS / APROVAÇÃO ==========
function registerUpload(userId, username, fileName) {
  uploadHistory.push({ userId, username, fileName, timestamp: Date.now() });
}

async function realizarUploadCompleto(file, uploaderId) {
  // faz SFTP + GitHub
  await uploadModToSFTP(file);
  await uploadToGitHub(file);
  registerUpload(uploaderId, String(uploaderId), file.name);
  await sendCommandPtero(`say Novo mod adicionado: ${file.name}`);
  const restartMsg = await restartServerPtero();
  return restartMsg;
}

// ========== REGRAS DE PERMISSÃO (NEOFORGE 1.21.1 / build opcional) ==========
function isAllowedFilename(filename) {
  if (!filename) return false;
  const s = filename.toLowerCase();
  // exige 'neoforge' e '1.21.1' em qualquer ordem OR aceita string build '21.1.213'
  if (s.includes("21.1.213")) return true;
  return s.includes("neoforge") && s.includes("1.21.1");
}

// função usada quando mod não está em allowed -> cria mensagem de aprovação no canal de moderação
async function pedirAprovacao(interaction, file) {
  // respondemos ao autor (editReply se possível, se não usamos followUp)
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({
        content: `📨 Pedido de aprovação enviado para revisores. Você será notificado aqui quando aprovado ou rejeitado.`,
        embeds: [],
        components: [],
      });
    } else {
      await interaction.reply({
        content: `📨 Pedido de aprovação enviado para revisores. Você será notificado aqui quando aprovado ou rejeitado.`,
        ephemeral: true,
      });
    }
  } catch (e) {
    // ignore
  }

  const modChannelId = process.env.MOD_APPROVAL_CHANNEL;
  if (!modChannelId) {
    return interaction.followUp({ content: "❌ Canal de aprovação não configurado.", ephemeral: true });
  }

  const embed = new EmbedBuilder()
    .setTitle("📢 Pedido de aprovação de mod")
    .addFields(
      { name: "Arquivo", value: file.name, inline: false },
      { name: "Enviado por", value: `${interaction.user.tag} (${interaction.user.id})`, inline: false },
      { name: "Download", value: file.url ?? "Anexo não acessível", inline: false }
    )
    .setColor("#FFA500")
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("approve_mod").setLabel("✔️ Aprovar").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("reject_mod").setLabel("❌ Rejeitar").setStyle(ButtonStyle.Danger)
  );

  const modChannel = await client.channels.fetch(modChannelId).catch(() => null);
  if (!modChannel || !modChannel.send) {
    return interaction.followUp({ content: "❌ Não consegui postar o pedido no canal de aprovação.", ephemeral: true });
  }

  const msg = await modChannel.send({ embeds: [embed], components: [row] });
  // armazenar por message.id para aprovação posterior
  pendingApprovals.set(msg.id, { file, uploader: interaction.user, requestMessageId: interaction.id });
  return;
}

// ========== AUTOCOMPLETE / INTERAÇÕES UNIFICADAS ==========
client.on("interactionCreate", async (interaction) => {
  try {
    // AUTOCOMPLETE (removermod)
    if (interaction.isAutocomplete()) {
      if (interaction.commandName === "removermod") {
        const focused = interaction.options.getFocused();
        const mods = await listMods();
        const filtered = mods
          .filter((m) => m.toLowerCase().includes(String(focused).toLowerCase()))
          .slice(0, 25)
          .map((m) => ({ name: m, value: m }));
        await interaction.respond(filtered);
      }
      return;
    }

    // BOTÕES
    if (interaction.isButton()) {
      // BOTÕES DO PAINEL
      if (interaction.customId === "painel_listar") {
        const mods = await listMods();
        return interaction.reply({ content: mods.length ? mods.join("\n") : "Nenhum mod.", ephemeral: true });
      }
      if (interaction.customId === "painel_restart") {
        const msg = await restartServerPtero();
        return interaction.reply({ content: msg, ephemeral: true });
      }
      if (interaction.customId === "painel_info") {
        const status = await getServerStatusPtero();
        const pretty = status.online
          ? `🟢 Online — CPU ${status.cpu}% — Mem ${Math.round(status.memory / 1024 / 1024)} MB`
          : `🔴 Offline — ${status.error || "erro desconhecido"}`;
        return interaction.reply({ content: pretty, ephemeral: true });
      }

      // APROVAÇÃO DE MOD (NO CANAL DE MODERAÇÃO)
      if (interaction.customId === "approve_mod" || interaction.customId === "reject_mod") {
        // checar permissão
        const member = interaction.member;
        const isMod = member?.permissions?.has?.(PermissionFlagsBits.ManageGuild) || member?.permissions?.has?.(PermissionFlagsBits.Administrator);
        if (!isMod) {
          return interaction.reply({ content: "❌ Você não tem permissão para moderar.", ephemeral: true });
        }

        const msgId = interaction.message.id;
        const pending = pendingApprovals.get(msgId);
        if (!pending) return interaction.reply({ content: "❌ Pedido expirado ou não encontrado.", ephemeral: true });

        pendingApprovals.delete(msgId);
        if (interaction.customId === "reject_mod") {
          // notificar uploader
          const uploader = pending.uploader;
          try { await uploader.send(`❌ Seu mod **${pending.file.name}** foi rejeitado pelos moderadores.`); } catch {}
          await interaction.update({ content: "❌ Mod rejeitado.", embeds: [], components: [] });
          return;
        }

        // APPROVE
        await interaction.update({ content: "✔️ Mod aprovado — processando upload...", embeds: [], components: [] });
        try {
          const restartMsg = await realizarUploadCompleto(pending.file, pending.uploader.id);
          try { await pending.uploader.send(`✔️ Seu mod **${pending.file.name}** foi aprovado e enviado.\n${restartMsg}`); } catch {}
          const logChannelId = process.env.DISCORD_LOG_CHANNEL;
          if (logChannelId) {
            const log = await client.channels.fetch(logChannelId).catch(() => null);
            if (log && log.send) {
              await log.send(`📥 Mod aprovado e enviado: **${pending.file.name}** (por ${pending.uploader.tag || pending.uploader.id})`);
            }
          }
        } catch (e) {
          await interaction.followUp({ content: `❌ Falha no upload: ${e.message}`, ephemeral: true });
        }
        return;
      }
      return;
    }

    // COMANDOS
    if (interaction.isChatInputCommand()) {
      const name = interaction.commandName;

      // --- ping ---
      if (name === "ping") return interaction.reply({ content: "🏓 Pong!", ephemeral: true });

      // --- listmods ---
      if (name === "listmods") {
        await interaction.deferReply();
        const mods = await listMods();
        const text = mods.length ? mods.join("\n") : "Nenhum mod";
        const filePath = `${os.tmpdir()}/mods-list.txt`;
        await fs.promises.writeFile(filePath, text);
        return interaction.editReply({ content: `📦 Mods instalados: ${mods.length}`, files: [new AttachmentBuilder(filePath, { name: "mods-list.txt" })] });
      }

      // --- adicionarmod ---
      if (name === "adicionarmod") {
        const file = interaction.options.getAttachment("arquivo");
        if (!file || !file.name.endsWith(".jar")) return interaction.reply({ content: "❌ Envie um arquivo .jar", ephemeral: true });

        // respondemos rápido para evitar timeout do Discord (e marcamos que já respondemos)
        await interaction.reply({ content: "📤 Recebido — processando...", ephemeral: true });

        // cooldown
        const userId = interaction.user.id;
        const now = Date.now();
        if (uploadCooldowns.has(userId) && now - uploadCooldowns.get(userId) < COOLDOWN_TIME) {
          return interaction.editReply({ content: "⏱ Aguarde antes de enviar outro mod.", ephemeral: true });
        }

        // check allowed rule: neoforge + 1.21.1 OR build 21.1.213
        if (!isAllowedFilename(file.name)) {
          // criar pedido de aprovação no canal de moderação
          return pedirAprovacao(interaction, file);
        }

        // upload direto
        try {
          const restartMsg = await realizarUploadCompleto(file, userId);
          uploadCooldowns.set(userId, Date.now());
          return interaction.editReply({ content: `✅ Mod enviado!\n${restartMsg}`, ephemeral: true });
        } catch (e) {
          return interaction.editReply({ content: `❌ Erro no upload: ${e.message}`, ephemeral: true });
        }
      }

      // --- removermod ---
      if (name === "removermod") {
        const filename = interaction.options.getString("nome");
        if (!filename) return interaction.reply({ content: "❌ Informe o nome do mod.", ephemeral: true });
        await interaction.reply({ content: "🗑 Removendo...", ephemeral: true });

        try {
          try {
            await removeFromGitHub(filename);
          } catch (e) {
            // loga e continua para tentar SFTP
            console.error("GitHub remove error:", e.message);
          }

          const removed = await removeModSFTP(filename);
          await interaction.editReply({ content: `✅ Removido: ${removed}`, ephemeral: true });
          // notify server
          await sendCommandPtero(`say Mod removido: ${removed}`);
          await restartServerPtero();
        } catch (e) {
          return interaction.editReply({ content: `❌ Erro ao remover: ${e.message}`, ephemeral: true });
        }
        return;
      }

      // --- painel (embed + botões) ---
      if (name === "painel") {
        const embed = new EmbedBuilder()
          .setTitle("⚙️ Painel de Gerenciamento")
          .setDescription("Gerencie o servidor com os botões abaixo")
          .setColor("#5865F2");

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("painel_listar").setLabel("📦 Listar Mods").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId("painel_restart").setLabel("🔄 Reiniciar").setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId("painel_info").setLabel("ℹ️ Info").setStyle(ButtonStyle.Secondary)
        );

        return interaction.reply({ embeds: [embed], components: [row], ephemeral: false });
      }

      // --- info ---
      if (name === "info") {
        await interaction.deferReply({ ephemeral: true });
        const status = await getServerStatusPtero();
        const text = status.online
          ? `🟢 Online\nCPU: ${status.cpu}%\nMem: ${Math.round(status.memory/1024/1024)} MB\nEstado: ${status.status}`
          : `🔴 Offline\nErro: ${status.error}`;
        return interaction.editReply({ content: `**STATUS DO SERVIDOR**\n${text}`, ephemeral: true });
      }

      // --- modpack ---
      if (name === "modpack") {
        return interaction.reply({
          content:
            "📥 **Modpack (GitHub)**\n`git clone https://github.com/Baryczka25/MGT-Server.git`\n\nBaixe em: https://github.com/Baryczka25/MGT-Server/archive/refs/heads/main.zip",
          ephemeral: true,
        });
      }

      if (name === "help") {
        return interaction.reply({ content: "Use os comandos /listmods /adicionarmod /removermod /painel /modpack", ephemeral: true });
      }
    } // end chat command

  } catch (err) {
    console.error("Interaction handler error:", err);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: `❌ Erro: ${err.message}` });
      } else {
        await interaction.reply({ content: `❌ Erro: ${err.message}`, ephemeral: true });
      }
    } catch (e) {
      console.error("Failed to notify user about error:", e);
    }
  }
});

// login
client.once("ready", () => console.log("🤖 Bot online!"));
client.login(process.env.DISCORD_TOKEN);
