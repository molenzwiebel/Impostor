import "dotenv/config";
import Eris from "eris";
import { connectToDatabase } from "./database";
import { onMessageCreated } from "./listeners";

const intents = Eris.Constants.Intents;

(async () => {
    console.log("[+] Starting impostor...");

    await connectToDatabase();

    console.log("[+] Connected to database!");

    const bot = new Eris.Client(process.env.DISCORD_TOKEN as string, {
        intents: intents.guilds | intents.guildVoiceStates | intents.guildMessages | intents.guildMessageReactions,
        messageLimit: 5,
    });

    await bot.connect();
    await new Promise(r => bot.once("ready", r));

    bot.on("messageCreate", onMessageCreated.bind(null, bot));

    console.log("[+] Connected to Discord as " + bot.user.username);
})();
