import { REST, Routes } from "discord.js";
import dotenv from "dotenv";
dotenv.config();

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

const commands = [
  { name: "ping", description: "Testa o bot" },
  { name: "listmods", description: "Lista mods instalados" },
  {
    name: "adicionarmod",
    description: "Envia um mod .jar (com curadoria e cooldown)",
    options: [
      {
        name: "arquivo",
        description: "Arquivo .jar do mod",
        type: 11, // ATTACHMENT
        required: true
      }
    ]
  },
  {
    name: "removermod",
    description: "Remove um mod pelo nome",
    options: [
      {
        name: "nome",
        description: "Nome exato do mod (ex: mod.jar)",
        type: 3, // STRING
        required: true
      }
    ]
  },
  {
    name: "historico",
    description: "Lista histórico de uploads (apenas admins)"
  },
  { name: "info", description: "Mostra informações gerais do servidor" },
  { name: "restart", description: "Reinicia o servidor" },
  { name: "help", description: "Mostra todos os comandos disponíveis" }
];

(async () => {
  try {
    console.log("Registrando comandos...");
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log("✅ Comandos registrados!");
  } catch (err) {
    console.error(err);
  }
})();
