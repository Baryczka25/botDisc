import { REST, Routes } from "discord.js";
import dotenv from "dotenv";
dotenv.config();

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

const commands = [
    {
        name: "ping",
        description: "Testa se o bot está online"
    },
    {
        name: "listmods",
        description: "Lista os mods instalados no servidor"
    },
    {
        name: "uploadmod",
        description: "Envia um mod .jar para a pasta mods",
        options: [
            {
                name: "arquivo",
                description: "Envie o arquivo .jar do mod",
                type: 11,
                required: true
            }
        ]
    },
    {
        name: "removemod",
        description: "Remove um mod pelo nome",
        options: [
            {
                name: "nome",
                description: "Nome exato do mod (exemplo: mod.jar)",
                type: 3,
                required: true
            }
        ]
    },
    {
        name: "restart",
        description: "Reinicia o servidor de Minecraft da EnxadaHost"
    },
    {
        name: "help",
        description: "Mostra todos os comandos disponíveis"
    },
    {
        name: "info",
        description: "Mostra informações do servidor (status, mods, etc)"
    }
];

(async () => {
    try {
        console.log("Registrando comandos...");
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log("Comandos registrados!");
    } catch (err) {
        console.error(err);
    }
})();

