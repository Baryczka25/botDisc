import pkg from "discord.js";
const {
  Client,
  GatewayIntentBits,
  AttachmentBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = pkg;

import fs from "fs";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

// ===================== CLIENT =====================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

// ===================== PASTAS =====================
if (!fs.existsSync("./mods")) fs.mkdirSync("./mods");
if (!fs.existsSync("./historico.txt")) fs.writeFileSync("./historico.txt", "");

// ===================== VARIÁVEIS =====================
const cooldown = new Set();
const TEMP_MODS = {};   // mods aguardando aprovação

// ===================== LOGIN =====================
client.once("ready", () => {
  console.log(`🔥 Bot ONLINE como ${client.user.tag}`);
});

// ===================== FUNÇÃO: LOGAR AÇÕES =====================
function logHistorico(texto) {
  const linha = `[${new Date().toLocaleString()}] ${texto}\n`;
  fs.appendFileSync("./historico.txt", linha);
}

// ===================== COMANDOS =====================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // =============== /ping ===============
  if (interaction.commandName === "ping") {
    return interaction.reply("🏓 Pong!");
  }

  // =============== /listmods ===============
  if (interaction.commandName === "listmods") {
    const mods = fs.readdirSync("./mods");

    if (mods.length === 0)
      return interaction.reply("📭 Nenhum mod instalado.");

    // Se a lista passar de 2000 chars, dividir
    const lista = mods.join("\n");
    if (lista.length > 1900) {
      const partes = lista.match(/(.|[\r\n]){1,1900}/g);
      for (const parte of partes) {
        await interaction.channel.send("📦 **Mods instalados:**\n" + parte);
      }
      return interaction.reply("📤 Lista enviada em partes.");
    }

    return interaction.reply("📦 **Mods instalados:**\n" + lista);
  }

  // =============== /adicionarmod ===============
  if (interaction.commandName === "adicionarmod") {
    const file = interaction.options.getAttachment("arquivo");

    if (!file.name.endsWith(".jar"))
      return interaction.reply("❌ Envie apenas arquivos .jar");

    if (cooldown.has(interaction.user.id))
      return interaction.reply("⏳ Você deve aguardar 30 segundos para enviar outro mod.");

    cooldown.add(interaction.user.id);
    setTimeout(() => cooldown.delete(interaction.user.id), 30000);

    await interaction.reply("⏳ Enviando mod para aprovação do administrador...");

    // Guardar temporariamente
    TEMP_MODS[interaction.id] = { file, autor: interaction.user };

    const adminId = process.env.ADMIN_ID;
    const adminUser = await client.users.fetch(adminId);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`aprovar_${interaction.id}`)
        .setLabel("Aprovar")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId(`negar_${interaction.id}`)
        .setLabel("Negar")
        .setStyle(ButtonStyle.Danger)
    );

    await adminUser.send({
      content: `📥 **Novo MOD enviado**\n👤 Autor: ${interaction.user.tag}\n📦 Arquivo: ${file.name}`,
      components: [row]
    });
  }

  // =============== /removermod ===============
  if (interaction.commandName === "removermod") {
    const nome = interaction.options.getString("nome");

    if (!fs.existsSync(`./mods/${nome}`))
      return interaction.reply("❌ Mod não encontrado.");

    fs.unlinkSync(`./mods/${nome}`);

    logHistorico(`❌ Mod removido: ${nome}`);

    return interaction.reply(`🗑 Mod **${nome}** removido com sucesso.`);
  }

  // =============== /historico ===============
  if (interaction.commandName === "historico") {
    const txt = fs.readFileSync("./historico.txt", "utf-8") || "Vazio";

    if (txt.length > 1900) {
      const partes = txt.match(/(.|[\r\n]){1,1900}/g);
      for (const parte of partes) {
        await interaction.channel.send("📜 **Histórico:**\n" + parte);
      }
      return interaction.reply("📤 Histórico enviado em partes.");
    }

    return interaction.reply("📜 **Histórico:**\n" + txt);
  }

  // =============== /modpack (GitHub ZIP) ===============
  if (interaction.commandName === "modpack") {
    await interaction.reply("📦 Baixando modpack...");

    const url = process.env.MODPACK_URL;
    const response = await fetch(url);
    const buffer = Buffer.from(await response.arrayBuffer());

    const file = new AttachmentBuilder(buffer, { name: "modpack.zip" });

    return interaction.editReply({ content: "📥 Modpack pronto:", files: [file] });
  }

  // =============== /restart ===============
  if (interaction.commandName === "restart") {
    return interaction.reply("🔄 Reiniciando servidor de Minecraft...");
  }

  // =============== /painel ===============
  if (interaction.commandName === "painel") {
    const embed = new EmbedBuilder()
      .setTitle("🛠 Painel de Controle")
      .setDescription("Gerencie o servidor pelos botões abaixo.");

    const row = new ActionRowBuilder().addComponents(
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
        .setLabel("🔄 Reiniciar")
        .setStyle(ButtonStyle.Danger)
    );

    return interaction.reply({ embeds: [embed], components: [row] });
  }
});

// ===================== BOTÕES =====================
client.on("interactionCreate", async (interaction) => {

  // ======= PAINEL =======
  if (interaction.isButton()) {
    if (interaction.customId === "painel_listar") {
      const mods = fs.readdirSync("./mods").join("\n");
      return interaction.reply({ content: mods || "📭 Nada encontrado.", ephemeral: true });
    }

    if (interaction.customId === "painel_historico") {
      const txt = fs.readFileSync("./historico.txt", "utf-8") || "Vazio";
      return interaction.reply({ content: txt, ephemeral: true });
    }

    if (interaction.customId === "painel_restart") {
      return interaction.reply("🔄 Reiniciando servidor...");
    }

    // ======= APROVAR / NEGAR MOD =======
    if (interaction.customId.startsWith("aprovar_")) {
      const id = interaction.customId.replace("aprovar_", "");
      const temp = TEMP_MODS[id];
      if (!temp) return interaction.reply("❌ Mod não encontrado.");

      const res = await fetch(temp.file.url);
      const buffer = Buffer.from(await res.arrayBuffer());

      fs.writeFileSync(`./mods/${temp.file.name}`, buffer);

      logHistorico(`✔ Mod aprovado: ${temp.file.name}`);

      delete TEMP_MODS[id];

      return interaction.reply(`✔ Mod **${temp.file.name}** aprovado!`);
    }

    if (interaction.customId.startsWith("negar_")) {
      const id = interaction.customId.replace("negar_", "");
      const temp = TEMP_MODS[id];
      if (!temp) return interaction.reply("❌ Mod não encontrado.");

      logHistorico(`❌ Mod negado: ${temp.file.name}`);

      delete TEMP_MODS[id];

      return interaction.reply(`🚫 Mod **${temp.file.name}** negado.`);
    }
  }
});

// ===================== LOGIN =====================
client.login(process.env.DISCORD_TOKEN);